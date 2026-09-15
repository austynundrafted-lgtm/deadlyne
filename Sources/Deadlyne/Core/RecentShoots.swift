import AppKit

/// A folder the user has opened, remembered for the home screen.
struct RecentShoot: Codable, Equatable {
    var path: String
    var lastOpened: Date
    var photoCount: Int?
    var taggedCount: Int?
    var fiveStarCount: Int?
    /// How far culling got: the furthest frame reached, in the browser's order.
    var reviewedCount: Int?
    /// Base name of the photo selected last, so opening the shoot again resumes there.
    var lastPhoto: String?
    /// Base name of the photo to show as the cover (the best-rated or a tagged frame), if any.
    var coverName: String?
    /// Pinned shoots sit above the rest and are never pushed off the list.
    var pinned: Bool?

    var url: URL { URL(fileURLWithPath: path) }
    var name: String { url.lastPathComponent }
    var isPinned: Bool { pinned == true }
    var display: ShootName { ShootName(name) }
}

/// Recently opened shoots: pinned first, then newest first. Stored in UserDefaults; small by design.
enum RecentShoots {
    static let didChange = Notification.Name("DeadlyneRecentShootsDidChange")
    private static let key = "recentShoots"
    /// Unpinned shoots kept.
    private static let limit = 12

    static var all: [RecentShoot] {
        let defaults = UserDefaults.standard
        if let data = defaults.data(forKey: key),
           let list = try? JSONDecoder().decode([RecentShoot].self, from: data) {
            return list
        }
        // First run with the home screen: start from the folders the app already knows.
        var seed: [URL] = NSDocumentController.shared.recentDocumentURLs
        if let last = defaults.string(forKey: "lastFolder") { seed.insert(URL(fileURLWithPath: last), at: 0) }
        var seen = Set<String>()
        let list = seed.filter { url in
            var isDir: ObjCBool = false
            return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && isDir.boolValue
                && seen.insert(url.standardizedFileURL.path).inserted
        }.enumerated().map { RecentShoot(path: $1.standardizedFileURL.path, lastOpened: Date().addingTimeInterval(-Double($0))) }
        return save(list, notify: false)
    }

    /// Moves `url` to the front of the list.
    static func noteOpened(_ url: URL) {
        let path = url.standardizedFileURL.path
        var list = all
        var entry = list.first { $0.path == path } ?? RecentShoot(path: path, lastOpened: Date())
        entry.lastOpened = Date()
        list.removeAll { $0.path == path }
        list.insert(entry, at: 0)
        save(list)
    }

    /// Records what the browser learned about a shoot. Does nothing if the shoot isn't listed.
    static func update(_ url: URL, _ change: (inout RecentShoot) -> Void) {
        let path = url.standardizedFileURL.path
        var list = all
        guard let i = list.firstIndex(where: { $0.path == path }) else { return }
        var e = list[i]
        change(&e)
        guard e != list[i] else { return }
        list[i] = e
        save(list)
    }

    static func setPinned(_ url: URL, _ pinned: Bool) {
        update(url) { $0.pinned = pinned ? true : nil }
    }

    static func remove(_ url: URL) {
        let path = url.standardizedFileURL.path
        save(all.filter { $0.path != path })
    }

    /// Clears everything except pinned shoots.
    static func clear() { save(all.filter(\.isPinned)) }

    @discardableResult
    private static func save(_ list: [RecentShoot], notify: Bool = true) -> [RecentShoot] {
        let kept = list.filter(\.isPinned) + list.filter { !$0.isPinned }.prefix(limit)
        if let data = try? JSONEncoder().encode(kept) { UserDefaults.standard.set(data, forKey: key) }
        if notify { NotificationCenter.default.post(name: didChange, object: nil) }
        return kept
    }
}
