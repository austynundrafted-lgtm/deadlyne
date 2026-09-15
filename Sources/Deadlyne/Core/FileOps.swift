import Foundation

/// Copy / move / trash for photos. Each item names the exact files to act on, so the caller
/// decides whether a RAW+JPEG pair travels together or only one half does.
/// Never overwrites: files already present at the destination are skipped.
enum FileOps {
    struct Item {
        let photo: Photo
        let files: [URL]
    }

    struct Result {
        /// Photos whose files were all handled.
        var completed: [Photo] = []
        /// Every file actually copied / moved / trashed.
        var handledFiles: [URL] = []
        var skipped = 0
        var errors: [String] = []
        var files: Int { handledFiles.count }
    }

    static func transfer(_ items: [Item], to dest: URL, move: Bool, progress: (Int) -> Void) -> Result {
        let fm = FileManager.default
        var r = Result()
        for (n, item) in items.enumerated() {
            var ok = true
            for src in item.files {
                let target = dest.appendingPathComponent(src.lastPathComponent)
                if fm.fileExists(atPath: target.path) {
                    r.skipped += 1
                    ok = false
                    continue
                }
                do {
                    if move { try fm.moveItem(at: src, to: target) } else { try fm.copyItem(at: src, to: target) }
                    r.handledFiles.append(src)
                } catch {
                    r.errors.append("\(src.lastPathComponent): \(error.localizedDescription)")
                    ok = false
                }
            }
            if ok || !move { r.completed.append(item.photo) }
            if n % 5 == 4 { progress(n + 1) }
        }
        return r
    }

    /// Moves files to the Trash (recoverable) — never deletes permanently.
    static func trash(_ items: [Item]) -> Result {
        var r = Result()
        for item in items {
            var ok = true
            for url in item.files {
                do {
                    try FileManager.default.trashItem(at: url, resultingItemURL: nil)
                    r.handledFiles.append(url)
                } catch {
                    r.errors.append("\(url.lastPathComponent): \(error.localizedDescription)")
                    ok = false
                }
            }
            if ok { r.completed.append(item.photo) }
        }
        return r
    }
}
