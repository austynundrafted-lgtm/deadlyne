import AppKit

/// The photographer's optional profile. It lives only on this Mac (UserDefaults + an avatar file
/// in Application Support) — there is no account. Deadlyne uses it to greet the user and to
/// fill Photographer, Credit and Copyright into captions with one command.
struct Profile: Codable, Equatable {
    var name = ""
    /// IPTC Credit, e.g. "Austyn McFadden Photography" or a publication.
    var creditLine = ""
    /// Copyright notice. `{year}` becomes each photo's capture year, `{name}` the name above.
    var copyright = Profile.defaultCopyright
    var email = ""
    var website = ""

    static let defaultCopyright = "© {year} {name}"
    static let didChange = Notification.Name("DeadlyneProfileDidChange")
    private static let key = "profile"

    static var current: Profile? {
        get {
            guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
            return try? JSONDecoder().decode(Profile.self, from: data)
        }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
                saveAvatar(nil)
            }
            NotificationCenter.default.post(name: didChange, object: nil)
        }
    }

    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }

    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        return parts.compactMap(\.first).map { String($0).uppercased() }.joined()
    }

    func copyrightNotice(year: Int) -> String {
        copyright.replacingOccurrences(of: "{year}", with: String(year), options: .caseInsensitive)
            .replacingOccurrences(of: "{name}", with: name, options: .caseInsensitive)
            .trimmingCharacters(in: .whitespaces)
    }

    /// Photographer / Credit / Copyright for one photo; empty profile fields are left out.
    func captionFields(captureDate: Date?) -> [IPTCField: String] {
        let year = Calendar.current.component(.year, from: captureDate ?? Date())
        var out: [IPTCField: String] = [:]
        let name = name.trimmingCharacters(in: .whitespaces)
        let credit = creditLine.trimmingCharacters(in: .whitespaces)
        if !name.isEmpty { out[.creator] = name }
        if !credit.isEmpty { out[.credit] = credit }
        let notice = copyrightNotice(year: year)
        if !notice.isEmpty, notice != "©" { out[.copyright] = notice }
        return out
    }

    // MARK: Avatar

    static var avatarURL: URL { CodeReplacements.supportDirectory.appendingPathComponent("Avatar.png") }

    private static var cachedAvatar: NSImage??

    static var avatar: NSImage? {
        if let cachedAvatar { return cachedAvatar }
        let img = NSImage(contentsOf: avatarURL)
        cachedAvatar = .some(img)
        return img
    }

    /// Stores a square, 256 px crop of `image` (or deletes the avatar when nil).
    static func saveAvatar(_ image: NSImage?) {
        cachedAvatar = nil
        let fm = FileManager.default
        guard let image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            try? fm.removeItem(at: avatarURL)
            return
        }
        let side = min(cg.width, cg.height)
        let crop = CGRect(x: (cg.width - side) / 2, y: (cg.height - side) / 2, width: side, height: side)
        guard let square = cg.cropping(to: crop),
              let ctx = CGContext(data: nil, width: 256, height: 256, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
        ctx.interpolationQuality = .high
        ctx.draw(square, in: CGRect(x: 0, y: 0, width: 256, height: 256))
        guard let out = ctx.makeImage(),
              let png = NSBitmapImageRep(cgImage: out).representation(using: .png, properties: [:]) else { return }
        try? fm.createDirectory(at: avatarURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? png.write(to: avatarURL, options: .atomic)
    }
}
