import Foundation

/// One-time carry-over from the app's former name, LensDesk (bundle ID `app.lensdesk.LensDesk`):
/// settings (last folder, filters, caption format, window frame…) and the code replacements file.
/// Must run before anything reads UserDefaults.
enum LegacyMigration {
    static let oldDomain = "app.lensdesk.LensDesk"
    private static let doneKey = "migratedFromLensDesk"

    static func run() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: doneKey) else { return }
        defer { defaults.set(true, forKey: doneKey) }

        for (key, value) in settingsToCopy() where defaults.object(forKey: key) == nil {
            defaults.set(value, forKey: key)
        }

        let fm = FileManager.default
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let oldCodes = support.appendingPathComponent("LensDesk/CodeReplacements.txt")
        let newCodes = CodeReplacements.legacyFileURL
        if fm.fileExists(atPath: oldCodes.path), !fm.fileExists(atPath: newCodes.path) {
            try? fm.createDirectory(at: newCodes.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? fm.copyItem(at: oldCodes, to: newCodes)
        }
    }

    /// Old settings keyed as the new app expects them (the window frame key changed name).
    static func settingsToCopy() -> [String: Any] {
        guard let old = UserDefaults.standard.persistentDomain(forName: oldDomain) else { return [:] }
        var out: [String: Any] = [:]
        for (key, value) in old {
            out[key == "NSWindow Frame LensDeskMain" ? "NSWindow Frame DeadlyneMain" : key] = value
        }
        return out
    }
}
