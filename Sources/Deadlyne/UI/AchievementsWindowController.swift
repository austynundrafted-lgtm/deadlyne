import AppKit

/// Every badge, earned or locked, with progress toward the next one on each track.
final class AchievementsWindowController: NSWindowController {
    private let stack = NSStackView()

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 820, height: 700),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Achievements"
        window.minSize = NSSize(width: 540, height: 420)
        window.isReleasedWhenClosed = false
        super.init(window: window)
        build()
        reload()
        window.setFrameAutosaveName("DeadlyneAchievements")
        if !window.setFrameUsingName("DeadlyneAchievements") { window.center() }
        NotificationCenter.default.addObserver(self, selector: #selector(changed(_:)), name: Achievements.didChange, object: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    private func build() {
        guard let content = window?.contentView else { return }
        content.wantsLayer = true
        content.layer?.backgroundColor = BrowserViewController.background.cgColor

        let doc = FlippedView()
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.documentView = doc
        for v in [scroll, doc, stack] as [NSView] { v.translatesAutoresizingMaskIntoConstraints = false }
        content.addSubview(scroll)
        doc.addSubview(stack)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 0
        stack.edgeInsets = NSEdgeInsets(top: 26, left: 0, bottom: 36, right: 0)
        let width = stack.widthAnchor.constraint(equalTo: doc.widthAnchor, constant: -64)
        width.priority = .defaultHigh
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: content.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            doc.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            doc.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            doc.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            stack.topAnchor.constraint(equalTo: doc.topAnchor),
            stack.bottomAnchor.constraint(equalTo: doc.bottomAnchor),
            stack.centerXAnchor.constraint(equalTo: doc.centerXAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 1040),
            width,
        ])
    }

    @objc private func changed(_ note: Notification) { reload() }

    private func add(_ v: NSView, fullWidth: Bool = true, after spacing: CGFloat) {
        stack.addArrangedSubview(v)
        if fullWidth { v.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true }
        stack.setCustomSpacing(spacing, after: v)
    }

    private func label(_ s: String, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor) -> NSTextField {
        let l = NSTextField(labelWithString: s)
        l.font = .systemFont(ofSize: size, weight: weight)
        l.textColor = color
        return l
    }

    private func reload() {
        for v in stack.arrangedSubviews {
            stack.removeArrangedSubview(v)
            v.removeFromSuperview()
        }
        let s = Achievements.state
        let earnedCount = Achievements.earned.count
        add(label("Achievements", size: 24, weight: .bold, color: HomeStyle.title), fullWidth: false, after: 4)
        add(label("\(s.photos.grouped) \(Badge.Track.photos.unit(s.photos)) ingested  ·\(s.shoots.grouped) "
                  + "\(Badge.Track.shoots.unit(s.shoots))  ·  \(earnedCount) of \(Badges.all.count) badges earned",
                  size: 13, color: HomeStyle.secondary), fullWidth: false, after: 30)

        for track in Badge.Track.allCases {
            let value = s.value(track)
            let next = Achievements.next(track)
            let badges = Badges.all.filter { $0.track == track }

            let header = NSView()
            let title = label(track.title, size: 15, weight: .semibold, color: HomeStyle.title)
            let detail = label(next.map { "\(value.grouped) / \($0.threshold.grouped)  ·  "
                                          + "\(($0.threshold - value).grouped) to \($0.name)" }
                               ?? "All \(badges.count) earned",
                               size: 12.5, color: HomeStyle.secondary)
            detail.font = .monospacedDigitSystemFont(ofSize: 12.5, weight: .regular)
            for v in [title, detail] {
                v.translatesAutoresizingMaskIntoConstraints = false
                header.addSubview(v)
            }
            NSLayoutConstraint.activate([
                header.heightAnchor.constraint(equalToConstant: 22),
                title.leadingAnchor.constraint(equalTo: header.leadingAnchor),
                title.centerYAnchor.constraint(equalTo: header.centerYAnchor),
                detail.trailingAnchor.constraint(equalTo: header.trailingAnchor),
                detail.firstBaselineAnchor.constraint(equalTo: title.firstBaselineAnchor),
            ])
            add(header, after: 10)

            let bar = ProgressBarView()
            bar.fraction = next.map { Double(value) / Double($0.threshold) } ?? 1
            bar.heightAnchor.constraint(equalToConstant: 8).isActive = true
            add(bar, after: 18)

            let grid = TileGridView(minTileWidth: 150, spacing: 12) { _ in 196 }
            grid.tiles = badges.map { BadgeTile(badge: $0, earnedOn: s.earned[$0.id], value: value, isNext: $0 == next) }
            add(grid, after: 36)
        }

        let note = NSTextField(wrappingLabelWithString:
            "Every photo you ingest from a card counts, and so does every photo in a folder the first time you open it. "
            + "A RAW + JPG pair is one photo, and reopening a shoot or re-ingesting a card never counts a photo twice.")
        note.font = .systemFont(ofSize: 11.5)
        note.textColor = HomeStyle.tertiary
        note.preferredMaxLayoutWidth = 640
        add(note, fullWidth: false, after: 0)
    }
}
