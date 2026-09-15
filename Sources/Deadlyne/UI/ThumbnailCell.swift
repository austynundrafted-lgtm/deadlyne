import AppKit

protocol ThumbnailCellDelegate: AnyObject {
    func cellToggledTag(_ photo: Photo)
    func cell(_ photo: Photo, setRating rating: Int)
}

final class ThumbnailItem: NSCollectionViewItem {
    static let identifier = NSUserInterfaceItemIdentifier("ThumbnailItem")

    var cell: ThumbnailCellView { view as! ThumbnailCellView }

    override func loadView() { view = ThumbnailCellView() }

    override var isSelected: Bool {
        didSet { cell.isSelected = isSelected }
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        if let p = cell.photo { ImagePipeline.shared.deprioritizeThumbnail(p) }
        cell.photo = nil
        cell.setImage(nil)
    }
}

/// A contact-sheet cell: image on a layer (no NSImage conversions), chrome drawn directly.
final class ThumbnailCellView: NSView {
    /// Which file type the grid currently shows (drives the type badge).
    static var scope = FileScope.both
    private static let captionIcon: NSImage? = NSImage(systemSymbolName: "text.bubble.fill", accessibilityDescription: "Captioned")?
        .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 9, weight: .semibold)
            .applying(NSImage.SymbolConfiguration(paletteColors: [NSColor(white: 0.78, alpha: 1)])))

    weak var delegate: ThumbnailCellDelegate?
    var photo: Photo?
    var isSelected = false { didSet { if oldValue != isSelected { needsDisplay = true } } }

    private let imageLayer = CALayer()
    private static let footerHeight: CGFloat = 38
    private static let pad: CGFloat = 7

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layerContentsRedrawPolicy = .onSetNeedsDisplay
        imageLayer.contentsGravity = .resizeAspect
        imageLayer.minificationFilter = .trilinear
        imageLayer.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull()]
        layer?.addSublayer(imageLayer)
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }
    override var wantsUpdateLayer: Bool { false }

    func configure(_ photo: Photo) {
        self.photo = photo
        needsDisplay = true
        if let img = ImagePipeline.shared.cachedThumbnail(photo) {
            setImage(img)
            return
        }
        setImage(nil)
        ImagePipeline.shared.thumbnail(for: photo, urgent: true) { [weak self] img in
            guard let self, self.photo === photo else { return }
            self.setImage(img)
        }
    }

    func setImage(_ img: CGImage?) {
        imageLayer.contents = img
    }

    func refresh() { needsDisplay = true }

    // MARK: Layout

    private var imageRect: NSRect {
        let p = Self.pad
        return NSRect(x: p, y: p, width: bounds.width - p * 2, height: bounds.height - p - Self.footerHeight)
    }

    private var tagRect: NSRect {
        NSRect(x: Self.pad + 1, y: bounds.height - Self.footerHeight + 6, width: 13, height: 13)
    }

    private var starsRect: NSRect {
        NSRect(x: Self.pad + 1, y: bounds.height - 16, width: 5 * 12, height: 12)
    }

    /// Collection views resize reused cells without always asking them to lay out again,
    /// which would leave the image layer at a stale (smaller) size. The card chrome is drawn
    /// (and only redrawn on request), so a new size also needs a redraw.
    override func setFrameSize(_ newSize: NSSize) {
        let resized = newSize != frame.size
        super.setFrameSize(newSize)
        needsLayout = true
        layoutImageLayer()
        if resized { needsDisplay = true }
    }

    override func layout() {
        super.layout()
        layoutImageLayer()
    }

    private func layoutImageLayer() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        imageLayer.frame = imageRect
        imageLayer.contentsScale = window?.backingScaleFactor ?? 2
        CATransaction.commit()
    }

    // MARK: Drawing

    private static let nameAttrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: 11, weight: .medium),
        .foregroundColor: NSColor(white: 0.88, alpha: 1),
    ]
    private static let badgeAttrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.monospacedSystemFont(ofSize: 8.5, weight: .semibold),
        .foregroundColor: NSColor(white: 0.62, alpha: 1),
    ]

    override func draw(_ dirtyRect: NSRect) {
        guard let photo else { return }
        let card = bounds.insetBy(dx: 1.5, dy: 1.5)
        let path = NSBezierPath(roundedRect: card, xRadius: 6, yRadius: 6)

        if let label = photo.label {
            label.color.withAlphaComponent(isSelected ? 0.42 : 0.26).setFill()
        } else {
            (isSelected ? NSColor(white: 0.30, alpha: 1) : NSColor(white: 0.155, alpha: 1)).setFill()
        }
        path.fill()

        if isSelected {
            NSColor.controlAccentColor.setStroke()
            path.lineWidth = 2.5
            path.stroke()
        }

        // Tag checkbox
        let tr = tagRect
        let box = NSBezierPath(roundedRect: tr, xRadius: 3, yRadius: 3)
        if photo.tagged {
            NSColor(calibratedRed: 1.0, green: 0.62, blue: 0.10, alpha: 1).setFill()
            box.fill()
            let check = NSBezierPath()
            check.move(to: NSPoint(x: tr.minX + 3, y: tr.midY))
            check.line(to: NSPoint(x: tr.minX + 5.5, y: tr.maxY - 3))
            check.line(to: NSPoint(x: tr.maxX - 2.5, y: tr.minY + 3))
            check.lineWidth = 2
            check.lineCapStyle = .round
            check.lineJoinStyle = .round
            NSColor.black.setStroke()
            check.stroke()
        } else {
            NSColor(white: 0.5, alpha: 1).setStroke()
            box.lineWidth = 1.2
            box.stroke()
        }

        // File name + type badge
        let badge = photo.typeBadge(for: Self.scope) as NSString
        let badgeSize = badge.size(withAttributes: Self.badgeAttrs)
        let badgeX = bounds.width - Self.pad - badgeSize.width - 1
        badge.draw(at: NSPoint(x: badgeX, y: tr.minY + 1), withAttributes: Self.badgeAttrs)
        let nameRect = NSRect(x: tr.maxX + 6, y: tr.minY - 1.5, width: badgeX - tr.maxX - 10, height: 15)
        (photo.baseName as NSString).draw(with: nameRect, options: [.truncatesLastVisibleLine, .usesLineFragmentOrigin],
                                          attributes: Self.nameAttrs)

        // Stars
        let sr = starsRect
        for i in 0..<5 {
            let r = NSRect(x: sr.minX + CGFloat(i) * 12, y: sr.minY, width: 10, height: 10)
            let star = Self.starPath(in: r)
            if i < photo.rating {
                NSColor(calibratedRed: 1.0, green: 0.80, blue: 0.25, alpha: 1).setFill()
            } else {
                NSColor(white: 1, alpha: 0.13).setFill()
            }
            star.fill()
        }

        // Color label chip, then a caption marker to its left
        var chipX = bounds.width - Self.pad - 10
        if let label = photo.label {
            label.color.setFill()
            NSBezierPath(ovalIn: NSRect(x: chipX, y: sr.minY, width: 10, height: 10)).fill()
            chipX -= 16
        }
        if photo.iptc.hasCaption, let icon = Self.captionIcon {
            icon.draw(in: NSRect(x: chipX - 1, y: sr.minY - 1, width: 12, height: 12), from: .zero,
                      operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        }

        // Placeholder while decoding
        if imageLayer.contents == nil {
            NSColor(white: 0.2, alpha: 1).setFill()
            NSBezierPath(roundedRect: imageRect.insetBy(dx: 10, dy: 10), xRadius: 3, yRadius: 3).fill()
        }
    }

    static func starPath(in r: NSRect) -> NSBezierPath {
        let p = NSBezierPath()
        let c = NSPoint(x: r.midX, y: r.midY)
        let outer = r.width / 2, inner = outer * 0.45
        for k in 0..<10 {
            let rad = k % 2 == 0 ? outer : inner
            // Flipped view: start at the top point (negative y is up).
            let a = CGFloat(k) * .pi / 5 - .pi / 2
            let pt = NSPoint(x: c.x + rad * cos(a), y: c.y + rad * sin(a))
            k == 0 ? p.move(to: pt) : p.line(to: pt)
        }
        p.close()
        return p
    }

    // MARK: Interaction

    override func mouseDown(with event: NSEvent) {
        guard let photo, event.clickCount == 1 else { super.mouseDown(with: event); return }
        let pt = convert(event.locationInWindow, from: nil)
        if tagRect.insetBy(dx: -4, dy: -4).contains(pt) {
            delegate?.cellToggledTag(photo)
            return
        }
        let sr = starsRect.insetBy(dx: -2, dy: -3)
        if sr.contains(pt) {
            let n = min(5, max(1, Int((pt.x - starsRect.minX) / 12) + 1))
            delegate?.cell(photo, setRating: n == photo.rating ? 0 : n)
            return
        }
        super.mouseDown(with: event)
    }
}
