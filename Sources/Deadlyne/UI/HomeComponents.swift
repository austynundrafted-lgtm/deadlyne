import AppKit

/// Building blocks for the home screen: clickable cards, the live activity panel, recent-shoot
/// rows, ingest setup cells, a reflowing tile grid, the profile chip, avatars and shortcut chips.

enum HomeStyle {
    /// Brand orange, from the triangle in the app icon.
    static let accent = NSColor(srgbRed: 1.0, green: 0.24, blue: 0.0, alpha: 1)
    static let accentLight = NSColor(srgbRed: 1.0, green: 0.42, blue: 0.17, alpha: 1)
    static let accentDark = NSColor(srgbRed: 0.84, green: 0.16, blue: 0.0, alpha: 1)
    static let cardFill = NSColor(white: 0.15, alpha: 1)
    static let cardHover = NSColor(white: 0.185, alpha: 1)
    static let panelFill = NSColor(white: 0.135, alpha: 1)
    static let panelBorder = NSColor(white: 0.21, alpha: 1)
    static let border = NSColor(white: 0.23, alpha: 1)
    static let borderHover = NSColor(white: 0.36, alpha: 1)
    static let title = NSColor(white: 0.94, alpha: 1)
    static let secondary = NSColor(white: 0.68, alpha: 1)
    static let tertiary = NSColor(white: 0.54, alpha: 1)
    static let ready = NSColor(srgbRed: 0.35, green: 0.9, blue: 0.45, alpha: 1)
    static let warning = NSColor(srgbRed: 1.0, green: 0.74, blue: 0.3, alpha: 1)
    static let danger = NSColor(srgbRed: 1.0, green: 0.45, blue: 0.4, alpha: 1)

    /// How a status line reads: plain, needs attention, or blocks the job.
    enum Tone {
        case normal, warning, danger

        var color: NSColor {
            switch self {
            case .normal: return HomeStyle.secondary
            case .warning: return HomeStyle.warning
            case .danger: return HomeStyle.danger
            }
        }
    }

    /// A borderless accent-colored text button ("View all shortcuts →").
    static func link(_ title: String, target: AnyObject?, action: Selector?) -> NSButton {
        let b = NSButton(title: title, target: target, action: action)
        b.isBordered = false
        setLinkTitle(b, title)
        return b
    }

    static func setLinkTitle(_ button: NSButton, _ title: String) {
        button.attributedTitle = NSAttributedString(string: title, attributes: [
            .font: NSFont.systemFont(ofSize: 12, weight: .semibold), .foregroundColor: accentLight,
        ])
    }

    static func bytes(_ n: Int64) -> String { ByteCountFormatter.string(fromByteCount: n, countStyle: .file) }

    /// "Just now", "2 hr. ago", "3 days ago".
    static func relative(_ date: Date) -> String {
        if Date().timeIntervalSince(date) < 60 { return "Just now" }
        return relativeFormatter.localizedString(for: date, relativeTo: Date())
    }

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()

    static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f
    }()
}

// MARK: - Hover control

/// A view that acts as one big button: hover and pressed states, a pointing-hand cursor,
/// and VoiceOver support. Subviews never swallow the click.
class HoverControl: NSView {
    var onClick: (() -> Void)?
    private(set) var isHovering = false
    private(set) var isPressed = false

    /// Called whenever the hover or pressed state changes.
    func stateChanged() {}

    override func hitTest(_ point: NSPoint) -> NSView? {
        !isHidden && frame.contains(point) ? self : nil
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
                                       owner: self))
    }

    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }

    override func mouseEntered(with event: NSEvent) { setHover(true) }
    override func mouseExited(with event: NSEvent) { setHover(false) }

    override func mouseDown(with event: NSEvent) { setPressed(true) }

    override func mouseDragged(with event: NSEvent) {
        setPressed(bounds.contains(convert(event.locationInWindow, from: nil)))
    }

    override func mouseUp(with event: NSEvent) {
        let inside = bounds.contains(convert(event.locationInWindow, from: nil))
        setPressed(false)
        if inside { onClick?() }
    }

    private func setHover(_ on: Bool) {
        guard on != isHovering else { return }
        isHovering = on
        stateChanged()
    }

    private func setPressed(_ on: Bool) {
        guard on != isPressed else { return }
        isPressed = on
        stateChanged()
    }

    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .button }
    override func accessibilityPerformPress() -> Bool {
        onClick?()
        return true
    }
}

// MARK: - Action card

/// A large home-screen card: icon, badge, title, a short description and an optional call to
/// action. The `.image` style shows a cover photo under a dark gradient.
final class HomeCard: HoverControl {
    enum Style { case accent, neutral, image }

    var title = "" {
        didSet { titleLabel.stringValue = title; setAccessibilityLabel(title) }
    }
    var subtitle = "" {
        didSet { subtitleLabel.stringValue = subtitle }
    }
    /// "Continue culling →", under the subtitle. Empty hides it.
    var callToAction = "" {
        didSet {
            ctaLabel.stringValue = callToAction
            ctaLabel.isHidden = callToAction.isEmpty
            subtitleLabel.maximumNumberOfLines = callToAction.isEmpty ? 2 : 1
        }
    }
    var symbol = "" {
        didSet { iconView.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) }
    }
    var image: CGImage? {
        didSet {
            backdrop.imageLayer.contents = image
            backdrop.shade.isHidden = image == nil
        }
    }
    /// A thin meter along the bottom edge (0…1). Nil hides it.
    var progress: Double? {
        didSet { backdrop.meter = progress }
    }
    let badge = PillLabel()

    private let style: Style
    private let backdrop = CardBackdrop()
    private let iconView = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let subtitleLabel = NSTextField(wrappingLabelWithString: "")
    private let ctaLabel = NSTextField(labelWithString: "")

    init(style: Style) {
        self.style = style
        super.init(frame: .zero)
        build()
        stateChanged()
    }

    required init?(coder: NSCoder) { fatalError() }

    private func build() {
        let light = style != .neutral
        iconView.symbolConfiguration = .init(pointSize: 22, weight: .medium)
        iconView.contentTintColor = light ? .white : HomeStyle.accent
        titleLabel.font = .systemFont(ofSize: 19, weight: .semibold)
        titleLabel.textColor = light ? .white : HomeStyle.title
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        subtitleLabel.font = .systemFont(ofSize: 12.5)
        subtitleLabel.textColor = light ? NSColor(white: 1, alpha: 0.85) : HomeStyle.secondary
        subtitleLabel.maximumNumberOfLines = 2
        subtitleLabel.cell?.truncatesLastVisibleLine = true
        subtitleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        ctaLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        ctaLabel.textColor = style == .image ? HomeStyle.accentLight : (light ? .white : HomeStyle.accentLight)
        ctaLabel.isHidden = true
        badge.textColor = light ? .white : NSColor(white: 0.76, alpha: 1)
        badge.fillColor = light ? NSColor(white: 1, alpha: 0.2) : NSColor(white: 1, alpha: 0.08)

        switch style {
        case .accent:
            backdrop.base.colors = [HomeStyle.accentLight.cgColor, HomeStyle.accentDark.cgColor]
            backdrop.base.startPoint = CGPoint(x: 0, y: 1)
            backdrop.base.endPoint = CGPoint(x: 1, y: 0)
        case .neutral:
            backdrop.base.backgroundColor = HomeStyle.cardFill.cgColor
        case .image:
            backdrop.base.colors = [NSColor(white: 0.2, alpha: 1).cgColor, NSColor(white: 0.13, alpha: 1).cgColor]
            backdrop.shade.isHidden = true
        }

        let text = NSStackView(views: [titleLabel, subtitleLabel, ctaLabel])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 3
        text.detachesHiddenViews = true
        text.setCustomSpacing(9, after: subtitleLabel)
        for v in [backdrop, iconView, badge, text] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        NSLayoutConstraint.activate([
            backdrop.topAnchor.constraint(equalTo: topAnchor),
            backdrop.bottomAnchor.constraint(equalTo: bottomAnchor),
            backdrop.leadingAnchor.constraint(equalTo: leadingAnchor),
            backdrop.trailingAnchor.constraint(equalTo: trailingAnchor),
            iconView.topAnchor.constraint(equalTo: topAnchor, constant: 20),
            iconView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 20),
            badge.centerYAnchor.constraint(equalTo: iconView.centerYAnchor),
            badge.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            badge.leadingAnchor.constraint(greaterThanOrEqualTo: iconView.trailingAnchor, constant: 8),
            text.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 20),
            text.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -20),
            text.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -18),
        ])
    }

    override func layout() {
        super.layout()
        let w = max(40, bounds.width - 40)
        if abs(subtitleLabel.preferredMaxLayoutWidth - w) > 0.5 {
            subtitleLabel.preferredMaxLayoutWidth = w
            needsLayout = true
        }
    }

    override func stateChanged() {
        backdrop.hover.opacity = isPressed ? 0.12 : isHovering ? 0.06 : 0
        let border: NSColor
        switch style {
        case .accent: border = NSColor(white: 1, alpha: isHovering ? 0.28 : 0.1)
        case .neutral: border = isHovering ? HomeStyle.borderHover : HomeStyle.border
        case .image: border = NSColor(white: 1, alpha: isHovering ? 0.32 : 0.12)
        }
        backdrop.layer?.borderColor = border.cgColor
    }
}

/// Layer stack behind a card: base fill/gradient, cover photo, legibility shade, meter, hover wash.
final class CardBackdrop: NSView {
    let base = CAGradientLayer()
    let imageLayer = CALayer()
    let shade = CAGradientLayer()
    let hover = CALayer()
    private let meterTrack = CALayer()
    private let meterFill = CALayer()

    var meter: Double? {
        didSet {
            meterTrack.isHidden = meter == nil
            meterFill.isHidden = meter == nil
            needsLayout = true
        }
    }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = 14
        layer?.masksToBounds = true
        layer?.borderWidth = 1
        imageLayer.contentsGravity = .resizeAspectFill
        imageLayer.masksToBounds = true
        shade.colors = [NSColor(white: 0, alpha: 0.05).cgColor, NSColor(white: 0, alpha: 0.4).cgColor,
                        NSColor(white: 0, alpha: 0.9).cgColor]
        shade.locations = [0, 0.4, 1]
        shade.isHidden = true // only over a cover photo
        shade.startPoint = CGPoint(x: 0.5, y: 1)
        shade.endPoint = CGPoint(x: 0.5, y: 0)
        meterTrack.backgroundColor = NSColor(white: 1, alpha: 0.14).cgColor
        meterFill.backgroundColor = HomeStyle.accent.cgColor
        meterTrack.isHidden = true
        meterFill.isHidden = true
        hover.backgroundColor = NSColor.white.cgColor
        hover.opacity = 0
        for l in [base, imageLayer, shade, meterTrack, meterFill, hover] {
            l.actions = ["bounds": NSNull(), "position": NSNull(), "contents": NSNull()]
            layer?.addSublayer(l)
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for l in [base, imageLayer, shade, hover] { l.frame = bounds }
        meterTrack.frame = NSRect(x: 0, y: 0, width: bounds.width, height: 3)
        meterFill.frame = NSRect(x: 0, y: 0, width: bounds.width * min(1, max(0, meter ?? 0)), height: 3)
        imageLayer.contentsScale = window?.backingScaleFactor ?? 2
        CATransaction.commit()
    }
}

// MARK: - Pill label

/// Small rounded label, optionally with a status dot ("● Card ready", "⌘O").
final class PillLabel: NSView {
    var text = "" { didSet { invalidateIntrinsicContentSize(); needsDisplay = true } }
    var dotColor: NSColor? { didSet { invalidateIntrinsicContentSize(); needsDisplay = true } }
    var textColor = NSColor(white: 0.74, alpha: 1) { didSet { needsDisplay = true } }
    var fillColor = NSColor(white: 1, alpha: 0.08) { didSet { needsDisplay = true } }

    private var attrs: [NSAttributedString.Key: Any] {
        [.font: NSFont.systemFont(ofSize: 11, weight: .semibold), .foregroundColor: textColor]
    }

    override var intrinsicContentSize: NSSize {
        guard !text.isEmpty else { return NSSize(width: 0, height: 22) }
        let w = (text as NSString).size(withAttributes: attrs).width
        return NSSize(width: ceil(w) + 20 + (dotColor == nil ? 0 : 13), height: 22)
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        guard !text.isEmpty else { return }
        fillColor.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2).fill()
        var x: CGFloat = 10
        if let dotColor {
            dotColor.setFill()
            NSBezierPath(ovalIn: NSRect(x: x, y: bounds.midY - 3.5, width: 7, height: 7)).fill()
            x += 13
        }
        let size = (text as NSString).size(withAttributes: attrs)
        (text as NSString).draw(at: NSPoint(x: x, y: (bounds.height - size.height) / 2), withAttributes: attrs)
    }
}

// MARK: - Activity panel

/// A strip in Home's live area: a connected memory card, or an ingest in progress.
final class ActivityPanel: NSView {
    var symbol = "" {
        didSet { icon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) }
    }
    var title = "" { didSet { titleLabel.stringValue = title } }
    var detail = "" { didSet { detailLabel.stringValue = detail } }
    var note = "" {
        didSet {
            noteLabel.stringValue = note
            noteLabel.isHidden = note.isEmpty
        }
    }
    var noteTone = HomeStyle.Tone.normal { didSet { noteLabel.textColor = noteTone.color } }
    /// Nil hides the progress bar.
    var fraction: Double? {
        didSet {
            bar.isHidden = fraction == nil
            bar.fraction = fraction ?? 0
        }
    }
    var primaryTitle = "" { didSet { set(primary, primaryTitle) } }
    var secondaryTitle = "" { didSet { set(secondary, secondaryTitle) } }
    var onPrimary: (() -> Void)?
    var onSecondary: (() -> Void)?

    private let icon = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let bar = ProgressBarView()
    private let detailLabel = NSTextField(labelWithString: "")
    private let noteLabel = NSTextField(labelWithString: "")
    private let primary = NSButton(title: "", target: nil, action: nil)
    private let secondary = NSButton(title: "", target: nil, action: nil)

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = 12
        layer?.borderWidth = 1
        layer?.backgroundColor = HomeStyle.panelFill.cgColor
        layer?.borderColor = HomeStyle.accent.withAlphaComponent(0.45).cgColor

        icon.symbolConfiguration = .init(pointSize: 22, weight: .medium)
        icon.contentTintColor = HomeStyle.accentLight
        titleLabel.font = .systemFont(ofSize: 13.5, weight: .semibold)
        titleLabel.textColor = HomeStyle.title
        for l in [titleLabel, detailLabel, noteLabel] {
            l.lineBreakMode = .byTruncatingTail
            l.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        }
        detailLabel.font = .systemFont(ofSize: 12)
        detailLabel.textColor = HomeStyle.secondary
        noteLabel.font = .systemFont(ofSize: 12)
        noteLabel.textColor = HomeStyle.secondary
        noteLabel.isHidden = true
        bar.isHidden = true
        primary.bezelColor = HomeStyle.accent
        primary.keyEquivalent = ""
        primary.target = self
        primary.action = #selector(primaryPressed(_:))
        secondary.target = self
        secondary.action = #selector(secondaryPressed(_:))
        primary.isHidden = true
        secondary.isHidden = true

        let text = NSStackView(views: [titleLabel, bar, detailLabel, noteLabel])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 4
        text.detachesHiddenViews = true
        text.setCustomSpacing(8, after: titleLabel)
        text.setCustomSpacing(8, after: bar)
        text.setContentHuggingPriority(.init(1), for: .horizontal)
        text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let row = NSStackView(views: [icon, text, secondary, primary])
        row.spacing = 10
        row.alignment = .centerY
        row.setCustomSpacing(16, after: icon)
        row.setCustomSpacing(20, after: text)
        row.edgeInsets = NSEdgeInsets(top: 14, left: 18, bottom: 14, right: 18)
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            icon.widthAnchor.constraint(equalToConstant: 28),
            bar.heightAnchor.constraint(equalToConstant: 6),
            bar.widthAnchor.constraint(equalTo: text.widthAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    private func set(_ button: NSButton, _ title: String) {
        button.title = title
        button.isHidden = title.isEmpty
    }

    @objc private func primaryPressed(_ sender: Any?) { onPrimary?() }
    @objc private func secondaryPressed(_ sender: Any?) { onSecondary?() }
}

// MARK: - Recent shoot row

/// What the home screen knows about a shoot folder after peeking inside it.
struct ShootCover {
    /// The cover the shoot asked for when this was loaded (a change triggers a reload).
    var requested: String?
    var available: Bool
    var image: CGImage?
    var photoCount = 0
    var shotDate: Date?

    /// Scans the folder (no file is opened) and decodes one embedded preview. A few ms per shoot.
    static func load(_ folder: URL, preferring name: String?) -> ShootCover {
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDir), isDir.boolValue else {
            return ShootCover(requested: name, available: false)
        }
        let photos = FolderLoader.scan(folder)
        // Prefer the frame the user rated highest; otherwise the middle of the shoot, which
        // skips the test shots and warm-ups at the start of a card.
        let pick = name.flatMap { n in photos.first { $0.baseName == n } } ?? (photos.isEmpty ? nil : photos[photos.count / 2])
        return ShootCover(requested: name, available: true,
                          image: pick.flatMap { ImagePipeline.render($0, kind: .thumbnail, maxPixels: 900) },
                          photoCount: photos.count, shotDate: pick?.captureDate)
    }
}

extension RecentShoot {
    /// How much of the shoot has been culled (0…1), or nil if Deadlyne doesn't know yet.
    func reviewedFraction(photos: Int?) -> Double? {
        guard let photos, photos > 0, let r = reviewedCount else { return nil }
        return min(1, Double(r) / Double(photos))
    }

    /// "1,408 of 2,191 reviewed  ·  143 selects"
    func progressLine(photos: Int?) -> String {
        var bits: [String] = []
        if let n = photos {
            let r = min(reviewedCount ?? 0, n)
            bits.append(r > 0 && r < n ? "\(r.grouped) of \(n.grouped) reviewed"
                        : r >= n && n > 0 ? "All \(n.grouped) reviewed" : "\(n.grouped) photo\(n == 1 ? "" : "s")")
        }
        if let t = taggedCount, t > 0 { bits.append("\(t.grouped) select\(t == 1 ? "" : "s")") }
        if let f = fiveStarCount, f > 0 { bits.append("\(f.grouped) five-star") }
        return bits.joined(separator: "  ·  ")
    }

    func callToAction(photos: Int?) -> String {
        let r = reviewedCount ?? 0
        if r == 0 { return "Start culling →" }
        if let n = photos, r >= n { return "Open shoot →" }
        return "Continue culling →"
    }
}

/// One line in Home's Recent Shoots list: cover, readable name, culling progress, selects,
/// when it was last opened, and where clicking takes you. Drawn directly, like the grid cells.
final class ShootRow: HoverControl {
    static let height: CGFloat = 76

    let shoot: RecentShoot
    var onReveal: ((RecentShoot) -> Void)?
    var onRemove: ((RecentShoot) -> Void)?
    var onTogglePin: ((RecentShoot) -> Void)?
    var showsSeparator = false { didSet { needsDisplay = true } }
    var cover: ShootCover? {
        didSet {
            imageLayer.contents = cover?.image
            needsDisplay = true
        }
    }

    private let name: ShootName
    private let imageLayer = CALayer()

    init(shoot: RecentShoot) {
        self.shoot = shoot
        name = shoot.display
        super.init(frame: .zero)
        wantsLayer = true
        layerContentsRedrawPolicy = .onSetNeedsDisplay
        imageLayer.contentsGravity = .resizeAspectFill
        imageLayer.masksToBounds = true
        imageLayer.cornerRadius = 6
        imageLayer.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull()]
        layer?.addSublayer(imageLayer)
        heightAnchor.constraint(equalToConstant: Self.height).isActive = true
        setAccessibilityLabel(name.title)
        toolTip = "\(shoot.name)\n\((shoot.path as NSString).abbreviatingWithTildeInPath)"
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    private var thumbRect: NSRect { NSRect(x: 14, y: ((bounds.height - 58) / 2).rounded(), width: 87, height: 58) }
    private var unavailable: Bool { cover?.available == false }
    private var photoCount: Int? { shoot.photoCount ?? cover?.photoCount }

    /// "Boys Varsity  ·  Aug 21, 2026  ·  2,191 photos"
    private var subtitle: String {
        if unavailable { return "Not available — is the drive connected?" }
        var bits: [String] = []
        if let c = name.context { bits.append(c) }
        if let d = name.date ?? cover?.shotDate { bits.append(HomeStyle.dateFormatter.string(from: d)) }
        if let n = photoCount { bits.append("\(n.grouped) photo\(n == 1 ? "" : "s")") }
        return bits.joined(separator: "  ·  ")
    }

    override func setFrameSize(_ newSize: NSSize) {
        let resized = newSize != frame.size
        super.setFrameSize(newSize)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        imageLayer.frame = thumbRect
        imageLayer.contentsScale = window?.backingScaleFactor ?? 2
        CATransaction.commit()
        if resized { needsDisplay = true }
    }

    override func stateChanged() { needsDisplay = true }

    private static func attrs(_ size: CGFloat, _ weight: NSFont.Weight = .regular, _ color: NSColor,
                              align: NSTextAlignment = .left) -> [NSAttributedString.Key: Any] {
        let para = NSMutableParagraphStyle()
        para.lineBreakMode = .byTruncatingTail
        para.alignment = align
        return [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: para]
    }

    private static let missingIcon = NSImage(systemSymbolName: "externaldrive.badge.xmark", accessibilityDescription: nil)?
        .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 20, weight: .light)
            .applying(NSImage.SymbolConfiguration(paletteColors: [NSColor(white: 0.5, alpha: 1)])))
    private static let pinIcon = NSImage(systemSymbolName: "pin.fill", accessibilityDescription: "Pinned")?
        .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 10, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [HomeStyle.accentLight])))

    private func text(_ s: String, _ rect: NSRect, _ attrs: [NSAttributedString.Key: Any]) {
        (s as NSString).draw(in: rect, withAttributes: attrs)
    }

    override func draw(_ dirtyRect: NSRect) {
        if isHovering {
            (isPressed ? NSColor(white: 0.21, alpha: 1) : HomeStyle.cardHover).setFill()
            bounds.fill()
        }
        if showsSeparator {
            HomeStyle.panelBorder.setFill()
            NSRect(x: 14, y: 0, width: bounds.width - 28, height: 1).fill()
        }
        let tr = thumbRect
        if imageLayer.contents == nil {
            NSColor(white: 0.2, alpha: 1).setFill()
            NSBezierPath(roundedRect: tr, xRadius: 6, yRadius: 6).fill()
            if unavailable, let icon = Self.missingIcon {
                let s = icon.size
                icon.draw(in: NSRect(x: tr.midX - s.width / 2, y: tr.midY - s.height / 2, width: s.width, height: s.height),
                          from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            }
        }

        // Columns from the right edge, so they line up from row to row. Narrow windows drop the
        // least important ones first.
        let mid = bounds.midY
        var right = bounds.width - 18
        if !unavailable {
            let cta = shoot.callToAction(photos: photoCount)
            text(cta, NSRect(x: right - 130, y: mid - 9, width: 130, height: 18),
                 Self.attrs(12.5, .semibold, isHovering ? HomeStyle.accentLight : HomeStyle.secondary, align: .right))
            right -= 130 + 24
            let w = bounds.width
            if w >= 900 {
                column(x: right - 96, width: 96, top: HomeStyle.relative(shoot.lastOpened), bottom: "last opened")
                right -= 96 + 20
            }
            if w >= 760 {
                let t = shoot.taggedCount
                let f = shoot.fiveStarCount ?? 0
                column(x: right - 96, width: 96, top: t.map { "\($0.grouped) select\($0 == 1 ? "" : "s")" } ?? "—",
                       bottom: f > 0 ? "\(f.grouped) five-star" : "")
                right -= 96 + 20
            }
            if w >= 620 {
                progressColumn(x: right - 170, width: 170)
                right -= 170 + 24
            }
        }

        var x = tr.maxX + 16
        if shoot.isPinned, let pin = Self.pinIcon {
            let s = pin.size
            pin.draw(in: NSRect(x: x, y: mid - 12 - s.height / 2, width: s.width, height: s.height),
                     from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            x += s.width + 6
        }
        text(name.title, NSRect(x: x, y: mid - 21, width: max(0, right - x), height: 19),
             Self.attrs(14, .semibold, unavailable ? HomeStyle.secondary : HomeStyle.title))
        let sx = tr.maxX + 16
        text(subtitle, NSRect(x: sx, y: mid + 2, width: max(0, right - sx), height: 16),
             Self.attrs(12, .regular, unavailable ? HomeStyle.warning : HomeStyle.secondary))
    }

    private func column(x: CGFloat, width: CGFloat, top: String, bottom: String) {
        let mid = bounds.midY
        text(top, NSRect(x: x, y: mid - 17, width: width, height: 17), Self.attrs(12.5, .medium, NSColor(white: 0.86, alpha: 1)))
        text(bottom, NSRect(x: x, y: mid + 2, width: width, height: 15), Self.attrs(11.5, .regular, HomeStyle.tertiary))
    }

    private func progressColumn(x: CGFloat, width: CGFloat) {
        let mid = bounds.midY
        let n = photoCount ?? 0
        let r = min(shoot.reviewedCount ?? 0, n)
        let label = n == 0 ? "—" : r == 0 ? "Not started" : r >= n ? "All \(n.grouped) reviewed" : "\(r.grouped) / \(n.grouped) reviewed"
        text(label, NSRect(x: x, y: mid - 17, width: width, height: 17), Self.attrs(12.5, .medium, NSColor(white: 0.86, alpha: 1)))
        let bar = NSRect(x: x, y: mid + 6, width: width, height: 4)
        NSColor(white: 0.25, alpha: 1).setFill()
        NSBezierPath(roundedRect: bar, xRadius: 2, yRadius: 2).fill()
        if n > 0, r > 0 {
            (r >= n ? HomeStyle.ready : HomeStyle.accent).setFill()
            NSBezierPath(roundedRect: NSRect(x: x, y: bar.minY, width: max(4, width * CGFloat(r) / CGFloat(n)), height: 4),
                         xRadius: 2, yRadius: 2).fill()
        }
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let m = NSMenu()
        m.addItem(ClosureMenuItem("Open") { [weak self] in self?.onClick?() })
        m.addItem(ClosureMenuItem("Reveal in Finder") { [weak self] in if let self { self.onReveal?(self.shoot) } })
        m.addItem(ClosureMenuItem(shoot.isPinned ? "Unpin" : "Pin to Top") { [weak self] in
            if let self { self.onTogglePin?(self.shoot) }
        })
        m.addItem(.separator())
        m.addItem(ClosureMenuItem("Remove from Recent Shoots") { [weak self] in if let self { self.onRemove?(self.shoot) } })
        return m
    }
}

/// A menu item that runs a closure.
final class ClosureMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, _ handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(run(_:)), keyEquivalent: "")
        target = self
    }

    required init(coder: NSCoder) { fatalError() }

    @objc private func run(_ sender: Any?) { handler() }
}

// MARK: - Ingest setup cell

/// One setting in Home's "Ingest setup" row: what it is, its current value and a status line.
final class WorkflowCell: HoverControl {
    var label = "" { didSet { changed() } }
    var value = "" { didSet { changed() } }
    var detail = "" { didSet { changed() } }
    var tone = HomeStyle.Tone.normal { didSet { changed() } }

    override init(frame: NSRect) {
        super.init(frame: frame)
        heightAnchor.constraint(equalToConstant: 74).isActive = true
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    private func changed() {
        needsDisplay = true
        setAccessibilityLabel("\(label.capitalized): \(value). \(detail)")
    }

    override func stateChanged() { needsDisplay = true }

    override func draw(_ dirtyRect: NSRect) {
        let card = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10)
        (isHovering ? HomeStyle.cardHover : HomeStyle.panelFill).setFill()
        card.fill()
        (isHovering ? HomeStyle.borderHover : HomeStyle.panelBorder).setStroke()
        card.lineWidth = 1
        card.stroke()

        func line(_ s: String, y: CGFloat, h: CGFloat, _ attrs: [NSAttributedString.Key: Any], middle: Bool = false) {
            let para = NSMutableParagraphStyle()
            para.lineBreakMode = middle ? .byTruncatingMiddle : .byTruncatingTail
            var a = attrs
            a[.paragraphStyle] = para
            (s as NSString).draw(in: NSRect(x: 16, y: y, width: bounds.width - 32, height: h), withAttributes: a)
        }
        line(label, y: 13, h: 14, [.font: NSFont.systemFont(ofSize: 10, weight: .semibold),
                                   .foregroundColor: HomeStyle.tertiary, .kern: 0.6])
        line(value, y: 29, h: 19, [.font: NSFont.systemFont(ofSize: 13.5, weight: .semibold),
                                   .foregroundColor: HomeStyle.title], middle: true)
        line(detail, y: 49, h: 16, [.font: NSFont.systemFont(ofSize: 11.5), .foregroundColor: tone.color])
    }
}

// MARK: - Tile grid

/// Lays tiles out in equal columns that reflow with the width; reports its height to Auto Layout.
final class TileGridView: NSView {
    var tiles: [NSView] = [] {
        didSet {
            oldValue.forEach { $0.removeFromSuperview() }
            tiles.forEach(addSubview)
            invalidateIntrinsicContentSize()
            needsLayout = true
        }
    }

    private let minTileWidth: CGFloat
    private let spacing: CGFloat
    private let tileHeight: (CGFloat) -> CGFloat
    private var lastWidth: CGFloat = -1

    init(minTileWidth: CGFloat, spacing: CGFloat, tileHeight: @escaping (CGFloat) -> CGFloat) {
        self.minTileWidth = minTileWidth
        self.spacing = spacing
        self.tileHeight = tileHeight
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    private func metrics(_ width: CGFloat) -> (columns: Int, width: CGFloat, height: CGFloat) {
        let columns = max(1, Int((width + spacing) / (minTileWidth + spacing)))
        let w = floor((width - spacing * CGFloat(columns - 1)) / CGFloat(columns))
        return (columns, w, tileHeight(w))
    }

    override var intrinsicContentSize: NSSize {
        guard !tiles.isEmpty, bounds.width > 0 else { return NSSize(width: NSView.noIntrinsicMetric, height: 0) }
        let m = metrics(bounds.width)
        let rows = (tiles.count + m.columns - 1) / m.columns
        return NSSize(width: NSView.noIntrinsicMetric, height: CGFloat(rows) * m.height + CGFloat(rows - 1) * spacing)
    }

    override func layout() {
        super.layout()
        if abs(bounds.width - lastWidth) > 0.5 {
            lastWidth = bounds.width
            invalidateIntrinsicContentSize()
        }
        let m = metrics(bounds.width)
        for (i, t) in tiles.enumerated() {
            t.frame = NSRect(x: CGFloat(i % m.columns) * (m.width + spacing), y: CGFloat(i / m.columns) * (m.height + spacing),
                             width: m.width, height: m.height)
        }
    }
}

// MARK: - Avatar

/// The profile picture, or the user's initials on the brand gradient, or a person glyph.
final class AvatarView: NSView {
    var profile: Profile? { didSet { needsDisplay = true } }
    var image: NSImage? { didSet { needsDisplay = true } }
    var onClick: (() -> Void)?
    var onImageDropped: ((NSImage) -> Void)? {
        didSet { registerForDraggedTypes(onImageDropped == nil ? [] : [.fileURL, .tiff, .png]) }
    }
    private var dropHighlight = false { didSet { needsDisplay = true } }

    override func draw(_ dirtyRect: NSRect) {
        let r = bounds.insetBy(dx: 1, dy: 1)
        let circle = NSBezierPath(ovalIn: r)
        if let image, image.size.width > 0, image.size.height > 0 {
            NSGraphicsContext.saveGraphicsState()
            circle.addClip()
            let s = image.size
            let scale = max(r.width / s.width, r.height / s.height)
            let w = s.width * scale, h = s.height * scale
            image.draw(in: NSRect(x: r.midX - w / 2, y: r.midY - h / 2, width: w, height: h),
                       from: .zero, operation: .sourceOver, fraction: 1)
            NSGraphicsContext.restoreGraphicsState()
        } else if let initials = profile?.initials, !initials.isEmpty {
            NSGradient(starting: HomeStyle.accentLight, ending: HomeStyle.accentDark)?.draw(in: circle, angle: -60)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: r.height * 0.38, weight: .semibold), .foregroundColor: NSColor.white,
            ]
            let size = (initials as NSString).size(withAttributes: attrs)
            (initials as NSString).draw(at: NSPoint(x: r.midX - size.width / 2, y: r.midY - size.height / 2), withAttributes: attrs)
        } else {
            NSColor(white: 0.26, alpha: 1).setFill()
            circle.fill()
            let config = NSImage.SymbolConfiguration(pointSize: r.height * 0.46, weight: .regular)
                .applying(NSImage.SymbolConfiguration(paletteColors: [NSColor(white: 0.66, alpha: 1)]))
            if let glyph = NSImage(systemSymbolName: "person.fill", accessibilityDescription: nil)?.withSymbolConfiguration(config) {
                let s = glyph.size
                glyph.draw(in: NSRect(x: r.midX - s.width / 2, y: r.midY - s.height / 2, width: s.width, height: s.height))
            }
        }
        if dropHighlight {
            HomeStyle.accent.setStroke()
            circle.lineWidth = 3
            circle.stroke()
        }
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        onClick == nil && onImageDropped == nil ? nil : super.hitTest(point)
    }

    override func resetCursorRects() {
        if onClick != nil { addCursorRect(bounds, cursor: .pointingHand) }
    }

    override func mouseUp(with event: NSEvent) {
        if bounds.contains(convert(event.locationInWindow, from: nil)) { onClick?() }
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard NSImage.canInit(with: sender.draggingPasteboard) else { return [] }
        dropHighlight = true
        return .copy
    }

    override func draggingExited(_ sender: NSDraggingInfo?) { dropHighlight = false }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        dropHighlight = false
        guard let img = NSImage(pasteboard: sender.draggingPasteboard) else { return false }
        onImageDropped?(img)
        return true
    }
}

// MARK: - Profile chip

/// Top-right of the home screen: the avatar and name, or an invitation to create a profile.
final class ProfileChip: HoverControl {
    private let avatar = AvatarView()
    private let label = NSTextField(labelWithString: "")

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = 18
        layer?.borderWidth = 1
        label.font = .systemFont(ofSize: 12.5, weight: .medium)
        label.textColor = HomeStyle.title
        for v in [avatar, label] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 36),
            avatar.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 5),
            avatar.centerYAnchor.constraint(equalTo: centerYAnchor),
            avatar.widthAnchor.constraint(equalToConstant: 26),
            avatar.heightAnchor.constraint(equalToConstant: 26),
            label.leadingAnchor.constraint(equalTo: avatar.trailingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        show(nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(_ profile: Profile?) {
        avatar.profile = profile
        avatar.image = profile == nil ? nil : Profile.avatar
        label.stringValue = profile?.name ?? "Create Profile"
        setAccessibilityLabel(profile == nil ? "Create profile" : "Edit profile")
        toolTip = profile == nil ? "Optional — add your name and credits" : "Edit your profile (⌘,)"
    }

    override func stateChanged() {
        layer?.backgroundColor = (isHovering ? HomeStyle.cardHover : HomeStyle.cardFill).cgColor
        layer?.borderColor = (isHovering ? HomeStyle.borderHover : HomeStyle.border).cgColor
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        stateChanged()
    }
}

// MARK: - Shortcut chip

/// A keycap and what it does. Keycaps share one minimum width so descriptions line up.
final class ShortcutView: NSView {
    private let key: String
    private let text: String

    init(key: String, text: String) {
        self.key = key
        self.text = text
        super.init(frame: .zero)
        setAccessibilityElement(true)
        setAccessibilityLabel("\(key): \(text)")
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    private static let keyAttrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 11.5, weight: .semibold), .foregroundColor: NSColor(white: 0.9, alpha: 1),
    ]
    private static let textAttrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 12.5), .foregroundColor: HomeStyle.secondary,
    ]

    override func draw(_ dirtyRect: NSRect) {
        let ks = (key as NSString).size(withAttributes: Self.keyAttrs)
        let cap = NSRect(x: 0.5, y: ((bounds.height - 24) / 2).rounded() - 1, width: max(54, ceil(ks.width) + 16), height: 24)
        NSColor(white: 0.06, alpha: 1).setFill()
        NSBezierPath(roundedRect: cap.offsetBy(dx: 0, dy: 2), xRadius: 5, yRadius: 5).fill()
        let face = NSBezierPath(roundedRect: cap, xRadius: 5, yRadius: 5)
        NSColor(white: 0.2, alpha: 1).setFill()
        face.fill()
        NSColor(white: 0.3, alpha: 1).setStroke()
        face.lineWidth = 1
        face.stroke()
        (key as NSString).draw(at: NSPoint(x: cap.midX - ks.width / 2, y: cap.midY - ks.height / 2), withAttributes: Self.keyAttrs)

        let ts = (text as NSString).size(withAttributes: Self.textAttrs)
        (text as NSString).draw(with: NSRect(x: cap.maxX + 10, y: cap.midY - ts.height / 2, width: bounds.width - cap.maxX - 10, height: ts.height),
                                options: [.truncatesLastVisibleLine, .usesLineFragmentOrigin], attributes: Self.textAttrs)
    }
}
