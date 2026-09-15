import Foundation

enum FolderLoader {
    /// Lists a folder and groups files that share a base name (MCD_0001.CR3 + MCD_0001.JPG)
    /// into one photo. Cheap: no file is opened here.
    static func scan(_ folder: URL) -> [Photo] {
        let fm = FileManager.default
        guard let urls = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isRegularFileKey],
                                                     options: [.skipsHiddenFiles]) else { return [] }
        var byBase: [String: Photo] = [:]
        for url in urls where FileTypes.isSupported(url) {
            let base = url.deletingPathExtension().lastPathComponent
            let key = base.lowercased()
            let photo = byBase[key] ?? Photo(baseName: base, directory: folder)
            byBase[key] = photo
            let ext = url.pathExtension.lowercased()
            if FileTypes.raw.contains(ext) {
                photo.raw = url
            } else if photo.jpeg == nil || ext == "jpg" || ext == "jpeg" {
                photo.jpeg = url
            }
        }
        return byBase.values.sorted { $0.baseName.localizedStandardCompare($1.baseName) == .orderedAscending }
    }

    struct Loaded {
        var culling: XMPSidecar.Values?
        var iptc = IPTCInfo()
    }

    /// Reads EXIF, sidecars and captions for every photo in parallel across all cores.
    /// Returns values (index-aligned) for the caller to apply on the main thread.
    static func loadMetadata(_ photos: [Photo], progress: @escaping (Int) -> Void) -> [Loaded] {
        let done = ManagedAtomicCounter()
        var results = [Loaded](repeating: Loaded(), count: photos.count)
        results.withUnsafeMutableBufferPointer { out in
            let buffer = out
            DispatchQueue.concurrentPerform(iterations: photos.count) { i in
                let p = photos[i]
                _ = p.metadata
                var loaded = Loaded()
                if let (values, iptc) = XMPSidecar.readAll(p.sidecar) {
                    loaded.culling = values
                    loaded.iptc = iptc
                }
                // JPEG-only photos keep their captions inside the file.
                if loaded.iptc.isEmpty, p.raw == nil, let jpeg = p.jpeg {
                    loaded.iptc = JPEGMetadata.readIPTC(from: jpeg)
                }
                buffer[i] = loaded
                let n = done.increment()
                if n % 250 == 0 { progress(n) }
            }
        }
        return results
    }
}

final class ManagedAtomicCounter {
    private var value = 0
    private let lock = NSLock()

    func increment() -> Int {
        lock.lock(); defer { lock.unlock() }
        value += 1
        return value
    }
}
