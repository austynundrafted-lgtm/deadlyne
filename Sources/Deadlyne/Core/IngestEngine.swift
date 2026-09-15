import Foundation

/// Expands folder / file name templates for one photo.
/// Tokens: {job} {date} {year} {month} {day} {time} {seq} {original} {camera}
struct IngestNaming {
    var job: String
    var folderPattern: String
    var renamePattern: String?

    func names(original: String, date: Date, camera: String, seq: Int) -> (folder: String, base: String) {
        let c = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let two = { (n: Int?) in String(format: "%02d", n ?? 0) }
        let tokens: [String: String] = [
            "{job}": job.isEmpty ? "Untitled" : job,
            "{date}": "\(c.year ?? 0)-\(two(c.month))-\(two(c.day))",
            "{year}": "\(c.year ?? 0)",
            "{month}": two(c.month),
            "{day}": two(c.day),
            "{time}": two(c.hour) + two(c.minute) + two(c.second),
            "{seq}": String(format: "%04d", seq),
            "{original}": original,
            "{camera}": camera.replacingOccurrences(of: " ", with: ""),
        ]
        func expand(_ pattern: String) -> String {
            var s = pattern
            for (k, v) in tokens { s = s.replacingOccurrences(of: k, with: v) }
            return s.replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespaces)
        }
        var folder = expand(folderPattern)
        // A job-less template like "{date}_{job}" shouldn't leave a dangling "_Untitled".
        if job.isEmpty { folder = folder.replacingOccurrences(of: "_Untitled", with: "").replacingOccurrences(of: "-Untitled", with: "") }
        let base = renamePattern.map(expand).flatMap { $0.isEmpty ? nil : $0 } ?? original
        return (folder.isEmpty ? "Ingest" : folder, base)
    }
}

/// The ingest options, shared by the Ingest window and Home's "Ingest setup" row.
enum IngestSettings {
    /// Post after changing settings so Home can redraw its summary.
    static let didChange = Notification.Name("DeadlyneIngestSettingsDidChange")
    private static var defaults: UserDefaults { .standard }

    static var destination: URL? {
        get { defaults.string(forKey: "ingestDestination").map { URL(fileURLWithPath: $0) } }
        set { defaults.set(newValue?.path, forKey: "ingestDestination") }
    }
    static var job: String {
        get { defaults.string(forKey: "ingestJob") ?? "" }
        set { defaults.set(newValue, forKey: "ingestJob") }
    }
    static var folderPattern: String {
        get { defaults.string(forKey: "ingestFolder") ?? "{date}_{job}" }
        set { defaults.set(newValue, forKey: "ingestFolder") }
    }
    static var renamePattern: String {
        get { defaults.string(forKey: "ingestRename") ?? "{job}_{seq}" }
        set { defaults.set(newValue, forKey: "ingestRename") }
    }
    static var renameOn: Bool {
        get { defaults.bool(forKey: "ingestRenameOn") }
        set { defaults.set(newValue, forKey: "ingestRenameOn") }
    }
    static var skipExisting: Bool {
        get { defaults.object(forKey: "ingestSkip") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "ingestSkip") }
    }
    static var ejectWhenDone: Bool {
        get { defaults.bool(forKey: "ingestEject") }
        set { defaults.set(newValue, forKey: "ingestEject") }
    }

    /// The job name as used in file names.
    static func sanitizedJob(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "/", with: "-")
    }

    static func notify() { NotificationCenter.default.post(name: didChange, object: nil) }
}

struct IngestProgress {
    var filesDone = 0, filesTotal = 0
    var bytesDone: Int64 = 0, bytesTotal: Int64 = 0
    var currentFile = ""
    /// Name of the job folder the current file goes into.
    var folder = ""

    var fraction: Double { bytesTotal > 0 ? min(1, Double(bytesDone) / Double(bytesTotal)) : 0 }
    var message: String { "Copying \(filesDone) of \(filesTotal) — \(currentFile)" }
}

/// The ingest running right now, if any, so Home can show its progress. Main thread only.
enum IngestActivity {
    struct Job {
        var source: URL
        var destination: URL
        /// Nil while the card is still being scanned.
        var progress: IngestProgress?
        /// When copying began (after the scan); used for the time estimate.
        var copyStarted: Date?
    }

    /// Posted when an ingest starts or ends.
    static let didChange = Notification.Name("DeadlyneIngestActivityDidChange")
    /// Posted as files are copied (up to ~10 times a second).
    static let didProgress = Notification.Name("DeadlyneIngestActivityDidProgress")
    private(set) static var current: Job?
    private static var stopHandler: (() -> Void)?

    static func begin(source: URL, destination: URL, stop: @escaping () -> Void) {
        current = Job(source: source, destination: destination)
        stopHandler = stop
        NotificationCenter.default.post(name: didChange, object: nil)
    }

    static func update(_ p: IngestProgress) {
        guard current != nil else { return }
        current?.progress = p
        if current?.copyStarted == nil, p.filesTotal > 0 { current?.copyStarted = Date() }
        NotificationCenter.default.post(name: didProgress, object: nil)
    }

    static func end() {
        current = nil
        stopHandler = nil
        NotificationCenter.default.post(name: didChange, object: nil)
    }

    static func stop() { stopHandler?() }
}

/// What's on a connected memory card, for Home.
struct CardInfo {
    var camera: String
    /// A RAW+JPG pair counts once.
    var photos: Int
    var bytes: Int64
}

/// Copies photos from a card (or any folder, recursively) into template-named folders.
/// RAW+JPEG pairs share one sequence number; numbering follows capture time.
/// Never overwrites; verifies each copy's size.
enum IngestEngine {
    struct Summary {
        var copied = 0, skipped = 0, bytes: Int64 = 0
        var errors: [String] = []
        var firstFolder: URL?
        /// Photos (a RAW+JPG pair is one) with at least one file copied, per destination folder path.
        var copiedPhotos: [String: Int] = [:]
        var cancelled = false

        var message: String {
            let size = ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
            var s = cancelled ? "Stopped. " : "Done. "
            s += "Copied \(copied) file\(copied == 1 ? "" : "s") (\(size))"
            if skipped > 0 { s += ", skipped \(skipped) already ingested" }
            return s + "."
        }
    }

    /// Mounted volumes that look like camera cards (they contain a DCIM folder).
    static func memoryCards() -> [URL] {
        let volumes = FileManager.default.mountedVolumeURLs(includingResourceValuesForKeys: [.volumeNameKey],
                                                            options: [.skipHiddenVolumes]) ?? []
        return volumes.filter { FileManager.default.fileExists(atPath: $0.appendingPathComponent("DCIM").path) }
    }

    /// Counts the photos on a card and reads the camera model from one of them. Lists the
    /// DCIM folder and opens a single file header, so it's quick even for thousands of frames.
    static func inspect(card: URL) -> CardInfo {
        let walker = FileManager.default.enumerator(at: card.appendingPathComponent("DCIM"),
                                                    includingPropertiesForKeys: [.fileSizeKey],
                                                    options: [.skipsHiddenFiles, .skipsPackageDescendants])
        var bases = Set<String>()
        var bytes: Int64 = 0
        var sample: URL?
        while let url = walker?.nextObject() as? URL {
            guard FileTypes.isSupported(url) else { continue }
            bases.insert(url.deletingLastPathComponent().path + "/" + url.deletingPathExtension().lastPathComponent.lowercased())
            bytes += Int64((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
            if sample == nil || (FileTypes.raw.contains(url.pathExtension.lowercased()) && !FileTypes.raw.contains(sample!.pathExtension.lowercased())) {
                sample = url
            }
        }
        var camera = ""
        if let sample {
            let p = Photo(baseName: sample.deletingPathExtension().lastPathComponent, directory: sample.deletingLastPathComponent())
            if FileTypes.raw.contains(sample.pathExtension.lowercased()) { p.raw = sample } else { p.jpeg = sample }
            camera = p.camera
        }
        return CardInfo(camera: camera, photos: bases.count, bytes: bytes)
    }

    static func run(source: URL, destination: URL, naming: IngestNaming, skipExisting: Bool, firstSeq: Int,
                    isCancelled: () -> Bool, progress: (IngestProgress) -> Void) -> Summary {
        let fm = FileManager.default
        var summary = Summary()

        var groups: [String: Photo] = [:]
        let walker = fm.enumerator(at: source, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
                                   options: [.skipsHiddenFiles, .skipsPackageDescendants])
        while let url = walker?.nextObject() as? URL {
            guard FileTypes.isSupported(url) else { continue }
            let dir = url.deletingLastPathComponent()
            let base = url.deletingPathExtension().lastPathComponent
            let key = dir.path + "/" + base.lowercased()
            let p = groups[key] ?? Photo(baseName: base, directory: dir)
            groups[key] = p
            if FileTypes.raw.contains(url.pathExtension.lowercased()) { p.raw = url } else { p.jpeg = url }
        }
        let photos = Array(groups.values)
        DispatchQueue.concurrentPerform(iterations: photos.count) { i in _ = photos[i].metadata }
        let ordered = photos.sorted { ($0.captureDate ?? .distantPast, $0.baseName) < ($1.captureDate ?? .distantPast, $1.baseName) }

        var files: [(src: URL, photo: Photo, seq: Int)] = []
        for (i, p) in ordered.enumerated() {
            for f in [p.raw, p.jpeg].compactMap({ $0 }) { files.append((f, p, firstSeq + i)) }
        }
        let sizes = files.map { Int64((try? $0.src.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0) }
        let totalBytes = sizes.reduce(0, +)
        var doneBytes: Int64 = 0
        progress(IngestProgress(filesTotal: files.count, bytesTotal: totalBytes))
        var lastUpdate = Date.distantPast
        var countedPhotos = Set<ObjectIdentifier>()

        for (k, file) in files.enumerated() {
            if isCancelled() { summary.cancelled = true; break }
            let (folderName, baseName) = naming.names(original: file.photo.baseName, date: file.photo.captureDate ?? Date(),
                                                      camera: file.photo.camera, seq: file.seq)
            let folder = destination.appendingPathComponent(folderName, isDirectory: true)
            let target = folder.appendingPathComponent(baseName + "." + file.src.pathExtension)
            if summary.firstFolder == nil { summary.firstFolder = folder }
            do {
                try fm.createDirectory(at: folder, withIntermediateDirectories: true)
                if fm.fileExists(atPath: target.path) {
                    let existing = Int64((try? target.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? -1)
                    if skipExisting && existing == sizes[k] {
                        summary.skipped += 1
                    } else {
                        summary.errors.append("\(target.lastPathComponent) already exists at the destination")
                    }
                } else {
                    try fm.copyItem(at: file.src, to: target)
                    let copied = Int64((try? target.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? -1)
                    if copied != sizes[k] { summary.errors.append("\(target.lastPathComponent): size mismatch after copy") }
                    summary.copied += 1
                    summary.bytes += sizes[k]
                    if countedPhotos.insert(ObjectIdentifier(file.photo)).inserted {
                        summary.copiedPhotos[folder.path, default: 0] += 1
                    }
                }
            } catch {
                summary.errors.append("\(file.src.lastPathComponent): \(error.localizedDescription)")
            }
            doneBytes += sizes[k]
            if Date().timeIntervalSince(lastUpdate) > 0.1 || k == files.count - 1 {
                lastUpdate = Date()
                progress(IngestProgress(filesDone: k + 1, filesTotal: files.count, bytesDone: doneBytes, bytesTotal: totalBytes,
                                        currentFile: file.src.lastPathComponent, folder: folderName))
            }
        }
        if files.isEmpty { summary.errors.append("No photos found in \(source.path)") }
        return summary
    }
}
