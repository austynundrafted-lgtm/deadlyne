import Foundation

/// A milestone badge. Artwork is `Badges/<id>.png` (see Resources/Badges/README.md); until it
/// exists, Deadlyne draws a placeholder medallion.
struct Badge: Equatable {
    enum Track: String, CaseIterable {
        case photos, shoots

        var title: String { self == .photos ? "Photos Ingested" : "Shoots" }
        func unit(_ n: Int) -> String {
            switch self {
            case .photos: return n == 1 ? "photo" : "photos"
            case .shoots: return n == 1 ? "shoot" : "shoots"
            }
        }
    }

    let id: String
    let track: Track
    let threshold: Int
    let name: String
    /// 0 bronze, 1 silver, 2 gold, 3 elite — only the placeholder art uses it.
    let tier: Int

    /// "100", "2.5K", "10K", "1M" — for the placeholder medallion.
    var shortThreshold: String {
        if threshold >= 1_000_000 { return "\(threshold / 1_000_000)M" }
        if threshold >= 1_000 {
            return threshold % 1_000 == 0 ? "\(threshold / 1_000)K" : String(format: "%.1fK", Double(threshold) / 1_000)
        }
        return "\(threshold)"
    }
}

/// Every badge, in order. Rename them or change thresholds here — the id is the artwork file name,
/// so keep ids stable once artwork exists (earned badges are stored by id).
enum Badges {
    static let photos: [Badge] = {
        let ladder: [(Int, String)] = [
            (100, "Warm-Up"), (500, "Kickoff"), (1_000, "First Thousand"), (2_500, "Game Day"),
            (5_000, "Starter"), (10_000, "Varsity"), (25_000, "All-Conference"), (50_000, "All-State"),
            (100_000, "Hall of Fame"), (250_000, "Legend"), (500_000, "Dynasty"), (1_000_000, "The Million"),
        ]
        return ladder.enumerated().map { i, step in
            Badge(id: "photos-\(step.0)", track: .photos, threshold: step.0, name: step.1, tier: min(3, i / 3))
        }
    }()

    static let shoots: [Badge] = {
        let ladder: [(Int, String, Int)] = [
            (1, "First Shoot", 0), (10, "Double Digits", 0), (25, "Season Pass", 1),
            (50, "Road Warrior", 1), (100, "Centurion", 2), (250, "Iron Lens", 3),
        ]
        return ladder.map { Badge(id: "shoots-\($0.0)", track: .shoots, threshold: $0.0, name: $0.1, tier: $0.2) }
    }()

    static let all = photos + shoots
}

struct AchievementState: Codable {
    /// Lifetime photos brought into Deadlyne. Never goes down, even if photos are deleted later.
    var photos = 0
    var shoots = 0
    /// Photos already counted per folder (a high-water mark), so reopening a shoot or
    /// re-ingesting the same card never counts a photo twice.
    var folders: [String: Int] = [:]
    var earned: [String: Date] = [:]
    /// Photos and new shoots per calendar month, keyed "2026-09".
    var months: [String: MonthTally]?

    struct MonthTally: Codable {
        var photos = 0
        var shoots = 0
    }

    func value(_ track: Badge.Track) -> Int { track == .photos ? photos : shoots }

    var thisMonth: MonthTally { months?[Self.monthKey(Date())] ?? MonthTally() }

    static func monthKey(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
    }

    fileprivate mutating func addToMonth(photos: Int, shoots: Int) {
        let key = Self.monthKey(Date())
        var t = months?[key] ?? MonthTally()
        t.photos += photos
        t.shoots += shoots
        months = (months ?? [:]).merging([key: t]) { $1 }
    }
}

/// Counts photos as they come into Deadlyne and awards milestone badges. Main thread only.
///
/// A photo counts when it's ingested from a card, or when a folder containing it is opened for
/// the first time. A RAW+JPG pair is one photo.
enum Achievements {
    static let didChange = Notification.Name("DeadlyneAchievementsDidChange")
    /// Posted with the newly earned `[Badge]` as the object.
    static let didUnlock = Notification.Name("DeadlyneBadgesUnlocked")
    private static let key = "achievements"
    private static var cached: AchievementState?

    static var state: AchievementState {
        if let cached { return cached }
        if let data = UserDefaults.standard.data(forKey: key),
           var s = try? JSONDecoder().decode(AchievementState.self, from: data) {
            if s.months == nil {
                // Saved before monthly tallies existed: credit the totals to the month counting began.
                let start = s.earned.values.min() ?? Date()
                s.months = [AchievementState.monthKey(start): .init(photos: s.photos, shoots: s.shoots)]
                save(s)
            }
            cached = s
            return s
        }
        // First run with achievements: credit the shoots already opened, quietly.
        var s = AchievementState()
        for shoot in RecentShoots.all {
            guard let n = shoot.photoCount, n > 0 else { continue }
            s.folders[shoot.path] = n
            s.photos += n
            s.shoots += 1
        }
        _ = award(&s)
        save(s)
        return s
    }

    static func isEarned(_ b: Badge) -> Bool { state.earned[b.id] != nil }

    /// The next badge to earn on a track, or nil when all are earned.
    static func next(_ track: Badge.Track) -> Badge? {
        let value = state.value(track)
        return Badges.all.first { $0.track == track && value < $0.threshold }
    }

    /// Earned badges, oldest first.
    static var earned: [Badge] {
        let s = state
        return Badges.all.filter { s.earned[$0.id] != nil }
            .sorted { (s.earned[$0.id]!, $0.threshold) < (s.earned[$1.id]!, $1.threshold) }
    }

    /// A folder was opened and holds `count` photos. Only photos beyond what was already
    /// counted for this folder are added.
    static func recordFolder(_ url: URL, photos count: Int) {
        let key = url.standardizedFileURL.path
        let old = state.folders[key] ?? 0
        guard count > old else { return }
        mutate { s in
            let isNew = s.folders[key] == nil
            if isNew { s.shoots += 1 }
            s.folders[key] = count
            s.photos += count - old
            s.addToMonth(photos: count - old, shoots: isNew ? 1 : 0)
        }
    }

    /// Photos copied by an ingest, keyed by destination folder path.
    static func recordIngest(_ perFolder: [String: Int]) {
        let added = perFolder.filter { $0.value > 0 }
        guard !added.isEmpty else { return }
        mutate { s in
            for (path, n) in added {
                let key = URL(fileURLWithPath: path).standardizedFileURL.path
                let isNew = s.folders[key] == nil
                if isNew { s.shoots += 1 }
                s.folders[key, default: 0] += n
                s.photos += n
                s.addToMonth(photos: n, shoots: isNew ? 1 : 0)
            }
        }
    }

    private static func mutate(_ change: (inout AchievementState) -> Void) {
        var s = state
        change(&s)
        let unlocked = award(&s)
        save(s)
        NotificationCenter.default.post(name: didChange, object: nil)
        if !unlocked.isEmpty { NotificationCenter.default.post(name: didUnlock, object: unlocked) }
    }

    private static func award(_ s: inout AchievementState) -> [Badge] {
        let now = Date()
        var new: [Badge] = []
        for b in Badges.all where s.value(b.track) >= b.threshold && s.earned[b.id] == nil {
            s.earned[b.id] = now
            new.append(b)
        }
        return new
    }

    private static func save(_ s: AchievementState) {
        cached = s
        if let data = try? JSONEncoder().encode(s) { UserDefaults.standard.set(data, forKey: key) }
    }

    static let numberFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        return f
    }()
}

extension Int {
    /// "2,191"
    var grouped: String { Achievements.numberFormatter.string(from: NSNumber(value: self)) ?? String(self) }
}
