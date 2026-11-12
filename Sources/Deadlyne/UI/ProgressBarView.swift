import AppKit

/// Progress for a running ingest job.
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
