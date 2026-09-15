import AppKit

/// The parts of Deadlyne you switch between from the title bar.
enum Workspace: Int, CaseIterable {
    case home, photos, codes

    var title: String {
        switch self {
        case .home: return "Home"
        case .photos: return "Photos"
        case .codes: return "Codes"
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house"
        case .photos: return "photo.on.rectangle.angled"
        case .codes: return "text.badge.plus"
        }
    }

    var help: String {
        switch self {
        case .home: return "Home (⌘1)"
        case .photos: return "Photos — cull and caption (⌘2)"
        case .codes: return "Code Replacements — lookup files and shorthand (⌘3)"
        }
    }

    /// Each workspace lights up in its own color from the Deadlyne palette, so it's obvious
    /// at a glance which part of the app you're in.
    var tint: NSColor {
        switch self {
        case .home: return HomeStyle.accent
        case .photos: return HomeStyle.warning
        case .codes: return HomeStyle.ready
        }
    }

    /// Text and icon color on top of `tint`.
    var onTint: NSColor {
        switch self {
        case .home: return .white
        case .photos, .codes: return NSColor(white: 0.07, alpha: 1)
        }
    }
}

/// Affinity-style workspace switcher for the title bar: the app icon, then a dark pill of
/// tabs where the active one is filled with its workspace's color.
final class WorkspaceTabBar: NSView {
    var onSelect: ((Workspace) -> Void)?

    var selection: Workspace = .home {
        didSet { applySelection() }
    }

    private var tabs: [WorkspaceTab] = []

    override init(frame: NSRect) {
        super.init(frame: frame)
        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.imageScaling = .scaleProportionallyUpOrDown

        let pill = NSStackView()
        pill.spacing = 2
        pill.edgeInsets = NSEdgeInsets(top: 3, left: 3, bottom: 3, right: 3)
        pill.wantsLayer = true
        pill.layer?.backgroundColor = NSColor(white: 0.1, alpha: 1).cgColor
        pill.layer?.cornerRadius = 11
        pill.layer?.borderWidth = 1
        pill.layer?.borderColor = NSColor(white: 1, alpha: 0.07).cgColor
        for w in Workspace.allCases {
            let tab = WorkspaceTab(workspace: w)
            tab.onClick = { [weak self] in self?.onSelect?(w) }
            tabs.append(tab)
            pill.addArrangedSubview(tab)
        }
        pill.setAccessibilityRole(.tabGroup)
        pill.setAccessibilityLabel("Workspace")

        let row = NSStackView(views: [icon, pill])
        row.spacing = 10
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 24),
            icon.heightAnchor.constraint(equalToConstant: 24),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12), // breathing room after the window buttons
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        applySelection() // didSet doesn't run for assignments made during init
    }

    private func applySelection() {
        tabs.forEach { $0.isSelected = $0.workspace == selection }
    }

    required init?(coder: NSCoder) { fatalError() }

    /// Lets the window be dragged by the empty parts of the bar, like the rest of the title bar.
    override var mouseDownCanMoveWindow: Bool { true }
}

private final class WorkspaceTab: HoverControl {
    let workspace: Workspace
    private let icon = NSImageView()
    private let label = NSTextField(labelWithString: "")

    var isSelected = false {
        didSet { if isSelected != oldValue { stateChanged() } }
    }

    init(workspace: Workspace) {
        self.workspace = workspace
        super.init(frame: .zero)
        wantsLayer = true
        toolTip = workspace.help
        icon.image = NSImage(systemSymbolName: workspace.symbol, accessibilityDescription: nil)
        icon.symbolConfiguration = .init(pointSize: 13, weight: .semibold)
        label.stringValue = workspace.title
        let row = NSStackView(views: [icon, label])
        row.spacing = 6
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 28),
            row.centerYAnchor.constraint(equalTo: centerYAnchor),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
        ])
        stateChanged()
    }

    required init?(coder: NSCoder) { fatalError() }

    override var wantsUpdateLayer: Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        stateChanged()
    }

    /// The fill is applied here rather than once when the state changes: the title bar may
    /// rebuild this view's layer when it hosts the tab bar.
    override func updateLayer() {
        let fill: NSColor
        if isSelected {
            fill = isPressed ? workspace.tint.blended(withFraction: 0.15, of: .black)! : workspace.tint
        } else {
            fill = isPressed ? NSColor(white: 1, alpha: 0.14) : isHovering ? NSColor(white: 1, alpha: 0.08) : .clear
        }
        layer?.cornerRadius = 8
        layer?.backgroundColor = fill.cgColor
    }

    override func stateChanged() {
        needsDisplay = true
        let fg = isSelected ? workspace.onTint
            : isHovering ? NSColor(white: 0.95, alpha: 1) : NSColor(white: 0.74, alpha: 1)
        icon.contentTintColor = fg
        label.textColor = fg
        label.font = .systemFont(ofSize: 13, weight: isSelected ? .semibold : .medium)
        setAccessibilityValue(isSelected ? "selected" : nil)
    }

    override func accessibilityRole() -> NSAccessibility.Role? { .radioButton }
    override func accessibilityLabel() -> String? { workspace.title }
}
