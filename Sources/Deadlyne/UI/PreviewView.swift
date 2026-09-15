import AppKit

protocol PreviewViewHandler: AnyObject {
    func previewHandleKey(_ event: NSEvent) -> Bool
    func previewClose()
}

/// Full-window loupe. Shows a cached screen-sized preview instantly, falls back to the scaled
/// thumbnail while decoding, and pans a full-resolution decode for 100% focus checks.
final class PreviewView: NSView {
    weak var handler: PreviewViewHandler?
    private(set) var photo: Photo?

    private let imageLayer = CALayer()
    private let hud = PreviewHUD()
    private var image: CGImage?
    private var isFullRes = false

    /// nil = fit to window; otherwise the image-space point shown at the view center at 100%.
    private var zoomCenter: CGPoint?
    private var dragStart: (NSPoint, CGPoint)?

    var showInfo = true { didSet { hud.isHidden = !showInfo } }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(white: 0.07, alpha: 1).cgColor
        imageLayer.contentsGravity = .resize
        imageLayer.magnificationFilter = .linear
        imageLayer.minificationFilter = .trilinear
        imageLayer.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull()]
        layer?.addSublayer(imageLayer)
        hud.translatesAutoresizingMaskIntoConstraints = false
        addSubview(hud)
        NSLayoutConstraint.activate([
            hud.leadingAnchor.constraint(equalTo: leadingAnchor),
            hud.trailingAnchor.constraint(equalTo: trailingAnchor),
            hud.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    override var acceptsFirstResponder: Bool { true }
    override var isFlipped: Bool { true }

    /// Pixel size to decode previews at so they are sharp on this display.
    var previewPixels: Int {
        let scale = window?.backingScaleFactor ?? 2
        let size = window?.screen?.frame.size ?? NSSize(width: 1728, height: 1117)
        return Int(max(size.width, size.height) * scale)
    }

    func show(_ photo: Photo, index: Int, count: Int) {
        let changed = self.photo !== photo
        self.photo = photo
        hud.update(photo, index: index, count: count)
        guard changed else { return }
        zoomCenter = nil
        isFullRes = false

        if let img = ImagePipeline.shared.cachedPreview(photo) {
            setImage(img)
        } else {
            // Show the thumbnail scaled up immediately so navigation never blocks.
            setImage(ImagePipeline.shared.cachedThumbnail(photo))
            ImagePipeline.shared.preview(for: photo, maxPixels: previewPixels) { [weak self] img in
                guard let self, self.photo === photo, !self.isFullRes, let img else { return }
                self.setImage(img)
            }
        }
    }

    func refreshHUD(index: Int, count: Int) {
        if let photo { hud.update(photo, index: index, count: count) }
    }

    private func setImage(_ img: CGImage?) {
        image = img
        imageLayer.contents = img
        needsLayout = true
        layoutImage()
    }

    // MARK: Zoom

    func toggleZoom(at viewPoint: NSPoint? = nil) {
        guard let photo, let image else { return }
        if zoomCenter != nil {
            zoomCenter = nil
            layoutImage()
            return
        }
        // Map the clicked point into normalized image coordinates.
        let fit = fitRect(for: CGSize(width: image.width, height: image.height))
        let p = viewPoint ?? NSPoint(x: bounds.midX, y: bounds.midY)
        let nx = min(max((p.x - fit.minX) / fit.width, 0), 1)
        let ny = min(max((p.y - fit.minY) / fit.height, 0), 1)
        let normalized = CGPoint(x: nx, y: ny)
        zoomCenter = normalized
        layoutImage()
        guard !isFullRes else { return }
        ImagePipeline.shared.fullResolution(for: photo) { [weak self] img in
            guard let self, self.photo === photo, let img else { return }
            self.isFullRes = true
            self.image = img
            self.imageLayer.contents = img
            self.layoutImage()
        }
    }

    var isZoomed: Bool { zoomCenter != nil }

    private func fitRect(for size: CGSize) -> CGRect {
        guard size.width > 0, size.height > 0 else { return .zero }
        let avail = bounds.insetBy(dx: 12, dy: 12)
        let s = min(avail.width / size.width, avail.height / size.height)
        let w = size.width * s, h = size.height * s
        return CGRect(x: bounds.midX - w / 2, y: bounds.midY - h / 2, width: w, height: h)
    }

    /// Full sensor size in points at 100% (one image pixel per screen pixel).
    private var actualSize: CGSize {
        guard let photo, let image else { return .zero }
        let scale = window?.backingScaleFactor ?? 2
        var w = CGFloat(photo.pixelWidth), h = CGFloat(photo.pixelHeight)
        if w == 0 || h == 0 { w = CGFloat(image.width); h = CGFloat(image.height) }
        // Match the displayed orientation (the image is already rotated).
        if (image.width > image.height) != (w > h) { swap(&w, &h) }
        return CGSize(width: w / scale, height: h / scale)
    }

    override func layout() {
        super.layout()
        layoutImage()
    }

    private func layoutImage() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        guard let image else { imageLayer.frame = .zero; return }
        imageLayer.contentsScale = window?.backingScaleFactor ?? 2
        guard let c = zoomCenter else {
            imageLayer.frame = fitRect(for: CGSize(width: image.width, height: image.height))
            return
        }
        let size = actualSize
        var x = bounds.midX - c.x * size.width
        var y = bounds.midY - c.y * size.height
        // Keep the image edge-to-edge when larger than the view; center it otherwise.
        x = size.width > bounds.width ? min(0, max(bounds.width - size.width, x)) : (bounds.width - size.width) / 2
        y = size.height > bounds.height ? min(0, max(bounds.height - size.height, y)) : (bounds.height - size.height) / 2
        imageLayer.frame = CGRect(x: x, y: y, width: size.width, height: size.height)
    }

    // MARK: Events

    override func keyDown(with event: NSEvent) {
        if handler?.previewHandleKey(event) == true { return }
        super.keyDown(with: event)
    }

    /// Click toggles fit ↔ 100% at the clicked point; dragging while zoomed pans.
    override func mouseDown(with event: NSEvent) {
        let pt = convert(event.locationInWindow, from: nil)
        wasZoomedAtMouseDown = zoomCenter != nil
        if !wasZoomedAtMouseDown { toggleZoom(at: pt) }
        dragStart = zoomCenter.map { (pt, $0) }
    }

    override func mouseDragged(with event: NSEvent) {
        guard let (start, center) = dragStart, zoomCenter != nil else { return }
        let pt = convert(event.locationInWindow, from: nil)
        let size = actualSize
        guard size.width > 0 else { return }
        var c = CGPoint(x: center.x - (pt.x - start.x) / size.width, y: center.y - (pt.y - start.y) / size.height)
        let hx = min(0.5, bounds.width / size.width / 2), hy = min(0.5, bounds.height / size.height / 2)
        c.x = min(max(c.x, hx), 1 - hx)
        c.y = min(max(c.y, hy), 1 - hy)
        zoomCenter = c
        layoutImage()
    }

    override func mouseUp(with event: NSEvent) {
        defer { dragStart = nil }
        guard wasZoomedAtMouseDown, let (start, _) = dragStart else { return }
        let pt = convert(event.locationInWindow, from: nil)
        if hypot(pt.x - start.x, pt.y - start.y) < 3 {
            zoomCenter = nil
            layoutImage()
        }
    }

    private var wasZoomedAtMouseDown = false

    override func scrollWheel(with event: NSEvent) {
        guard let c = zoomCenter else { return }
        let size = actualSize
        guard size.width > 0 else { return }
        var n = CGPoint(x: c.x - event.scrollingDeltaX / size.width, y: c.y - event.scrollingDeltaY / size.height)
        let hx = min(0.5, bounds.width / size.width / 2), hy = min(0.5, bounds.height / size.height / 2)
        n.x = min(max(n.x, hx), 1 - hx)
        n.y = min(max(n.y, hy), 1 - hy)
        zoomCenter = n
        layoutImage()
    }
}

/// Bottom overlay: file name, position, capture info, culling state.
final class PreviewHUD: NSView {
    private let left = NSTextField(labelWithString: "")
    private let right = NSTextField(labelWithString: "")
    private let badge = NSTextField(labelWithString: "")

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(white: 0, alpha: 0.55).cgColor
        for f in [left, right, badge] {
            f.translatesAutoresizingMaskIntoConstraints = false
            f.textColor = NSColor(white: 0.9, alpha: 1)
            f.lineBreakMode = .byTruncatingTail
            addSubview(f)
        }
        left.font = .systemFont(ofSize: 12, weight: .medium)
        right.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        right.alignment = .right
        badge.font = .systemFont(ofSize: 12, weight: .semibold)
        right.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 34),
            left.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            left.centerYAnchor.constraint(equalTo: centerYAnchor),
            badge.leadingAnchor.constraint(equalTo: left.trailingAnchor, constant: 14),
            badge.centerYAnchor.constraint(equalTo: centerYAnchor),
            right.leadingAnchor.constraint(greaterThanOrEqualTo: badge.trailingAnchor, constant: 14),
            right.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            right.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func update(_ p: Photo, index: Int, count: Int) {
        left.stringValue = "\(p.displayName)\(p.isPair ? " + JPG" : "")   \(index + 1) / \(count)"
        let badgeText = NSMutableAttributedString()
        if p.tagged {
            badgeText.append(NSAttributedString(string: "✓ TAGGED   ", attributes: [
                .foregroundColor: NSColor(calibratedRed: 1, green: 0.62, blue: 0.1, alpha: 1)]))
        }
        if p.rating > 0 {
            badgeText.append(NSAttributedString(string: String(repeating: "★", count: p.rating) + "   ", attributes: [
                .foregroundColor: NSColor(calibratedRed: 1, green: 0.8, blue: 0.25, alpha: 1)]))
        }
        if let l = p.label {
            badgeText.append(NSAttributedString(string: "● \(l.rawValue)", attributes: [.foregroundColor: l.color]))
        }
        badgeText.addAttribute(.font, value: NSFont.systemFont(ofSize: 12, weight: .semibold),
                               range: NSRange(location: 0, length: badgeText.length))
        badge.attributedStringValue = badgeText
        var info = [p.exifSummary]
        if !p.lens.isEmpty { info.append(p.lens) }
        if let d = p.captureDate { info.append(Photo.dateFormatter.string(from: d)) }
        right.stringValue = info.filter { !$0.isEmpty }.joined(separator: "     ")
    }
}
