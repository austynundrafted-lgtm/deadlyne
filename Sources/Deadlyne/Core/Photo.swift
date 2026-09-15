import AppKit
import ImageIO

enum FileTypes {
    static let raw: Set<String> = [
        "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "dng", "raf", "orf", "rw2",
        "pef", "srw", "3fr", "iiq", "erf", "kdc", "mos", "mrw", "x3f", "rwl", "gpr",
    ]
    static let image: Set<String> = ["jpg", "jpeg", "heic", "heif", "hif", "png", "tif", "tiff", "webp"]

    static func isSupported(_ url: URL) -> Bool {
        let ext = url.pathExtension.lowercased()
        return raw.contains(ext) || image.contains(ext)
    }
}

enum ColorLabel: String, CaseIterable {
    case red = "Red", yellow = "Yellow", green = "Green", blue = "Blue", purple = "Purple"

    var color: NSColor {
        switch self {
        case .red: return NSColor(calibratedRed: 0.93, green: 0.27, blue: 0.27, alpha: 1)
        case .yellow: return NSColor(calibratedRed: 0.98, green: 0.80, blue: 0.20, alpha: 1)
        case .green: return NSColor(calibratedRed: 0.30, green: 0.78, blue: 0.40, alpha: 1)
        case .blue: return NSColor(calibratedRed: 0.28, green: 0.55, blue: 0.97, alpha: 1)
        case .purple: return NSColor(calibratedRed: 0.66, green: 0.42, blue: 0.93, alpha: 1)
        }
    }

    /// Lightroom / Bridge keyboard convention: 6 red, 7 yellow, 8 green, 9 blue.
    static func forKey(_ digit: Int) -> ColorLabel? {
        switch digit {
        case 6: return .red
        case 7: return .yellow
        case 8: return .green
        case 9: return .blue
        default: return nil
        }
    }
}

/// Which half of a RAW+JPEG pair the browser shows and acts on.
enum FileScope: Int, CaseIterable {
    case both, raw, jpeg

    var title: String {
        switch self {
        case .both: return "RAW + JPG"
        case .raw: return "RAW Only"
        case .jpeg: return "JPG Only"
        }
    }
}

struct PhotoMetadata {
    var captureDate: Date?
    var orientation = 1
    var camera = ""
    var lens = ""
    var exposureTime: Double?
    var fNumber: Double?
    var iso: Int?
    var focalLength: Double?
    var pixelWidth = 0
    var pixelHeight = 0
}

/// One "photo" in the contact sheet. A RAW+JPEG pair shot together is a single photo.
///
/// Threading: culling state (rating/label/tagged) is only touched on the main thread.
/// Capture metadata is read lazily from any thread behind a lock.
final class Photo {
    let baseName: String
    let directory: URL

    // File URLs can change (move / trash one half of a pair) while decoders read them.
    private let fileLock = NSLock()
    private var _raw: URL?
    private var _jpeg: URL?
    var raw: URL? {
        get { fileLock.withLock { _raw } }
        set { fileLock.withLock { _raw = newValue } }
    }
    var jpeg: URL? {
        get { fileLock.withLock { _jpeg } }
        set { fileLock.withLock { _jpeg = newValue } }
    }

    // Culling state and captions (persisted to the XMP sidecar) — main thread only.
    var rating = 0
    var label: ColorLabel?
    var tagged = false
    var iptc = IPTCInfo()

    private let metaLock = NSLock()
    private var _metadata: PhotoMetadata?

    init(baseName: String, directory: URL) {
        self.baseName = baseName
        self.directory = directory
    }

    var primary: URL { raw ?? jpeg! }
    var isRaw: Bool { raw != nil }
    var isPair: Bool { raw != nil && jpeg != nil }
    var displayName: String { primary.lastPathComponent }
    var sidecar: URL { directory.appendingPathComponent(baseName + ".xmp") }
    var cacheKey: String { primary.path }

    /// Every file on disk that belongs to this photo (RAW, JPEG, sidecar).
    var allFiles: [URL] {
        var urls = [raw, jpeg].compactMap { $0 }
        if FileManager.default.fileExists(atPath: sidecar.path) { urls.append(sidecar) }
        return urls
    }

    var typeBadge: String {
        let ext = primary.pathExtension.uppercased()
        return isPair ? "\(ext)+JPG" : ext
    }

    func has(_ scope: FileScope) -> Bool {
        switch scope {
        case .both: return true
        case .raw: return raw != nil
        case .jpeg: return jpeg != nil
        }
    }

    func typeBadge(for scope: FileScope) -> String {
        switch scope {
        case .both: return typeBadge
        case .raw: return raw?.pathExtension.uppercased() ?? typeBadge
        case .jpeg: return jpeg?.pathExtension.uppercased() ?? typeBadge
        }
    }

    /// The file to open / reveal / drag for a scope.
    func primary(for scope: FileScope) -> URL {
        switch scope {
        case .both, .raw: return raw ?? primary
        case .jpeg: return jpeg ?? primary
        }
    }

    /// Files a copy/move/trash acts on. The sidecar travels with the RAW (it describes the RAW);
    /// a JPEG-only operation leaves it behind, since captions are embedded in the JPEG itself.
    func files(for scope: FileScope) -> [URL] {
        switch scope {
        case .both: return allFiles
        case .raw:
            guard let raw else { return [] }
            let sidecarExists = FileManager.default.fileExists(atPath: sidecar.path)
            return sidecarExists ? [raw, sidecar] : [raw]
        case .jpeg:
            return jpeg.map { [$0] } ?? []
        }
    }

    // MARK: Metadata

    var metadataLoaded: Bool {
        metaLock.lock(); defer { metaLock.unlock() }
        return _metadata != nil
    }

    /// Capture metadata, read from the file header on first access (~1.5 ms).
    var metadata: PhotoMetadata {
        metaLock.lock(); defer { metaLock.unlock() }
        if let m = _metadata { return m }
        let m = Photo.readMetadata(primary)
        _metadata = m
        return m
    }

    var captureDate: Date? { metadata.captureDate }
    var orientation: Int { metadata.orientation }
    var camera: String { metadata.camera }
    var lens: String { metadata.lens }
    var pixelWidth: Int { metadata.pixelWidth }
    var pixelHeight: Int { metadata.pixelHeight }

    private static func readMetadata(_ url: URL) -> PhotoMetadata {
        var m = PhotoMetadata()
        defer {
            if m.captureDate == nil {
                m.captureDate = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            }
        }
        guard let src = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else { return m }
        m.orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
        m.pixelWidth = props[kCGImagePropertyPixelWidth] as? Int ?? 0
        m.pixelHeight = props[kCGImagePropertyPixelHeight] as? Int ?? 0
        if let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] {
            m.camera = (tiff[kCGImagePropertyTIFFModel] as? String ?? "").trimmingCharacters(in: .whitespaces)
        }
        if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] {
            m.exposureTime = exif[kCGImagePropertyExifExposureTime] as? Double
            m.fNumber = exif[kCGImagePropertyExifFNumber] as? Double
            m.focalLength = exif[kCGImagePropertyExifFocalLength] as? Double
            // Canon (and others) may record ISO only as Recommended Exposure Index.
            m.iso = (exif[kCGImagePropertyExifISOSpeedRatings] as? [Int])?.first
                ?? exif[kCGImagePropertyExifRecommendedExposureIndex] as? Int
                ?? exif[kCGImagePropertyExifISOSpeed] as? Int
            m.lens = exif[kCGImagePropertyExifLensModel] as? String ?? ""
            if let s = exif[kCGImagePropertyExifDateTimeOriginal] as? String {
                m.captureDate = parseExifDate(s, subsec: exif[kCGImagePropertyExifSubsecTimeOriginal] as? String)
            }
        }
        return m
    }

    static func parseExifDate(_ s: String, subsec: String?) -> Date? {
        // "2026:08:22 09:45:27" — parsed by hand: DateFormatter is far too slow for thousands of files.
        let parts = s.split(whereSeparator: { $0 == ":" || $0 == " " }).compactMap { Int($0) }
        guard parts.count >= 6 else { return nil }
        var c = DateComponents()
        (c.year, c.month, c.day, c.hour, c.minute, c.second) = (parts[0], parts[1], parts[2], parts[3], parts[4], parts[5])
        guard var date = Calendar.current.date(from: c) else { return nil }
        if let subsec, let v = Double("0." + subsec.trimmingCharacters(in: .whitespaces)) {
            date.addTimeInterval(v)
        }
        return date
    }

    // MARK: Display strings

    var exifSummary: String {
        let m = metadata
        var bits: [String] = []
        if let f = m.focalLength { bits.append(String(format: "%gmm", f)) }
        if let t = m.exposureTime, t > 0 { bits.append(t >= 0.5 ? String(format: "%g\"", t) : "1/\(Int((1 / t).rounded()))") }
        if let n = m.fNumber { bits.append(String(format: "f/%g", n)) }
        if let iso = m.iso { bits.append("ISO \(iso)") }
        return bits.joined(separator: "  ·  ")
    }

    static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d, yyyy  h:mm:ss.SS a"
        return f
    }()
}
