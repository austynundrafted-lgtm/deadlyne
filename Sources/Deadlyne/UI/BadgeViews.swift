import AppKit

// MARK: - Artwork

/// Draws a badge: the designer's PNG when there is one, otherwise a placeholder medallion.
///
/// Artwork lookup: `~/Library/Application Support/Deadlyne/Badges/<id>.png` first (to try designs
/// without rebuilding — relaunch to see changes), then `Resources/Badges/<id>.png` in the app.
/// Locked badges use `<id>-locked.png` if present, else a faded, desaturated copy of the art.
enum BadgeArt {
    private static var cache: [String: NSImage?] = [:]

    static var supportFolder: URL {
        CodeReplacements.supportDirectory.appendingPathComponent("Badges", isDirectory: true)
    }

    static func artwork(_ name: String) -> NSImage? {
        if let hit = cache[name] { return hit }
        let img = NSImage(contentsOf: supportFolder.appendingPathComponent(name + ".png"))
            ?? Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Badges").flatMap { NSImage(contentsOf: $0) }
        cache[name] = .some(img)
        return img
    }

    static func draw(_ badge: Badge, in rect: NSRect, earned: Bool) {
        let side = min(rect.width, rect.height)
        let r = NSRect(x: rect.midX - side / 2, y: rect.midY - side / 2, width: side, height: side)
        if earned, let art = artwork(badge.id) {
            art.draw(in: r, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            return
        }
        if !earned {
            if let art = artwork(badge.id + "-locked") {
                art.draw(in: r, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
                return
            }
            if let art = artwork(badge.id) {
                drawDesaturated(art, in: r)
                return
            }
        }
        drawPlaceholder(badge, in: r, earned: earned)
    }

    private static func drawDesaturated(_ art: NSImage, in r: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.saveGState()
        ctx.setAlpha(0.4)
        ctx.beginTransparencyLayer(in: r, auxiliaryInfo: nil)
        art.draw(in: r, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        NSColor.gray.setFill()
        r.fill(using: .saturation)
        art.draw(in: r, from: .zero, operation: .destinationIn, fraction: 1, respectFlipped: true, hints: nil)
        ctx.endTransparencyLayer()
        ctx.restoreGState()
    }

    private static let tierColors: [(NSColor, NSColor)] = [
        (NSColor(srgbRed: 0.95, green: 0.66, blue: 0.42, alpha: 1), NSColor(srgbRed: 0.55, green: 0.29, blue: 0.13, alpha: 1)),
        (NSColor(srgbRed: 0.94, green: 0.95, blue: 0.97, alpha: 1), NSColor(srgbRed: 0.48, green: 0.52, blue: 0.58, alpha: 1)),
        (NSColor(srgbRed: 1.00, green: 0.88, blue: 0.45, alpha: 1), NSColor(srgbRed: 0.76, green: 0.50, blue: 0.06, alpha: 1)),
        (HomeStyle.accentLight, HomeStyle.accentDark),
    ]

    /// Circle for photo badges, hexagon for shoot badges; tier-colored when earned, gray with a lock when not.
    private static func drawPlaceholder(_ badge: Badge, in r: NSRect, earned: Bool) {
        let flipped = NSGraphicsContext.current?.isFlipped ?? false
        let (light, dark) = earned ? tierColors[min(badge.tier, 3)] : (NSColor(white: 0.33, alpha: 1), NSColor(white: 0.19, alpha: 1))
        let outer = shape(badge.track, in: r.insetBy(dx: r.width * 0.04, dy: r.width * 0.04))
        NSGradient(starting: light, ending: dark)?.draw(in: outer, angle: flipped ? 90 : -90)
        let inner = shape(badge.track, in: r.insetBy(dx: r.width * 0.15, dy: r.width * 0.15))
        NSColor(white: earned ? 0.1 : 0.13, alpha: 1).setFill()
        inner.fill()
        light.withAlphaComponent(earned ? 0.85 : 0.35).setStroke()
        inner.lineWidth = max(1, r.width * 0.022)
        inner.stroke()

        let color = earned ? NSColor.white : NSColor(white: 0.5, alpha: 1)
        let symbolName = earned ? (badge.track == .photos ? "camera.fill" : "flag.checkered") : "lock.fill"
        let config = NSImage.SymbolConfiguration(pointSize: r.width * 0.13, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [earned ? light : color]))
        let glyph = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil)?.withSymbolConfiguration(config)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: r.width * 0.2, weight: .heavy), .foregroundColor: color,
        ]
        let text = badge.shortThreshold as NSString
        let ts = text.size(withAttributes: attrs)
        let gs = glyph?.size ?? .zero
        let gap = r.width * 0.02
        let top = (r.height - gs.height - gap - ts.height) / 2
        // Lay out from the top in either coordinate system.
        func rect(_ offset: CGFloat, _ size: NSSize) -> NSRect {
            let y = flipped ? r.minY + offset : r.maxY - offset - size.height
            return NSRect(x: r.midX - size.width / 2, y: y, width: size.width, height: size.height)
        }
        glyph?.draw(in: rect(top, gs), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        text.draw(with: rect(top + gs.height + gap, ts), options: [.usesLineFragmentOrigin], attributes: attrs)
    }

    private static func shape(_ track: Badge.Track, in r: NSRect) -> NSBezierPath {
        guard track == .shoots else { return NSBezierPath(ovalIn: r) }
        let p = NSBezierPath()
        let c = NSPoint(x: r.midX, y: r.midY), radius = r.width / 2
        for i in 0..<6 {
            let a = CGFloat.pi / 2 + CGFloat(i) * .pi / 3
            let pt = NSPoint(x: c.x + radius * cos(a), y: c.y + radius * sin(a))
            i == 0 ? p.move(to: pt) : p.line(to: pt)
        }
        p.close()
        p.lineJoinStyle = .round
        return p
    }
}

final class BadgeView: NSView {
    var badge: Badge? { didSet { needsDisplay = true } }
    var earned = false { didSet { needsDisplay = true } }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        if let badge { BadgeArt.draw(badge, in: bounds, earned: earned) }
    }
}

// MARK: - Progress bar

final class ProgressBarView: NSView {
    var fraction: Double = 0 {
        didSet {
            needsDisplay = true
            setAccessibilityValue(NSNumber(value: min(1, max(0, fraction))))
        }
    }

    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .progressIndicator }

    override func draw(_ dirtyRect: NSRect) {
        let h = bounds.height
        NSColor(white: 0.23, alpha: 1).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: h / 2, yRadius: h / 2).fill()
        let f = min(1, max(0, fraction))
        guard f > 0 else { return }
        let fill = NSRect(x: 0, y: 0, width: max(h, bounds.width * f), height: h)
        NSGradient(starting: HomeStyle.accentLight, ending: HomeStyle.accent)?
            .draw(in: NSBezierPath(roundedRect: fill, xRadius: h / 2, yRadius: h / 2), angle: 0)
    }
}

// MARK: - Home stats strip

/// Home's one-line stats: this month's photos and shoots, and the next badge. Opens Achievements.
final class HomeStatsStrip: HoverControl {
    private let monthLabel = NSTextField(labelWithString: "")
    private let nextBadge = BadgeView()
    private let nextLabel = NSTextField(labelWithString: "")
    private let viewAll = NSTextField(labelWithString: "View achievements →")

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = 12
        layer?.borderWidth = 1

        monthLabel.lineBreakMode = .byTruncatingTail
        monthLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        nextLabel.font = .systemFont(ofSize: 12.5)
        nextLabel.textColor = HomeStyle.secondary
        nextLabel.lineBreakMode = .byTruncatingTail
        nextLabel.setContentCompressionResistancePriority(.init(260), for: .horizontal)
        viewAll.font = .systemFont(ofSize: 12, weight: .semibold)
        viewAll.textColor = HomeStyle.accentLight
        let spacer = NSView()
        spacer.setContentHuggingPriority(.init(1), for: .horizontal)

        let row = NSStackView(views: [monthLabel, spacer, nextBadge, nextLabel, viewAll])
        row.spacing = 8
        row.alignment = .centerY
        row.setCustomSpacing(20, after: nextLabel)
        row.edgeInsets = NSEdgeInsets(top: 0, left: 18, bottom: 0, right: 18)
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 48),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            nextBadge.widthAnchor.constraint(equalToConstant: 24),
            nextBadge.heightAnchor.constraint(equalToConstant: 24),
        ])
        refresh()
    }

    required init?(coder: NSCoder) { fatalError() }

    func refresh() {
        let s = Achievements.state
        let month = s.thisMonth
        let text = NSMutableAttributedString(string: "This month", attributes: [
            .font: NSFont.systemFont(ofSize: 12.5, weight: .semibold), .foregroundColor: HomeStyle.title,
        ])
        let figures = month.photos == 0 && month.shoots == 0 ? "No photos ingested yet"
            : "\(month.photos.grouped) \(Badge.Track.photos.unit(month.photos)) ingested  ·  "
            + "\(month.shoots.grouped) new \(Badge.Track.shoots.unit(month.shoots))"
        text.append(NSAttributedString(string: "    " + figures, attributes: [
            .font: NSFont.systemFont(ofSize: 12.5), .foregroundColor: HomeStyle.secondary,
        ]))
        monthLabel.attributedStringValue = text

        if let next = Achievements.next(.photos) {
            nextBadge.badge = next
            nextBadge.earned = false
            let left = next.threshold - s.photos
            nextLabel.stringValue = "Next badge: \(next.name)  ·  \(left.grouped) to go"
        } else {
            nextBadge.badge = Badges.photos.last
            nextBadge.earned = true
            nextLabel.stringValue = "Every photo badge earned"
        }
        setAccessibilityLabel("\(monthLabel.stringValue). \(nextLabel.stringValue). View achievements")
    }

    override func stateChanged() {
        layer?.backgroundColor = (isHovering ? NSColor(white: 0.16, alpha: 1) : HomeStyle.panelFill).cgColor
        layer?.borderColor = (isHovering ? HomeStyle.borderHover : HomeStyle.panelBorder).cgColor
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        stateChanged()
    }
}

// MARK: - Achievements tile

/// One badge in the Achievements window: art, name, threshold, and earned date or progress.
final class BadgeTile: NSView {
    private let badge: Badge
    private let earnedOn: Date?
    private let value: Int
    private let isNext: Bool

    init(badge: Badge, earnedOn: Date?, value: Int, isNext: Bool) {
        self.badge = badge
        self.earnedOn = earnedOn
        self.value = value
        self.isNext = isNext
        super.init(frame: .zero)
        setAccessibilityElement(true)
        setAccessibilityRole(.image)
        setAccessibilityLabel("\(badge.name), \(badge.threshold.grouped) \(badge.track.unit(badge.threshold)), \(status)")
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f
    }()

    private var status: String {
        if let earnedOn { return "Earned \(Self.dateFormatter.string(from: earnedOn))" }
        return isNext ? "\(value.grouped) / \(badge.threshold.grouped)" : "Locked"
    }

    private func drawCentered(_ s: String, y: CGFloat, font: NSFont, color: NSColor) {
        let para = NSMutableParagraphStyle()
        para.alignment = .center
        para.lineBreakMode = .byTruncatingTail
        (s as NSString).draw(with: NSRect(x: 8, y: y, width: bounds.width - 16, height: font.pointSize + 5),
                             options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
                             attributes: [.font: font, .foregroundColor: color, .paragraphStyle: para])
    }

    override func draw(_ dirtyRect: NSRect) {
        let card = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 12, yRadius: 12)
        NSColor(white: earnedOn != nil ? 0.155 : 0.125, alpha: 1).setFill()
        card.fill()
        (isNext ? HomeStyle.accent.withAlphaComponent(0.7) : HomeStyle.border).setStroke()
        card.lineWidth = isNext ? 1.5 : 1
        card.stroke()

        BadgeArt.draw(badge, in: NSRect(x: bounds.midX - 46, y: 14, width: 92, height: 92), earned: earnedOn != nil)
        drawCentered(badge.name, y: 114, font: .systemFont(ofSize: 13, weight: .semibold),
                     color: earnedOn != nil ? HomeStyle.title : NSColor(white: 0.72, alpha: 1))
        drawCentered("\(badge.threshold.grouped) \(badge.track.unit(badge.threshold))", y: 133,
                     font: .systemFont(ofSize: 11.5), color: HomeStyle.secondary)
        if earnedOn != nil {
            drawCentered(status, y: 160, font: .systemFont(ofSize: 11, weight: .semibold), color: HomeStyle.accentLight)
        } else if isNext {
            let bar = NSRect(x: 20, y: 158, width: bounds.width - 40, height: 5)
            NSColor(white: 0.23, alpha: 1).setFill()
            NSBezierPath(roundedRect: bar, xRadius: 2.5, yRadius: 2.5).fill()
            let f = min(1, Double(value) / Double(badge.threshold))
            if f > 0 {
                HomeStyle.accent.setFill()
                NSBezierPath(roundedRect: NSRect(x: bar.minX, y: bar.minY, width: max(5, bar.width * f), height: 5),
                             xRadius: 2.5, yRadius: 2.5).fill()
            }
            drawCentered(status, y: 168, font: .monospacedDigitSystemFont(ofSize: 11, weight: .medium), color: HomeStyle.secondary)
        } else {
            drawCentered(status, y: 160, font: .systemFont(ofSize: 11), color: HomeStyle.tertiary)
        }
    }
}

// MARK: - Unlock banner

/// Slides in over the main window when a badge is earned. Click it to see all badges.
final class UnlockBanner: HoverControl {
    let announcement: String

    init(badges: [Badge]) {
        // Celebrate the biggest photo milestone if there is one, else the biggest shoot milestone.
        let top = badges.max { ($0.track == .photos ? 1 : 0, $0.threshold) < ($1.track == .photos ? 1 : 0, $1.threshold) }!
        let more = badges.count > 1 ? "  ·  +\(badges.count - 1) more" : ""
        let detail = "\(top.threshold.grouped) \(top.track.unit(top.threshold)) \(top.track == .photos ? "ingested" : "in Deadlyne")\(more)"
        announcement = "Badge unlocked: \(top.name). \(detail)"
        super.init(frame: .zero)

        wantsLayer = true
        layer?.cornerRadius = 16
        layer?.borderWidth = 1.5
        layer?.borderColor = HomeStyle.accent.withAlphaComponent(0.75).cgColor
        layer?.backgroundColor = NSColor(white: 0.14, alpha: 0.97).cgColor
        let shadow = NSShadow()
        shadow.shadowBlurRadius = 20
        shadow.shadowOffset = NSSize(width: 0, height: -6)
        shadow.shadowColor = NSColor(white: 0, alpha: 0.55)
        self.shadow = shadow

        let art = BadgeView()
        art.badge = top
        art.earned = true
        let over = NSTextField(labelWithAttributedString: NSAttributedString(string: "BADGE UNLOCKED", attributes: [
            .font: NSFont.systemFont(ofSize: 10, weight: .bold), .foregroundColor: HomeStyle.accentLight, .kern: 0.8,
        ]))
        let name = NSTextField(labelWithString: top.name)
        name.font = .systemFont(ofSize: 17, weight: .bold)
        name.textColor = .white
        let sub = NSTextField(labelWithString: detail)
        sub.font = .systemFont(ofSize: 12)
        sub.textColor = HomeStyle.secondary
        let text = NSStackView(views: [over, name, sub])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 1
        let row = NSStackView(views: [art, text])
        row.spacing = 14
        row.edgeInsets = NSEdgeInsets(top: 12, left: 14, bottom: 12, right: 22)
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            art.widthAnchor.constraint(equalToConstant: 56),
            art.heightAnchor.constraint(equalToConstant: 56),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            widthAnchor.constraint(greaterThanOrEqualToConstant: 320),
        ])
        setAccessibilityLabel(announcement)
        toolTip = "See all badges"
    }

    required init?(coder: NSCoder) { fatalError() }

    override func stateChanged() {
        layer?.backgroundColor = NSColor(white: isHovering ? 0.17 : 0.14, alpha: 0.97).cgColor
    }
}
