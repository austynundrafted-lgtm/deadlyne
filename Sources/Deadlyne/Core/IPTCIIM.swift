import CryptoKit
import Foundation

/// Legacy IPTC-IIM ("IPTC Information Interchange Model") captions, the pre-XMP format that
/// many newsroom and wire systems still read. In a JPEG it lives in an APP13 "Photoshop 3.0"
/// segment as image resource 0x0404.
///
/// ImageIO can't write IIM reliably (it re-derives the block from XMP and decodes old
/// charset-less blocks as MacRoman), so this rewrites just the APP13 segment and copies every
/// other byte of the file — including the compressed image data — unchanged.
enum IPTCIIM {
    struct Dataset: Equatable {
        var record: UInt8
        var number: UInt8
        var data: Data
    }

    enum IIMError: LocalizedError {
        case notJPEG, tooLarge
        var errorDescription: String? {
            switch self {
            case .notJPEG: return "the file isn’t a readable JPEG"
            case .tooLarge: return "the legacy IPTC block would exceed 64 KB"
            }
        }
    }

    /// IIM dataset numbers (record 2) and their standard maximum lengths in bytes.
    static let mapping: [(field: IPTCField, number: UInt8, maxBytes: Int)] = [
        (.keywords, 25, 64),
        (.creator, 80, 32),
        (.city, 90, 32),
        (.location, 92, 32),
        (.state, 95, 32),
        (.country, 101, 64),
        (.headline, 105, 256),
        (.credit, 110, 32),
        (.copyright, 116, 128),
        (.caption, 120, 2000),
    ]
    /// Datasets Deadlyne owns; everything else in an existing block is preserved.
    static let managedNumbers: Set<UInt8> = Set(mapping.map(\.number))

    /// IIM Date Created (2:55, CCYYMMDD) and Time Created (2:60, HHMMSS±HHMM).
    struct DateCreated {
        var date: String
        var time: String

        /// From EXIF DateTimeOriginal ("2026:08:22 09:51:31") and OffsetTimeOriginal ("-05:00").
        init?(exifDateTime: String?, offset: String?) {
            guard let s = exifDateTime else { return nil }
            let digits = s.filter(\.isNumber)
            guard digits.count >= 14 else { return nil }
            date = String(digits.prefix(8))
            time = String(digits.dropFirst(8).prefix(6))
            if let o = offset, o.count == 6, let sign = o.first, sign == "+" || sign == "-" {
                time += String(sign) + o.dropFirst().filter(\.isNumber)
            }
        }
    }

    private static let utf8Marker = Data([0x1B, 0x25, 0x47]) // ESC % G

    // MARK: Encoding

    /// Datasets for `info`, truncated to IIM limits without splitting characters.
    static func datasets(for info: IPTCInfo) -> [Dataset] {
        var out: [Dataset] = []
        for (field, number, maxBytes) in mapping {
            let values: [String]
            switch field {
            case .keywords: values = info.keywords
            case .creator: values = info[.creator].split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
            default: values = [info[field]]
            }
            for v in values where !v.isEmpty {
                out.append(Dataset(record: 2, number: number, data: Data(truncate(v, toBytes: maxBytes).utf8)))
            }
        }
        return out
    }

    static func truncate(_ s: String, toBytes max: Int) -> String {
        guard s.utf8.count > max else { return s }
        var out = ""
        var used = 0
        for ch in s {
            let n = String(ch).utf8.count
            if used + n > max { break }
            out.append(ch)
            used += n
        }
        return out
    }

    static func encode(_ sets: [Dataset]) -> Data {
        var d = Data()
        for s in sets {
            let len = min(s.data.count, 0x7FFF)
            d.append(contentsOf: [0x1C, s.record, s.number, UInt8(len >> 8), UInt8(len & 0xFF)])
            d.append(s.data.prefix(len))
        }
        return d
    }

    static func decode(_ d: Data) -> [Dataset] {
        let b = [UInt8](d)
        var out: [Dataset] = []
        var i = 0
        while i + 5 <= b.count, b[i] == 0x1C {
            var len = Int(b[i + 3]) << 8 | Int(b[i + 4])
            var start = i + 5
            if len & 0x8000 != 0 { // extended length (rare): the next N bytes hold the length
                let n = len & 0x7FFF
                guard n <= 4, start + n <= b.count else { break }
                len = b[start..<(start + n)].reduce(0) { $0 << 8 | Int($1) }
                start += n
            }
            guard start + len <= b.count else { break }
            out.append(Dataset(record: b[i + 1], number: b[i + 2], data: Data(b[start..<(start + len)])))
            i = start + len
        }
        return out
    }

    /// Builds the new IIM block: ours (if `info` given) plus whatever else the old block held.
    static func merged(existing: [Dataset], info: IPTCInfo?, dateCreated: DateCreated? = nil) -> [Dataset] {
        let oldUTF8 = existing.contains { $0.record == 1 && $0.number == 90 && $0.data == utf8Marker }
        var preserved = existing.filter {
            !($0.record == 1 && $0.number == 90) && !($0.record == 2 && $0.number == 0)
                && !($0.record == 2 && managedNumbers.contains($0.number))
        }
        // We always declare UTF-8, so re-encode preserved charset-less (Latin-1 / CP1252) text.
        if !oldUTF8 {
            preserved = preserved.map { s in
                guard s.record == 2, let text = String(data: s.data, encoding: .windowsCP1252) else { return s }
                return Dataset(record: 2, number: s.number, data: Data(text.utf8))
            }
        }
        var ours = info.map(datasets(for:)) ?? []
        if info != nil, let dc = dateCreated {
            if !preserved.contains(where: { $0.record == 2 && $0.number == 55 }) {
                ours.append(Dataset(record: 2, number: 55, data: Data(dc.date.utf8)))
            }
            if !preserved.contains(where: { $0.record == 2 && $0.number == 60 }) {
                ours.append(Dataset(record: 2, number: 60, data: Data(dc.time.utf8)))
            }
        }
        let record2 = preserved.filter { $0.record == 2 } + ours
        guard !record2.isEmpty else { return [] }
        let record1 = [Dataset(record: 1, number: 90, data: utf8Marker)] + preserved.filter { $0.record == 1 }
        let version = Dataset(record: 2, number: 0, data: Data([0x00, 0x04]))
        // Stable sort by dataset number keeps repeated keywords in order.
        let sorted = record2.enumerated().sorted { ($0.element.number, $0.offset) < ($1.element.number, $1.offset) }.map(\.element)
        return record1 + [version] + sorted
    }

    // MARK: JPEG structure

    private static let photoshopHeader = Data("Photoshop 3.0\u{0}".utf8)

    private struct Layout {
        var segments: [(marker: UInt8, range: Range<Int>)]
        var scanStart: Int
    }

    /// Walks the marker segments before the image data (SOS).
    private static func layout(_ jpeg: Data) throws -> Layout {
        let b = [UInt8](jpeg.prefix(1 << 20)) // metadata always precedes the scan; 1 MB is ample
        guard b.count > 4, b[0] == 0xFF, b[1] == 0xD8 else { throw IIMError.notJPEG }
        var segments: [(marker: UInt8, range: Range<Int>)] = []
        var i = 2
        while i + 4 <= b.count {
            guard b[i] == 0xFF else { throw IIMError.notJPEG }
            let marker = b[i + 1]
            if marker == 0xFF { i += 1; continue }
            if marker == 0xDA || marker == 0xD9 { return Layout(segments: segments, scanStart: i) }
            if (0xD0...0xD7).contains(marker) || marker == 0x01 { i += 2; continue }
            let len = Int(b[i + 2]) << 8 | Int(b[i + 3])
            guard len >= 2, i + 2 + len <= jpeg.count else { throw IIMError.notJPEG }
            segments.append((marker, i..<(i + 2 + len)))
            i += 2 + len
        }
        throw IIMError.notJPEG
    }

    private static func isPhotoshop(_ jpeg: Data, _ s: (marker: UInt8, range: Range<Int>)) -> Bool {
        s.marker == 0xED && jpeg[(s.range.lowerBound + 4)..<s.range.upperBound].starts(with: photoshopHeader)
    }

    /// Photoshop image resources from all APP13 segments (large blocks may span several).
    private static func resources(_ jpeg: Data, _ lay: Layout) -> [Resource] {
        var ps = Data()
        for s in lay.segments where isPhotoshop(jpeg, s) {
            ps.append(jpeg[(s.range.lowerBound + 4 + photoshopHeader.count)..<s.range.upperBound])
        }
        return parseResources(ps)
    }

    /// The IIM datasets currently in a JPEG, exactly as stored.
    static func read(jpeg: Data) -> [Dataset] {
        guard let lay = try? layout(jpeg) else { return [] }
        return resources(jpeg, lay).first { $0.id == 0x0404 }.map { decode($0.data) } ?? []
    }

    /// Rewrites the APP13 segment of `jpeg`.
    /// - Parameters:
    ///   - info: captions to write; nil removes Deadlyne's datasets (the user writes XMP only),
    ///     so no stale legacy caption is left behind.
    ///   - existing: the IIM datasets to preserve. Pass the block from the *original* file when
    ///     `jpeg` has been through ImageIO, which rewrites IIM on its own; nil reads it from `jpeg`.
    static func rewrite(jpeg: Data, info: IPTCInfo?, existing: [Dataset]? = nil,
                        dateCreated: DateCreated? = nil) throws -> Data {
        let lay = try layout(jpeg)
        var res = resources(jpeg, lay)
        let stored = res.first(where: { $0.id == 0x0404 }).map { decode($0.data) } ?? []
        let old: [Dataset] = existing ?? stored
        res.removeAll { $0.id == 0x0404 || $0.id == 0x0425 }
        let iim = encode(merged(existing: old, info: info, dateCreated: dateCreated))
        if !iim.isEmpty {
            res.append(Resource(id: 0x0404, name: Data(), data: iim))
            res.append(Resource(id: 0x0425, name: Data(), data: Data(Insecure.MD5.hash(data: iim))))
        }

        var app13 = Data()
        if !res.isEmpty {
            let payload = photoshopHeader + encodeResources(res)
            guard payload.count + 2 <= 0xFFFF else { throw IIMError.tooLarge }
            app13 = Data([0xFF, 0xED, UInt8((payload.count + 2) >> 8), UInt8((payload.count + 2) & 0xFF)]) + payload
        }

        // Put the block where the old one was, else after the leading APP0–APP12 segments.
        let segs = lay.segments
        let insertAt = segs.firstIndex { isPhotoshop(jpeg, $0) }
            ?? segs.firstIndex { !(0xE0...0xEC).contains($0.marker) } ?? segs.count
        var out = Data([0xFF, 0xD8])
        out.reserveCapacity(jpeg.count + app13.count)
        for (n, s) in segs.enumerated() {
            if n == insertAt { out.append(app13) }
            if !isPhotoshop(jpeg, s) { out.append(jpeg[s.range]) }
        }
        if insertAt >= segs.count { out.append(app13) }
        out.append(jpeg[lay.scanStart...])
        return out
    }

    // MARK: Photoshop image resources

    struct Resource {
        var signature = Data("8BIM".utf8)
        var id: UInt16
        var name: Data
        var data: Data
    }

    static func parseResources(_ d: Data) -> [Resource] {
        let b = [UInt8](d)
        var out: [Resource] = []
        var i = 0
        while i + 12 <= b.count {
            let sig = Data(b[i..<(i + 4)])
            guard sig == Data("8BIM".utf8) || sig == Data("MeSa".utf8) || sig == Data("PHUT".utf8) else { break }
            let id = UInt16(b[i + 4]) << 8 | UInt16(b[i + 5])
            let nameLen = Int(b[i + 6])
            var p = i + 7 + nameLen
            if (1 + nameLen) % 2 == 1 { p += 1 } // pascal string padded to even length
            guard p + 4 <= b.count else { break }
            let size = Int(b[p]) << 24 | Int(b[p + 1]) << 16 | Int(b[p + 2]) << 8 | Int(b[p + 3])
            p += 4
            guard p + size <= b.count else { break }
            out.append(Resource(signature: sig, id: id, name: Data(b[(i + 7)..<(i + 7 + nameLen)]), data: Data(b[p..<(p + size)])))
            i = p + size + (size % 2)
        }
        return out
    }

    static func encodeResources(_ rs: [Resource]) -> Data {
        var d = Data()
        for r in rs {
            d.append(r.signature)
            d.append(contentsOf: [UInt8(r.id >> 8), UInt8(r.id & 0xFF)])
            d.append(UInt8(r.name.count))
            d.append(r.name)
            if (1 + r.name.count) % 2 == 1 { d.append(0) }
            let n = r.data.count
            d.append(contentsOf: [UInt8(n >> 24 & 0xFF), UInt8(n >> 16 & 0xFF), UInt8(n >> 8 & 0xFF), UInt8(n & 0xFF)])
            d.append(r.data)
            if n % 2 == 1 { d.append(0) }
        }
        return d
    }
}
