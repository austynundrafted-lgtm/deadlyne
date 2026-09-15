import Foundation

/// Pulls the camera-rendered JPEG previews out of RAW files without touching the sensor data.
///
/// This is the entire trick behind "instant RAW" browsers like Photo Mechanic: every RAW file
/// already contains one or more finished JPEGs that the camera rendered at capture time.
/// Instead of demosaicing 24–60 MP of sensor data, we parse the container, seek straight to
/// the JPEG and read only those bytes.
enum PreviewKind {
    /// Smallest embedded JPEG that is still >= 1000px on the long edge (grid thumbnails).
    case thumbnail
    /// Largest embedded JPEG — usually full sensor resolution (preview + 100% zoom).
    case full
}

struct JPEGCandidate {
    var offset: UInt64
    var length: Int
    var width = 0
    var height = 0
    var area: Int { width * height }
    var longEdge: Int { max(width, height) }
}

enum PreviewExtractor {

    static let maxJPEGBytes = 80 << 20

    /// Returns the bytes of the best embedded JPEG for `kind`, or nil when the file has none
    /// (callers then fall back to a real ImageIO decode).
    static func extract(from url: URL, kind: PreviewKind) -> Data? {
        guard let reader = FileReader(url: url) else { return nil }
        let candidates = findCandidates(reader)
        guard let best = choose(candidates, kind: kind) else { return nil }
        return reader.readData(best.offset, best.length)
    }

    static func findCandidates(_ r: FileReader) -> [JPEGCandidate] {
        guard let head = r.read(0, 16), head.count >= 16 else { return [] }
        var raw: [JPEGCandidate]
        if head.ascii(4, 4) == "ftyp" {
            raw = cr3Candidates(r)                      // Canon CR3 (ISO base media)
        } else if head.ascii(0, 8) == "FUJIFILM" {
            raw = rafCandidates(r)                      // Fujifilm RAF
        } else if (head[0] == 0x49 && head[1] == 0x49) || (head[0] == 0x4D && head[1] == 0x4D) {
            raw = tiffCandidates(r, base: 0)            // CR2, NEF, ARW, DNG, ORF, RW2, PEF, SRW, …
        } else {
            raw = []
        }
        return raw.compactMap { probe(r, $0) }
    }

    static func choose(_ candidates: [JPEGCandidate], kind: PreviewKind) -> JPEGCandidate? {
        guard !candidates.isEmpty else { return nil }
        let largest = candidates.max { ($0.area, $0.length) < ($1.area, $1.length) }
        switch kind {
        case .full:
            return largest
        case .thumbnail:
            let usable = candidates.filter { $0.longEdge >= 1000 }
            return usable.min { $0.area < $1.area } ?? largest
        }
    }

    // MARK: - Canon CR3

    private static let canonPreviewUUID = "eaf42b5e1c984b88b9fbb7dc406e4d16"

    private static func cr3Candidates(_ r: FileReader) -> [JPEGCandidate] {
        var out: [JPEGCandidate] = []
        var off: UInt64 = 0
        while off + 8 <= r.size {
            guard let h = r.read(off, 40), h.count >= 8 else { break }
            var size = UInt64(h.u32(0, le: false))
            var hdr: UInt64 = 8
            if size == 1, h.count >= 16 { size = h.u64be(8); hdr = 16 } else if size == 0 { size = r.size - off }
            guard size >= hdr else { break }
            let type = h.ascii(4, 4)

            if type == "moov", let moov = r.read(off, Int(min(size, 8 << 20))) {
                if let full = cr3FirstTrackSample(moov) { out.append(full) }
            } else if type == "uuid", h.count >= 24, h.hex(8, 16) == canonPreviewUUID {
                // uuid header(8) + uuid(16) + 8 bytes, then the PRVW box:
                // PRVW hdr(8) | 4 unk | 2 unk | 2 width | 2 height | 2 unk | 4 length | JPEG…
                let prvwOff = off + 32
                if let b = r.read(prvwOff, 24), b.count == 24, b.ascii(4, 4) == "PRVW" {
                    var c = JPEGCandidate(offset: prvwOff + 24, length: b.u32(20, le: false))
                    c.width = b.u16(14, le: false)
                    c.height = b.u16(16, le: false)
                    out.append(c)
                }
            } else if type == "mdat" {
                break // all index boxes precede the media data
            }
            off += size
        }
        return out
    }

    /// The first trak in a CR3 holds exactly one sample: the full-resolution JPEG.
    private static func cr3FirstTrackSample(_ m: [UInt8]) -> JPEGCandidate? {
        guard let trak = m.childBox("trak", in: 8..<m.count),
              let mdia = m.childBox("mdia", in: trak),
              let minf = m.childBox("minf", in: mdia),
              let stbl = m.childBox("stbl", in: minf),
              let stsz = m.childBox("stsz", in: stbl) else { return nil }
        // stsz: version/flags(4) sample_size(4) count(4) [entries]
        var length = m.u32(stsz.lowerBound + 4, le: false)
        if length == 0 { length = m.u32(stsz.lowerBound + 12, le: false) }
        let offset: UInt64
        if let co64 = m.childBox("co64", in: stbl) {
            offset = m.u64be(co64.lowerBound + 8)
        } else if let stco = m.childBox("stco", in: stbl) {
            offset = UInt64(m.u32(stco.lowerBound + 8, le: false))
        } else { return nil }
        guard length > 0 else { return nil }
        return JPEGCandidate(offset: offset, length: length)
    }

    // MARK: - Fujifilm RAF

    private static func rafCandidates(_ r: FileReader) -> [JPEGCandidate] {
        guard let h = r.read(84, 8), h.count == 8 else { return [] }
        let off = UInt64(h.u32(0, le: false)), len = h.u32(4, le: false)
        return len > 0 ? [JPEGCandidate(offset: off, length: len)] : []
    }

    // MARK: - TIFF-based RAW (CR2, NEF, ARW, DNG, ORF, RW2, PEF, SRW, 3FR, IIQ, ERF…)

    private static func tiffCandidates(_ r: FileReader, base: UInt64) -> [JPEGCandidate] {
        guard let h = r.read(base, 8), h.count == 8 else { return [] }
        let le = h[0] == 0x49
        var queue = [UInt64(h.u32(4, le: le))]
        var visited = Set<UInt64>()
        var out: [JPEGCandidate] = []

        while let ifd = queue.popLast(), visited.count < 48 {
            guard ifd > 0, !visited.contains(ifd), base + ifd < r.size else { continue }
            visited.insert(ifd)
            guard let countBytes = r.read(base + ifd, 2), countBytes.count == 2 else { continue }
            let n = countBytes.u16(0, le: le)
            guard n > 0, n < 1000, let e = r.read(base + ifd + 2, n * 12 + 4) else { continue }

            var compression = 0, stripOff = 0, stripLen = 0, stripCount = 0, jpgOff = 0, jpgLen = 0
            for i in 0..<n {
                let p = i * 12
                guard p + 12 <= e.count else { break }
                let tag = e.u16(p, le: le), type = e.u16(p + 2, le: le), count = e.u32(p + 4, le: le)
                let scalar = type == 3 ? e.u16(p + 8, le: le) : e.u32(p + 8, le: le)
                switch tag {
                case 0x0103: compression = scalar
                case 0x0111: stripOff = scalar; stripCount = count
                case 0x0117: stripLen = scalar
                case 0x0201: jpgOff = scalar
                case 0x0202: jpgLen = scalar
                case 0x002E where type == 7:       // Panasonic RW2 JpgFromRaw
                    out.append(JPEGCandidate(offset: base + UInt64(scalar), length: count))
                case 0x8769:                       // EXIF IFD
                    queue.append(UInt64(scalar))
                case 0x014A:                       // SubIFDs
                    if count == 1 {
                        queue.append(UInt64(scalar))
                    } else if count < 64, let arr = r.read(base + UInt64(scalar), count * 4) {
                        for k in 0..<count { queue.append(UInt64(arr.u32(k * 4, le: le))) }
                    }
                default: break
                }
            }
            if jpgOff > 0, jpgLen > 0 {
                out.append(JPEGCandidate(offset: base + UInt64(jpgOff), length: jpgLen))
            }
            if [6, 7, 34892].contains(compression), stripCount == 1, stripOff > 0, stripLen > 0 {
                out.append(JPEGCandidate(offset: base + UInt64(stripOff), length: stripLen))
            }
            let next = e.u32(n * 12, le: le)
            if next > 0 { queue.insert(UInt64(next), at: 0) }
        }
        return out
    }

    // MARK: - JPEG validation

    /// Confirms a candidate is a displayable (baseline/progressive) JPEG and reads its size.
    /// Lossless JPEG (SOF3) is how CR2/DNG store raw sensor data, so it is rejected.
    private static func probe(_ r: FileReader, _ c: JPEGCandidate) -> JPEGCandidate? {
        guard c.length > 512, c.length <= maxJPEGBytes, c.offset + UInt64(c.length) <= r.size,
              let soi = r.read(c.offset, 2), soi == [0xFF, 0xD8] else { return nil }
        var p = c.offset + 2
        let end = c.offset + UInt64(c.length)
        for _ in 0..<96 {
            guard p + 4 <= end, let m = r.read(p, 10), m.count >= 4, m[0] == 0xFF else { return nil }
            let marker = m[1]
            if marker == 0xFF { p += 1; continue }
            switch marker {
            case 0xC0, 0xC1, 0xC2:
                guard m.count >= 9 else { return nil }
                var out = c
                out.height = m.u16(5, le: false)
                out.width = m.u16(7, le: false)
                return out.area > 0 ? out : nil
            case 0xC3, 0xC5...0xC7, 0xC9...0xCB, 0xCD...0xCF, 0xDA, 0xD9:
                return nil
            default:
                p += UInt64(2 + m.u16(2, le: false))
            }
        }
        return nil
    }
}

// MARK: - Low-level reading

/// Positional reads straight from the file descriptor — no full-file mapping, so a 60 MB RAW
/// costs only the few kilobytes of headers plus the JPEG we actually want.
final class FileReader {
    private let fd: Int32
    let size: UInt64

    init?(url: URL) {
        let fd = open(url.path, O_RDONLY)
        guard fd >= 0 else { return nil }
        var st = stat()
        guard fstat(fd, &st) == 0 else { close(fd); return nil }
        self.fd = fd
        self.size = UInt64(st.st_size)
    }

    deinit { close(fd) }

    func read(_ offset: UInt64, _ length: Int) -> [UInt8]? {
        guard length > 0, offset < size else { return nil }
        let len = Int(min(UInt64(length), size - offset))
        var buf = [UInt8](repeating: 0, count: len)
        let n = buf.withUnsafeMutableBytes { pread(fd, $0.baseAddress, len, off_t(offset)) }
        return n == len ? buf : nil
    }

    func readData(_ offset: UInt64, _ length: Int) -> Data? {
        guard length > 0, offset + UInt64(length) <= size else { return nil }
        var data = Data(count: length)
        let n = data.withUnsafeMutableBytes { pread(fd, $0.baseAddress, length, off_t(offset)) }
        return n == length ? data : nil
    }
}

extension Array where Element == UInt8 {
    func u16(_ i: Int, le: Bool) -> Int {
        guard i >= 0, i + 2 <= count else { return 0 }
        return le ? Int(self[i]) | Int(self[i + 1]) << 8 : Int(self[i]) << 8 | Int(self[i + 1])
    }

    func u32(_ i: Int, le: Bool) -> Int {
        guard i >= 0, i + 4 <= count else { return 0 }
        let a = Int(self[i]), b = Int(self[i + 1]), c = Int(self[i + 2]), d = Int(self[i + 3])
        return le ? a | b << 8 | c << 16 | d << 24 : a << 24 | b << 16 | c << 8 | d
    }

    func u64be(_ i: Int) -> UInt64 {
        guard i >= 0, i + 8 <= count else { return 0 }
        return (0..<8).reduce(UInt64(0)) { $0 << 8 | UInt64(self[i + $1]) }
    }

    func ascii(_ i: Int, _ n: Int) -> String {
        guard i >= 0, i + n <= count else { return "" }
        return String(decoding: self[i..<(i + n)], as: UTF8.self)
    }

    func hex(_ i: Int, _ n: Int) -> String {
        guard i >= 0, i + n <= count else { return "" }
        return self[i..<(i + n)].map { String(format: "%02x", $0) }.joined()
    }

    /// Finds the body range of the first ISO-BMFF child box of `type` within `range`.
    func childBox(_ type: String, in range: Range<Int>) -> Range<Int>? {
        var off = range.lowerBound
        while off + 8 <= range.upperBound {
            var size = u32(off, le: false)
            var hdr = 8
            if size == 1 { size = Int(u64be(off + 8)); hdr = 16 }
            guard size >= hdr, off + size <= range.upperBound else { return nil }
            if ascii(off + 4, 4) == type { return (off + hdr)..<(off + size) }
            off += size
        }
        return nil
    }
}
