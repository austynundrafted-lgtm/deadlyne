import AppKit

protocol HomeViewControllerDelegate: AnyObject {
    /// Open the Ingest window, with `card` preselected as the source if given.
    func homeIngest(from card: URL?)
    func homeOpenFolderPanel()
    func homeOpen(_ url: URL)
    func homeEditProfile()
    func homeShowAchievements()
}

/// The screen Deadlyne opens to, laid out in the order of the job: start work (ingest, open,
/// continue), what's happening right now (connected cards, an ingest in progress), recent shoots,
/// the ingest setup, then a one-line stats strip and a short shortcut reference.
/// Covers and card contents are read on background queues, so the screen itself appears instantly.
final class HomeViewController: NSViewController {
    weak var delegate: HomeViewControllerDelegate?

    private let content = NSStackView()
    private let profileChip = ProfileChip()
    private let greeting = NSTextField(labelWithString: "")
    private let statusLine = NSTextField(labelWithString: "")
    private let actionRow = NSStackView()
    private let ingestCard = HomeCard(style: .accent)
    private let openCard = HomeCard(style: .neutral)
    private let continueCard = HomeCard(style: .image)
    private var continueShoot: RecentShoot?

    // Live area: connected cards and a running ingest. Hidden when there's nothing to show.
    private let activityStack = NSStackView()
    private let ingestPanel = ActivityPanel()
    private var cardPanels: [String: ActivityPanel] = [:]
    private var cards: [URL] = []
    private var cardInfo: [String: CardInfo] = [:]
    private var inspectingCards: Set<String> = []

    private let profilePrompt = NSView()
    private let promptBody = NSTextField(wrappingLabelWithString: "")

    private let recentMore = HomeStyle.link("", target: nil, action: nil)
    private let recentBox = NSStackView()
    private let recentEmpty = NSTextField(wrappingLabelWithString: "")
    private var showAllRecents = false
    private var rows: [String: ShootRow] = [:]
    private var covers: [String: ShootCover] = [:]
    private var loadingCovers: Set<String> = []

    private let destinationCell = WorkflowCell()
    private let foldersCell = WorkflowCell()
    private let namesCell = WorkflowCell()
    private let afterCell = WorkflowCell()

    private let workflowRow = NSStackView()
    private weak var scrollView: NSScrollView?
    private var docWidth: NSLayoutConstraint!
    private var contentMargin: NSLayoutConstraint!
    private var contentCap: NSLayoutConstraint!
    private var actionRowHeight: NSLayoutConstraint!
    private var narrowLayout: Bool?
    private var stackedWorkflowWidths: [NSLayoutConstraint] = []

    private let statsStrip = HomeStatsStrip()
    private let shortcutsGrid = TileGridView(minTileWidth: 230, spacing: 10) { _ in 30 }
    private let shortcutsToggle = HomeStyle.link("", target: nil, action: nil)

    private static let coverQueue = DispatchQueue(label: "deadlyne.home.covers", qos: .userInitiated, attributes: .concurrent)
    private static let promptDismissedKey = "profilePromptDismissed"
    private static let allShortcutsKey = "homeShowAllShortcuts"
    private static let recentsShown = 5
    /// Below this much free space on the destination, Home warns before an ingest.
    private static let lowSpace: Int64 = 25_000_000_000

    // MARK: Building

    override func loadView() {
        let root = DropTargetView()
        root.takesFocus = true
        root.onDrop = { [weak self] url in self?.delegate?.homeOpen(url) }
        root.wantsLayer = true
        root.layer?.backgroundColor = BrowserViewController.background.cgColor
        view = root

        let doc = FlippedView()
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.documentView = doc
        for v in [scroll, doc, content] as [NSView] { v.translatesAutoresizingMaskIntoConstraints = false }
        root.addSubview(scroll)
        doc.addSubview(content)

        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 0
        content.detachesHiddenViews = true
        content.edgeInsets = NSEdgeInsets(top: 22, left: 0, bottom: 44, right: 0)

        // Window width minus margins that grow with the window, so Home fills wide
        // displays instead of leaving black bars. Both constants are re-tuned for the
        // current window in viewDidLayout(); see applyMetrics().
        // A constant, not `doc.width == clipView.width`: tying them together lets the
        // content's preferred width travel up through the scroll view to the window, and
        // AppKit then shrinks the window itself to fit. The constant is kept in step with
        // the scroll view in applyMetrics().
        scrollView = scroll
        docWidth = doc.widthAnchor.constraint(equalToConstant: 0)
        contentMargin = content.widthAnchor.constraint(equalTo: doc.widthAnchor, constant: -88)
        contentMargin.priority = .defaultHigh
        contentCap = content.widthAnchor.constraint(lessThanOrEqualToConstant: 1120)
        // Breakable: a required maximum here would fight the minimum width of the rows
        // inside, and Auto Layout resolves that by resizing the window itself.
        contentCap.priority = .required - 1
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: root.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            doc.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            doc.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            docWidth,
            content.topAnchor.constraint(equalTo: doc.topAnchor),
            content.bottomAnchor.constraint(equalTo: doc.bottomAnchor),
            content.centerXAnchor.constraint(equalTo: doc.centerXAnchor),
            contentCap,
            contentMargin,
        ])

        add(buildHeader(), after: 36)

        greeting.font = .systemFont(ofSize: 30, weight: .bold)
        greeting.textColor = HomeStyle.title
        statusLine.font = .systemFont(ofSize: 13)
        statusLine.textColor = HomeStyle.secondary
        add(greeting, fullWidth: false, after: 5)
        add(statusLine, fullWidth: false, after: 24)

        buildActionRow()
        add(actionRow, after: 20)

        buildActivityArea()
        add(activityStack, after: 20)

        buildProfilePrompt()
        add(profilePrompt, after: 20)

        // Recent shoots
        let menuButton = NSButton(image: NSImage(systemSymbolName: "ellipsis.circle", accessibilityDescription: "Recent shoots options")!,
                                  target: self, action: #selector(showRecentsMenu(_:)))
        menuButton.isBordered = false
        menuButton.contentTintColor = HomeStyle.secondary
        menuButton.toolTip = "Show all or clear recent shoots"
        recentMore.target = self
        recentMore.action = #selector(toggleAllRecents(_:))
        add(sectionHeader("Recent shoots", accessory: menuButton, trailing: recentMore), after: 12)
        recentBox.orientation = .vertical
        recentBox.spacing = 0
        recentBox.wantsLayer = true
        recentBox.layer?.backgroundColor = HomeStyle.panelFill.cgColor
        recentBox.layer?.cornerRadius = 12
        recentBox.layer?.borderWidth = 1
        recentBox.layer?.borderColor = HomeStyle.panelBorder.cgColor
        recentBox.layer?.masksToBounds = true
        add(recentBox, after: 0)
        recentEmpty.stringValue = "Shoots you open or ingest will show up here, with how far you got culling each one."
        recentEmpty.font = .systemFont(ofSize: 12.5)
        recentEmpty.preferredMaxLayoutWidth = 420
        recentEmpty.textColor = HomeStyle.secondary
        add(recentEmpty, fullWidth: false, after: 0)
        add(NSView(), after: 40)

        // Ingest setup
        let openIngest = HomeStyle.link("Open Ingest…", target: self, action: #selector(openIngest(_:)))
        add(sectionHeader("Ingest setup", accessory: nil, trailing: openIngest), after: 12)
        let workflow = workflowRow
        for c in [destinationCell, foldersCell, namesCell, afterCell] { workflow.addArrangedSubview(c) }
        workflow.distribution = .fillEqually
        workflow.spacing = 12
        destinationCell.onClick = { [weak self] in self?.chooseDestination() }
        for c in [foldersCell, namesCell, afterCell] { c.onClick = { [weak self] in self?.delegate?.homeIngest(from: nil) } }
        add(workflow, after: 40)

        statsStrip.onClick = { [weak self] in self?.delegate?.homeShowAchievements() }
        add(statsStrip, after: 40)

        shortcutsToggle.target = self
        shortcutsToggle.action = #selector(toggleShortcuts(_:))
        add(sectionHeader("Keyboard shortcuts", accessory: nil, trailing: shortcutsToggle), after: 14)
        add(shortcutsGrid, after: 30)
        refreshShortcuts()

        let footer = NSTextField(wrappingLabelWithString:
            "Deadlyne reads the JPEG previews already inside your RAW files, so thousand-frame shoots open instantly. "
            + "Drop a folder anywhere on this window to open it.")
        footer.font = .systemFont(ofSize: 12)
        footer.textColor = HomeStyle.secondary
        footer.preferredMaxLayoutWidth = 640
        add(footer, fullWidth: false, after: 0)

        Self.letLabelsCompress(root)
    }

    /// Labels default to refusing to shrink, which gives the whole window a minimum
    /// width as wide as its longest sentence — AppKit then snaps a new window to that
    /// width, and the window can't be made narrower. Home wraps and truncates instead.
    static func letLabelsCompress(_ view: NSView) {
        if let label = view as? NSTextField, !label.isEditable {
            label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        }
        view.subviews.forEach(letLabelsCompress)
    }

    private static let shortcuts: [(String, String)] = [
        // The essentials, always shown.
        ("T", "Tag / untag"), ("1 – 5", "Star rating"), ("6 – 9", "Color label"), ("Space", "Loupe preview"),
        ("Z", "100% focus check"), ("⇧⌘I", "Ingest from card"),
        // "View all shortcuts" adds these.
        ("⇧⌘A", "Auto-advance"), ("⌘I", "Caption panel"), ("⌥⌘P", "Fill credits from profile"), ("⌘F", "Search captions"),
        ("⇧⌘C", "Copy tagged to…"), ("⇧⌘T", "Select tagged"), ("⌥⌘1 – 3", "All / tagged / untagged"),
        ("⌘O", "Open folder"), ("⌘1 – 3", "Home / Photos / Codes"), ("⇧⌘H", "Home ↔ photos"), ("⌘,", "Profile"),
    ]
    private static let essentialShortcuts = 6

    private func add(_ v: NSView, fullWidth: Bool = true, after spacing: CGFloat) {
        content.addArrangedSubview(v)
        if fullWidth { v.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true }
        content.setCustomSpacing(spacing, after: v)
    }

    private func buildHeader() -> NSView {
        let header = NSView()
        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.imageScaling = .scaleProportionallyUpOrDown
        let brand = NSTextField(labelWithAttributedString: NSAttributedString(string: "Deadlyne", attributes: [
            .font: NSFont.systemFont(ofSize: 16, weight: .bold), .foregroundColor: HomeStyle.title, .kern: 0.3,
        ]))
        let brandRow = NSStackView(views: [icon, brand])
        brandRow.spacing = 7
        profileChip.onClick = { [weak self] in self?.delegate?.homeEditProfile() }
        for v in [brandRow, profileChip] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            header.addSubview(v)
        }
        NSLayoutConstraint.activate([
            header.heightAnchor.constraint(equalToConstant: 40),
            icon.widthAnchor.constraint(equalToConstant: 30),
            icon.heightAnchor.constraint(equalToConstant: 30),
            brandRow.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: -4),
            brandRow.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            profileChip.trailingAnchor.constraint(equalTo: header.trailingAnchor),
            profileChip.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            profileChip.leadingAnchor.constraint(greaterThanOrEqualTo: brandRow.trailingAnchor, constant: 16),
        ])
        return header
    }

    private func buildActionRow() {
        actionRow.orientation = .horizontal
        actionRow.distribution = .fillEqually
        actionRow.spacing = 16
        actionRow.detachesHiddenViews = true
        actionRowHeight = actionRow.heightAnchor.constraint(equalToConstant: 172)
        actionRowHeight.isActive = true

        ingestCard.symbol = "sdcard.fill"
        ingestCard.title = "Ingest Photos"
        ingestCard.onClick = { [weak self] in self?.delegate?.homeIngest(from: self?.cards.first) }

        openCard.symbol = "folder.fill"
        openCard.title = "Open Folder"
        openCard.subtitle = "Browse any folder of RAW + JPG files — no import, no waiting."
        openCard.badge.text = "⌘O"
        openCard.onClick = { [weak self] in self?.delegate?.homeOpenFolderPanel() }

        continueCard.symbol = "play.fill"
        continueCard.onClick = { [weak self] in
            if let s = self?.continueShoot { self?.open(s) }
        }

        for card in [ingestCard, openCard, continueCard] { actionRow.addArrangedSubview(card) }
    }

    private func buildActivityArea() {
        activityStack.orientation = .vertical
        activityStack.spacing = 10
        activityStack.detachesHiddenViews = true
        activityStack.addArrangedSubview(ingestPanel)
        ingestPanel.widthAnchor.constraint(equalTo: activityStack.widthAnchor).isActive = true
        ingestPanel.symbol = "square.and.arrow.down.fill"
        ingestPanel.secondaryTitle = "Stop"
        ingestPanel.onSecondary = { IngestActivity.stop() }
        ingestPanel.primaryTitle = "Show"
        ingestPanel.onPrimary = { [weak self] in self?.delegate?.homeIngest(from: nil) }
        ingestPanel.isHidden = true
    }

    private func buildProfilePrompt() {
        profilePrompt.wantsLayer = true
        profilePrompt.layer?.backgroundColor = HomeStyle.panelFill.cgColor
        profilePrompt.layer?.cornerRadius = 14
        profilePrompt.layer?.borderWidth = 1
        profilePrompt.layer?.borderColor = HomeStyle.panelBorder.cgColor

        let icon = NSImageView(image: NSImage(systemSymbolName: "person.crop.circle.badge.plus", accessibilityDescription: nil)!)
        icon.symbolConfiguration = .init(pointSize: 28, weight: .light)
        icon.contentTintColor = HomeStyle.accent
        let title = NSTextField(labelWithString: "Make Deadlyne yours — optional")
        title.font = .systemFont(ofSize: 14, weight: .semibold)
        title.textColor = HomeStyle.title
        promptBody.stringValue = "Add your name, credit line and copyright once. Deadlyne greets you by name and fills "
            + "Photographer, Credit and Copyright into captions with ⌥⌘P. It stays on this Mac — no account."
        promptBody.font = .systemFont(ofSize: 12)
        promptBody.textColor = HomeStyle.secondary
        promptBody.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        // A wrapping label reports its whole sentence as its minimum width until it is
        // told where to wrap, which would make the window that wide.
        promptBody.preferredMaxLayoutWidth = 360
        let text = NSStackView(views: [title, promptBody])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 3
        text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        text.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let notNow = NSButton(title: "Not Now", target: self, action: #selector(dismissPrompt(_:)))
        let create = NSButton(title: "Create Profile", target: self, action: #selector(editProfile(_:)))
        create.bezelColor = HomeStyle.accent
        let row = NSStackView(views: [icon, text, notNow, create])
        row.spacing = 12
        row.alignment = .centerY
        row.edgeInsets = NSEdgeInsets(top: 16, left: 18, bottom: 16, right: 18)
        row.setCustomSpacing(16, after: icon)
        row.setCustomSpacing(20, after: text)
        row.translatesAutoresizingMaskIntoConstraints = false
        profilePrompt.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: profilePrompt.topAnchor),
            row.bottomAnchor.constraint(equalTo: profilePrompt.bottomAnchor),
            row.leadingAnchor.constraint(equalTo: profilePrompt.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: profilePrompt.trailingAnchor),
        ])
    }

    /// A section title, an optional control right beside it, and an optional one at the far right.
    private func sectionHeader(_ title: String, accessory: NSView?, trailing: NSView?) -> NSView {
        let header = NSView()
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 15, weight: .semibold)
        label.textColor = HomeStyle.title
        let left = NSStackView(views: [label] + (accessory.map { [$0] } ?? []))
        left.spacing = 6
        left.alignment = .centerY
        left.translatesAutoresizingMaskIntoConstraints = false
        header.addSubview(left)
        var constraints = [
            header.heightAnchor.constraint(equalToConstant: 24),
            left.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            left.centerYAnchor.constraint(equalTo: header.centerYAnchor),
        ]
        if let trailing {
            trailing.translatesAutoresizingMaskIntoConstraints = false
            header.addSubview(trailing)
            constraints += [
                trailing.trailingAnchor.constraint(equalTo: header.trailingAnchor),
                trailing.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            ]
        }
        NSLayoutConstraint.activate(constraints)
        return header
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let nc = NotificationCenter.default
        for name in [RecentShoots.didChange, Profile.didChange, Achievements.didChange, IngestSettings.didChange, IngestActivity.didChange] {
            nc.addObserver(self, selector: #selector(changed(_:)), name: name, object: nil)
        }
        nc.addObserver(self, selector: #selector(ingestProgressed(_:)), name: IngestActivity.didProgress, object: nil)
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(self, selector: #selector(changed(_:)), name: NSWorkspace.didMountNotification, object: nil)
        ws.addObserver(self, selector: #selector(changed(_:)), name: NSWorkspace.didUnmountNotification, object: nil)
        refresh()
    }

    override func viewDidLayout() {
        super.viewDidLayout()
        applyMetrics()
        // Everything in the prompt's row except the text: icon, buttons, insets and spacing.
        let w = max(220, profilePrompt.frame.width - 330)
        if abs(promptBody.preferredMaxLayoutWidth - w) > 0.5 { promptBody.preferredMaxLayoutWidth = w }
    }

    /// Fits Home to the window: side margins scale with the width so a 32" display is
    /// filled rather than letterboxed, and the columns stack once they'd get cramped.
    private func applyMetrics() {
        let window = view.bounds.width
        guard window > 0 else { return }
        if let clip = scrollView?.contentView, abs(docWidth.constant - clip.bounds.width) > 0.5 {
            docWidth.constant = clip.bounds.width
        }
        // ~4.5% per side, never tighter than 20pt and never a luxurious void.
        let margin = min(max(20, (window * 0.045).rounded()), 120)
        if abs(contentMargin.constant + margin * 2) > 0.5 { contentMargin.constant = -margin * 2 }
        // Only ultra-wide displays hit the cap; below it Home is edge-to-edge.
        let cap = max(640, min(window - margin * 2, 2400))
        if abs(contentCap.constant - cap) > 0.5 { contentCap.constant = cap }
        applyBreakpoints(contentWidth: min(window - margin * 2, cap))
    }

    /// Rows that read fine side by side on a wide window but not on a small one.
    private func applyBreakpoints(contentWidth: CGFloat) {
        let narrow = contentWidth < 700
        if narrowLayout != narrow {
            narrowLayout = narrow
            actionRow.orientation = narrow ? .vertical : .horizontal
            workflowRow.orientation = narrow ? .vertical : .horizontal
            workflowRow.alignment = narrow ? .leading : .centerY
            workflowRow.distribution = narrow ? .fill : .fillEqually
            if stackedWorkflowWidths.isEmpty {
                stackedWorkflowWidths = [destinationCell, foldersCell, namesCell, afterCell].map {
                    $0.widthAnchor.constraint(equalTo: workflowRow.widthAnchor)
                }
            }
            for c in stackedWorkflowWidths { c.isActive = narrow }
        }
        refreshActionRowHeight()
    }

    private func refreshActionRowHeight() {
        guard actionRowHeight != nil else { return }
        let height: CGFloat
        if narrowLayout == true {
            let visible = [ingestCard, openCard, continueCard].filter { !$0.isHidden }.count
            height = CGFloat(visible) * 132 + CGFloat(max(0, visible - 1)) * actionRow.spacing
        } else {
            height = 172
        }
        if abs(actionRowHeight.constant - height) > 0.5 { actionRowHeight.constant = height }
    }

    // MARK: Content

    @objc private func changed(_ note: Notification) { refresh() }

    @objc private func ingestProgressed(_ note: Notification) {
        refreshIngestPanel()
        refreshIngestCard()
    }

    func refresh() {
        guard isViewLoaded else { return }
        let profile = Profile.current
        greeting.stringValue = Self.greeting(for: profile)
        profileChip.show(profile)
        cards = IngestEngine.memoryCards()

        refreshStatusLine()
        refreshIngestCard()
        refreshContinueCard()
        refreshActivity()
        profilePrompt.isHidden = profile != nil || UserDefaults.standard.bool(forKey: Self.promptDismissedKey)
        refreshRecents()
        refreshWorkflow()
        statsStrip.refresh()
        refreshActionRowHeight()
    }

    /// The date, plus what Deadlyne is doing right now, if anything.
    private func refreshStatusLine() {
        var line = Self.dayFormatter.string(from: Date())
        if IngestActivity.current != nil {
            line += "  ·  Ingest in progress"
        } else if cards.count == 1 {
            line += "  ·  Memory card connected"
        } else if cards.count > 1 {
            line += "  ·  \(cards.count) memory cards connected"
        }
        statusLine.stringValue = line
    }

    private func refreshIngestCard() {
        if let job = IngestActivity.current {
            ingestCard.badge.text = "Copying"
            ingestCard.badge.dotColor = HomeStyle.ready
            if let p = job.progress, p.filesTotal > 0 {
                ingestCard.subtitle = "Copying \(p.filesDone.grouped) of \(p.filesTotal.grouped) files from "
                    + "“\(job.source.lastPathComponent)” — \(Int(p.fraction * 100))%"
            } else {
                ingestCard.subtitle = "Reading “\(job.source.lastPathComponent)”…"
            }
        } else if let card = cards.first {
            ingestCard.badge.text = "Card ready"
            ingestCard.badge.dotColor = HomeStyle.ready
            if let info = cardInfo[card.path], info.photos > 0 {
                ingestCard.subtitle = "“\(card.lastPathComponent)” — \(info.photos.grouped) photos "
                    + "(\(HomeStyle.bytes(info.bytes))) ready to copy."
            } else {
                ingestCard.subtitle = "“\(card.lastPathComponent)” is connected. Copy it into a job folder and start culling."
            }
        } else {
            ingestCard.subtitle = "Copy a memory card into a dated job folder, then start culling."
            ingestCard.badge.text = "⇧⌘I"
            ingestCard.badge.dotColor = nil
        }
    }

    /// The most recently opened shoot that's still on disk, with exactly where culling stopped.
    private func refreshContinueCard() {
        continueShoot = RecentShoots.all
            .filter { FileManager.default.fileExists(atPath: $0.path) }
            .max { $0.lastOpened < $1.lastOpened }
        continueCard.isHidden = continueShoot == nil
        guard let s = continueShoot else { return }
        let photos = s.photoCount ?? covers[s.path]?.photoCount
        let name = s.display
        continueCard.title = name.title
        continueCard.subtitle = s.progressLine(photos: photos)
        continueCard.callToAction = s.callToAction(photos: photos)
        continueCard.progress = s.reviewedFraction(photos: photos)
        continueCard.badge.text = name.context ?? "Last shoot"
        continueCard.image = covers[s.path]?.image
        continueCard.toolTip = "\(s.name)\n\((s.path as NSString).abbreviatingWithTildeInPath)"
    }

    // MARK: Live activity

    private func refreshActivity() {
        refreshIngestPanel()
        let live = Set(cards.map(\.path))
        for path in Array(cardPanels.keys) where !live.contains(path) {
            cardPanels[path]?.removeFromSuperview()
            cardPanels[path] = nil
            cardInfo[path] = nil
        }
        let ingesting = IngestActivity.current?.source.standardizedFileURL.path
        for card in cards {
            let panel = cardPanels[card.path] ?? makeCardPanel(card.path)
            panel.isHidden = card.standardizedFileURL.path == ingesting
            configure(panel, for: card)
            inspectIfNeeded(card)
        }
        updateActivityVisibility()
    }

    private func makeCardPanel(_ path: String) -> ActivityPanel {
        let p = ActivityPanel()
        activityStack.addArrangedSubview(p)
        p.widthAnchor.constraint(equalTo: activityStack.widthAnchor).isActive = true
        cardPanels[path] = p
        return p
    }

    private func updateActivityVisibility() {
        activityStack.isHidden = activityStack.arrangedSubviews.allSatisfy(\.isHidden)
    }

    private func configure(_ panel: ActivityPanel, for card: URL) {
        let info = cardInfo[card.path]
        panel.symbol = "sdcard.fill"
        let camera = info?.camera ?? ""
        panel.title = camera.isEmpty ? "“\(card.lastPathComponent)”" : "\(camera)  ·  \(card.lastPathComponent)"
        if let info {
            panel.detail = info.photos == 0 ? "No photos on this card"
                : "\(info.photos.grouped) photo\(info.photos == 1 ? "" : "s")  ·  \(HomeStyle.bytes(info.bytes))"
        } else {
            panel.detail = "Reading card…"
        }
        let (note, tone) = storageNote(needing: info?.bytes)
        panel.note = note
        panel.noteTone = tone
        panel.fraction = nil
        panel.secondaryTitle = "Eject"
        panel.onSecondary = { [weak self] in self?.eject(card) }
        panel.primaryTitle = "Ingest…"
        panel.onPrimary = { [weak self] in self?.delegate?.homeIngest(from: card) }
    }

    /// Where the card will go, and whether it fits — before thousands of RAWs start copying.
    private func storageNote(needing bytes: Int64?) -> (String, HomeStyle.Tone) {
        guard let dest = IngestSettings.destination else {
            return ("No destination set yet — choose one under Ingest setup.", .warning)
        }
        guard let free = Self.freeSpace(at: dest) else {
            return ("The destination, “\(dest.lastPathComponent)”, isn’t connected.", .warning)
        }
        if let bytes, bytes > 0, free < bytes + bytes / 20 {
            return ("Not enough space: “\(dest.lastPathComponent)” has \(HomeStyle.bytes(free)) free and this card holds "
                    + "\(HomeStyle.bytes(bytes)).", .danger)
        }
        if free < Self.lowSpace { return ("Low space: \(HomeStyle.bytes(free)) free on “\(dest.lastPathComponent)”.", .warning) }
        return ("Copies to “\(dest.lastPathComponent)”  ·  \(HomeStyle.bytes(free)) free", .normal)
    }

    private func inspectIfNeeded(_ card: URL) {
        let key = card.path
        guard cardInfo[key] == nil, inspectingCards.insert(key).inserted else { return }
        Self.coverQueue.async {
            let info = IngestEngine.inspect(card: card)
            DispatchQueue.main.async {
                self.inspectingCards.remove(key)
                guard self.cards.contains(where: { $0.path == key }) else { return }
                self.cardInfo[key] = info
                if let panel = self.cardPanels[key] { self.configure(panel, for: card) }
                self.refreshIngestCard()
            }
        }
    }

    private func refreshIngestPanel() {
        defer { updateActivityVisibility() }
        guard let job = IngestActivity.current else {
            ingestPanel.isHidden = true
            return
        }
        ingestPanel.isHidden = false
        let source = job.source.lastPathComponent
        guard let p = job.progress, p.filesTotal > 0 else {
            ingestPanel.title = "Reading “\(source)”…"
            ingestPanel.fraction = 0
            ingestPanel.detail = "Finding photos and reading capture times"
            ingestPanel.note = ""
            return
        }
        ingestPanel.title = "Copying from “\(source)”  ·  \(Int(p.fraction * 100))%"
        ingestPanel.fraction = p.fraction
        let into = p.folder.isEmpty ? job.destination.lastPathComponent : "\(job.destination.lastPathComponent)/\(p.folder)"
        ingestPanel.detail = "\(p.filesDone.grouped) of \(p.filesTotal.grouped) files  ·  to \(into)"
        var note = "\(HomeStyle.bytes(max(0, p.bytesTotal - p.bytesDone))) remaining"
        if let started = job.copyStarted, p.fraction > 0.02, p.fraction < 1 {
            let elapsed = Date().timeIntervalSince(started)
            if elapsed > 3, let eta = Self.durationFormatter.string(from: elapsed / p.fraction * (1 - p.fraction)) {
                note += "  ·  about \(eta) left"
            }
        }
        ingestPanel.note = note
        ingestPanel.noteTone = .normal
    }

    private func eject(_ card: URL) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try NSWorkspace.shared.unmountAndEjectDevice(at: card)
            } catch {
                DispatchQueue.main.async {
                    guard let window = self.view.window else { return }
                    let a = NSAlert()
                    a.messageText = "Couldn’t eject “\(card.lastPathComponent)”"
                    a.informativeText = error.localizedDescription
                    a.beginSheetModal(for: window)
                }
            }
        }
    }

    // MARK: Recent shoots

    private func refreshRecents() {
        let shoots = RecentShoots.all
        let visible = showAllRecents ? shoots : Array(shoots.prefix(Self.recentsShown))
        recentBox.isHidden = shoots.isEmpty
        recentEmpty.isHidden = !shoots.isEmpty
        recentMore.isHidden = shoots.count <= Self.recentsShown
        HomeStyle.setLinkTitle(recentMore, showAllRecents ? "Show fewer" : "Show all \(shoots.count)")

        recentBox.arrangedSubviews.forEach { $0.removeFromSuperview() }
        rows = [:]
        for (i, s) in visible.enumerated() {
            let row = ShootRow(shoot: s)
            row.showsSeparator = i > 0
            row.cover = covers[s.path]
            row.onClick = { [weak self] in self?.open(s) }
            row.onReveal = { NSWorkspace.shared.activateFileViewerSelecting([$0.url]) }
            row.onRemove = { RecentShoots.remove($0.url) }
            row.onTogglePin = { RecentShoots.setPinned($0.url, !$0.isPinned) }
            recentBox.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: recentBox.widthAnchor).isActive = true
            rows[s.path] = row
        }
        for s in shoots { loadCoverIfNeeded(s) }
    }

    private func loadCoverIfNeeded(_ s: RecentShoot) {
        let key = s.path
        let exists = FileManager.default.fileExists(atPath: key)
        if let c = covers[key], c.requested == s.coverName, c.available == exists { return }
        guard loadingCovers.insert(key).inserted else { return }
        Self.coverQueue.async {
            let cover = ShootCover.load(s.url, preferring: s.coverName)
            DispatchQueue.main.async {
                self.loadingCovers.remove(key)
                self.covers[key] = cover
                self.rows[key]?.cover = cover
                if self.continueShoot?.path == key { self.refreshContinueCard() }
            }
        }
    }

    private func open(_ s: RecentShoot) {
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: s.path, isDirectory: &isDir), isDir.boolValue {
            delegate?.homeOpen(s.url)
            return
        }
        let a = NSAlert()
        a.messageText = "“\(s.display.title)” isn’t available"
        a.informativeText = "It may be on a drive that isn’t connected, or it was moved or renamed.\n\n\((s.path as NSString).abbreviatingWithTildeInPath)"
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Remove from Recent Shoots")
        guard let window = view.window else { return }
        a.beginSheetModal(for: window) { resp in
            if resp == .alertSecondButtonReturn { RecentShoots.remove(s.url) }
        }
    }

    @objc private func showRecentsMenu(_ sender: NSButton) {
        let m = NSMenu()
        m.autoenablesItems = false
        let count = RecentShoots.all.count
        if count > Self.recentsShown {
            m.addItem(ClosureMenuItem(showAllRecents ? "Show Fewer" : "Show All \(count) Shoots") { [weak self] in
                self?.toggleAllRecents(nil)
            })
            m.addItem(.separator())
        }
        let clear = ClosureMenuItem("Clear Recent Shoots…") { [weak self] in self?.confirmClearRecents() }
        clear.isEnabled = count > 0
        m.addItem(clear)
        let hint = NSMenuItem(title: "Right-click a shoot to pin or remove it", action: nil, keyEquivalent: "")
        hint.isEnabled = false
        m.addItem(.separator())
        m.addItem(hint)
        m.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.height + 4), in: sender)
    }

    @objc private func toggleAllRecents(_ sender: Any?) {
        showAllRecents.toggle()
        refreshRecents()
    }

    private func confirmClearRecents() {
        guard let window = view.window else { return }
        let a = NSAlert()
        a.messageText = "Clear recent shoots?"
        a.informativeText = "Pinned shoots stay on Home. Nothing on disk is changed."
        a.addButton(withTitle: "Clear")
        a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { resp in
            if resp == .alertFirstButtonReturn { RecentShoots.clear() }
        }
    }

    // MARK: Ingest setup

    private func refreshWorkflow() {
        destinationCell.label = "DESTINATION"
        if let dest = IngestSettings.destination {
            destinationCell.value = dest.lastPathComponent
            destinationCell.toolTip = "\((dest.path as NSString).abbreviatingWithTildeInPath)\nClick to choose a different folder"
            if let free = Self.freeSpace(at: dest) {
                let low = free < Self.lowSpace
                destinationCell.detail = low ? "Only \(HomeStyle.bytes(free)) free" : "\(HomeStyle.bytes(free)) free"
                destinationCell.tone = low ? .danger : .normal
            } else {
                destinationCell.detail = "Drive not connected"
                destinationCell.tone = .warning
            }
        } else {
            destinationCell.value = "Not set"
            destinationCell.detail = "Choose where photos go"
            destinationCell.tone = .warning
            destinationCell.toolTip = "Click to choose a folder"
        }

        let job = IngestSettings.sanitizedJob(IngestSettings.job)
        let naming = IngestNaming(job: job, folderPattern: IngestSettings.folderPattern,
                                  renamePattern: IngestSettings.renameOn ? IngestSettings.renamePattern : nil)
        let sample = naming.names(original: "IMG_0001", date: Date(), camera: "", seq: 1)
        foldersCell.label = "JOB FOLDER"
        foldersCell.value = sample.folder
        foldersCell.detail = IngestSettings.folderPattern
        foldersCell.toolTip = "Edit in the Ingest window"

        namesCell.label = "FILE NAMES"
        namesCell.value = IngestSettings.renameOn ? sample.base : "Camera names"
        namesCell.detail = IngestSettings.renameOn ? IngestSettings.renamePattern : "Renaming is off"
        namesCell.toolTip = "Edit in the Ingest window"

        afterCell.label = "AFTER COPYING"
        afterCell.value = IngestSettings.ejectWhenDone ? "Eject card" : "Keep card mounted"
        afterCell.detail = IngestSettings.skipExisting ? "Skips photos already ingested" : "Copies every file"
        afterCell.toolTip = "Edit in the Ingest window"
    }

    private func chooseDestination() {
        guard let window = view.window else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Choose"
        panel.message = "Where should ingested photos go?"
        panel.directoryURL = IngestSettings.destination?.deletingLastPathComponent()
        panel.beginSheetModal(for: window) { resp in
            guard resp == .OK, let url = panel.url else { return }
            IngestSettings.destination = url
            IngestSettings.notify()
        }
    }

    static func freeSpace(at url: URL) -> Int64? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return (try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage
    }

    // MARK: Shortcuts

    private func refreshShortcuts() {
        let all = UserDefaults.standard.bool(forKey: Self.allShortcutsKey)
        let list = all ? Self.shortcuts : Array(Self.shortcuts.prefix(Self.essentialShortcuts))
        shortcutsGrid.tiles = list.map { ShortcutView(key: $0.0, text: $0.1) }
        HomeStyle.setLinkTitle(shortcutsToggle, all ? "Show fewer" : "View all shortcuts →")
    }

    @objc private func toggleShortcuts(_ sender: Any?) {
        let d = UserDefaults.standard
        d.set(!d.bool(forKey: Self.allShortcutsKey), forKey: Self.allShortcutsKey)
        refreshShortcuts()
    }

    // MARK: Actions

    @objc private func openIngest(_ sender: Any?) { delegate?.homeIngest(from: nil) }

    @objc private func editProfile(_ sender: Any?) { delegate?.homeEditProfile() }

    @objc private func dismissPrompt(_ sender: Any?) {
        UserDefaults.standard.set(true, forKey: Self.promptDismissedKey)
        refresh()
    }

    // MARK: Formatting

    private static func greeting(for profile: Profile?) -> String {
        guard let profile, !profile.firstName.isEmpty else { return "Welcome to Deadlyne" }
        let hour = Calendar.current.component(.hour, from: Date())
        let part = hour < 4 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
        return "\(part), \(profile.firstName)."
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEEEMMMMd")
        return f
    }()

    private static let durationFormatter: DateComponentsFormatter = {
        let f = DateComponentsFormatter()
        f.unitsStyle = .abbreviated
        f.allowedUnits = [.hour, .minute, .second]
        f.maximumUnitCount = 2
        return f
    }()
}
