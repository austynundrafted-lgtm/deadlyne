import AppKit

/// The main window: filter bar, contact sheet, loupe preview, caption panel and status bar.
final class BrowserViewController: NSViewController {

    // MARK: State

    private(set) var folder: URL?
    /// Called whenever a folder starts loading (the root switches from the home screen).
    var onFolderOpened: ((URL) -> Void)?
    /// The Home button was pressed.
    var onGoHome: (() -> Void)?
    /// "Fill Credits from Profile" was used before a profile exists.
    var onWantsProfile: (() -> Void)?
    /// "Code Replacements…" was chosen: switch to the Codes workspace.
    var onWantsCodes: (() -> Void)?
    private var allPhotos: [Photo] = []
    private var shown: [Photo] = []
    private var loadGeneration = 0
    private var metadataReady = false
    private var previewIndex: Int?
    private var busyMessage: String?
    private var ingest: IngestWindowController?
    private var captionClipboard: IPTCInfo?
    private var pendingSaves = 0
    /// True until the user changes the selection after opening a folder.
    private var selectionIsPristine = true
    /// Culling position, for Home's "Continue": the furthest frame reached and the photo selected last.
    private var reviewedHighWater = 0
    private var lastPhotoName: String?

    enum TagFilter: Int { case all, tagged, untagged }
    private var tagFilter = TagFilter.all
    private var minRating = 0
    private var labelFilter: ColorLabel?
    private var searchText = ""
    private var fileScope = FileScope(rawValue: UserDefaults.standard.integer(forKey: "fileScope")) ?? .both
    private var sortByName = UserDefaults.standard.bool(forKey: "sortByName")
    private var autoAdvance = UserDefaults.standard.bool(forKey: "autoAdvance")
    private var captionPanelVisible = UserDefaults.standard.bool(forKey: "captionPanel")
    private var thumbSize: CGFloat = {
        let v = UserDefaults.standard.double(forKey: "thumbSize")
        return v > 0 ? v : 210
    }()

    private var filterActive: Bool {
        tagFilter != .all || minRating > 0 || labelFilter != nil || !searchText.isEmpty || fileScope != .both
    }
    private let saveQueue = DispatchQueue(label: "deadlyne.xmp", qos: .utility)

    // MARK: Views

    private let mainArea = NSView()
    private let grid = GridView()
    private let scrollView = NSScrollView()
    private let flow = NSCollectionViewFlowLayout()
    private let preview = PreviewView()
    private let captionPanel = CaptionPanel()
    private var captionPanelWidth: NSLayoutConstraint!
    private let topBar = NSStackView()
    private let statusBar = NSView()
    private let statusLeft = NSTextField(labelWithString: "")
    private let statusRight = NSTextField(labelWithString: "")
    private let emptyState = NSStackView()
    private let emptyTitle = NSTextField(labelWithString: "")
    private let folderLabel = NSTextField(labelWithString: "No folder")
    private let tagSegment = NSSegmentedControl(labels: ["All", "Tagged", "Untagged"], trackingMode: .selectOne,
                                                target: nil, action: nil)
    private let ratingPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let labelPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let filesPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let sortPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let searchField = NSSearchField()
    private let captionButton = NSButton()
    private let sizeSlider = NSSlider(value: 210, minValue: 120, maxValue: 380, target: nil, action: nil)

    static let background = NSColor(white: 0.105, alpha: 1)

    override func loadView() {
        let root = DropTargetView()
        root.onDrop = { [weak self] url in self?.openFolder(url) }
        root.wantsLayer = true
        root.layer?.backgroundColor = Self.background.cgColor
        view = root

        buildTopBar()
        buildGrid()
        buildStatusBar()
        buildEmptyState()
        preview.handler = self
        preview.isHidden = true
        captionPanel.delegate = self
        ThumbnailCellView.scope = fileScope

        for v in [mainArea, captionPanel, statusBar] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(v)
        }
        for v in [topBar, scrollView, emptyState, preview] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            mainArea.addSubview(v)
        }
        captionPanelWidth = captionPanel.widthAnchor.constraint(equalToConstant: captionPanelVisible ? CaptionPanel.width : 0)
        captionPanel.isHidden = !captionPanelVisible
        NSLayoutConstraint.activate([
            mainArea.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            mainArea.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            mainArea.trailingAnchor.constraint(equalTo: captionPanel.leadingAnchor),
            mainArea.bottomAnchor.constraint(equalTo: statusBar.topAnchor),

            captionPanel.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            captionPanel.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            captionPanel.bottomAnchor.constraint(equalTo: statusBar.topAnchor),
            captionPanelWidth,

            topBar.topAnchor.constraint(equalTo: mainArea.topAnchor),
            topBar.leadingAnchor.constraint(equalTo: mainArea.leadingAnchor),
            topBar.trailingAnchor.constraint(equalTo: mainArea.trailingAnchor),
            topBar.heightAnchor.constraint(equalToConstant: 46),

            scrollView.topAnchor.constraint(equalTo: topBar.bottomAnchor),
            scrollView.leadingAnchor.constraint(equalTo: mainArea.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: mainArea.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: mainArea.bottomAnchor),

            statusBar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            statusBar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            statusBar.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            statusBar.heightAnchor.constraint(equalToConstant: 28),

            emptyState.centerXAnchor.constraint(equalTo: scrollView.centerXAnchor),
            emptyState.centerYAnchor.constraint(equalTo: scrollView.centerYAnchor, constant: -20),
            emptyState.widthAnchor.constraint(lessThanOrEqualToConstant: 460),

            preview.topAnchor.constraint(equalTo: mainArea.topAnchor),
            preview.leadingAnchor.constraint(equalTo: mainArea.leadingAnchor),
            preview.trailingAnchor.constraint(equalTo: mainArea.trailingAnchor),
            preview.bottomAnchor.constraint(equalTo: mainArea.bottomAnchor),
        ])
        updateEmptyState()
        installEscapeMonitor()
        // The top bar's labels must be allowed to truncate, or the longest one becomes
        // the window's minimum width.
        HomeViewController.letLabelsCompress(root)
    }

    private var escapeMonitor: Any?

    /// Esc is claimed as a key equivalent by other controls (e.g. the search field) before it
    /// reaches the first responder, so route it here: leave a caption field, un-zoom, close preview.
    private func installEscapeMonitor() {
        escapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            // Posted/synthetic events may not carry a window yet, so check the key window instead.
            guard let self, event.keyCode == 53, NSApp.keyWindow === self.view.window,
                  event.modifierFlags.intersection([.command, .control, .option, .shift]).isEmpty else { return event }
            if self.captionPanel.isEditing {
                self.captionPanelWantsFocusBack()
                return nil
            }
            if self.previewIndex != nil, self.view.window?.firstResponder === self.preview {
                if self.preview.isZoomed { self.preview.toggleZoom() } else { self.closePreview() }
                return nil
            }
            return event
        }
    }

    // MARK: Building

    private func buildTopBar() {
        topBar.orientation = .horizontal
        topBar.spacing = 8
        topBar.edgeInsets = NSEdgeInsets(top: 0, left: 10, bottom: 0, right: 10)
        topBar.detachesHiddenViews = true
        topBar.wantsLayer = true
        topBar.layer?.backgroundColor = NSColor(white: 0.14, alpha: 1).cgColor

        let homeButton = symbolButton("house", "Home", #selector(goHome(_:)))
        homeButton.imagePosition = .imageOnly
        homeButton.toolTip = "Home (⇧⌘H)"
        topBar.addArrangedSubview(homeButton)
        let open = symbolButton("folder", "Open", #selector(openFolderPanel(_:)))
        let ingestButton = symbolButton("sdcard", "Ingest", #selector(showIngest(_:)))
        folderLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        folderLabel.textColor = NSColor(white: 0.92, alpha: 1)
        folderLabel.lineBreakMode = .byTruncatingMiddle
        folderLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        folderLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)

        tagSegment.selectedSegment = 0
        tagSegment.target = self
        tagSegment.action = #selector(filterChanged(_:))
        tagSegment.controlSize = .small

        ratingPopup.addItems(withTitles: ["Any Rating", "★ 1+", "★ 2+", "★ 3+", "★ 4+", "★ 5"])
        labelPopup.addItem(withTitle: "Any Label")
        for l in ColorLabel.allCases {
            labelPopup.addItem(withTitle: l.rawValue)
            labelPopup.lastItem?.image = Self.dot(l.color)
        }
        filesPopup.addItems(withTitles: FileScope.allCases.map(\.title))
        filesPopup.selectItem(at: fileScope.rawValue)
        filesPopup.toolTip = "Show RAW+JPG pairs, or only RAW or only JPG files. Copy, move, drag and trash act on the files shown."
        sortPopup.addItems(withTitles: ["Capture Time", "Filename"])
        sortPopup.selectItem(at: sortByName ? 1 : 0)
        sortPopup.toolTip = "Sort order"
        for p in [ratingPopup, labelPopup, filesPopup, sortPopup] {
            p.controlSize = .small
            p.target = self
            p.action = #selector(filterChanged(_:))
        }

        searchField.placeholderString = "Search captions, keywords"
        searchField.controlSize = .small
        searchField.sendsSearchStringImmediately = true
        searchField.target = self
        searchField.action = #selector(searchChanged(_:))
        searchField.widthAnchor.constraint(equalToConstant: 170).isActive = true

        captionButton.image = NSImage(systemSymbolName: "text.bubble", accessibilityDescription: "Caption panel")
        captionButton.title = "Caption"
        captionButton.imagePosition = .imageLeading
        captionButton.setButtonType(.pushOnPushOff)
        captionButton.bezelStyle = .push
        captionButton.controlSize = .small
        captionButton.state = captionPanelVisible ? .on : .off
        captionButton.target = self
        captionButton.action = #selector(toggleCaptionPanel(_:))

        sizeSlider.doubleValue = thumbSize
        sizeSlider.controlSize = .small
        sizeSlider.target = self
        sizeSlider.action = #selector(sizeChanged(_:))
        sizeSlider.toolTip = "Thumbnail size"
        sizeSlider.widthAnchor.constraint(equalToConstant: 80).isActive = true

        for v in [open, ingestButton, folderLabel, tagSegment, ratingPopup, labelPopup, filesPopup, sortPopup,
                  sizeSlider, searchField, captionButton] as [NSView] {
            topBar.addArrangedSubview(v)
        }
        topBar.setCustomSpacing(14, after: folderLabel)
        topBar.setCustomSpacing(14, after: sortPopup)
        // When the window (or caption panel) squeezes the bar, drop the least important items first.
        topBar.setVisibilityPriority(NSStackView.VisibilityPriority(600), for: folderLabel)
        topBar.setVisibilityPriority(NSStackView.VisibilityPriority(650), for: sizeSlider)
        topBar.setVisibilityPriority(NSStackView.VisibilityPriority(700), for: sortPopup)
        topBar.setVisibilityPriority(NSStackView.VisibilityPriority(750), for: labelPopup)
    }

    private func symbolButton(_ symbol: String, _ title: String, _ action: Selector) -> NSButton {
        let b = NSButton(title: title, image: NSImage(systemSymbolName: symbol, accessibilityDescription: title)!,
                         target: self, action: action)
        b.imagePosition = .imageLeading
        b.controlSize = .small
        b.bezelStyle = .push
        return b
    }

    private static func dot(_ color: NSColor) -> NSImage {
        NSImage(size: NSSize(width: 10, height: 10), flipped: false) { r in
            color.setFill()
            NSBezierPath(ovalIn: r.insetBy(dx: 0.5, dy: 0.5)).fill()
            return true
        }
    }

    private func buildGrid() {
        flow.itemSize = itemSize
        flow.minimumInteritemSpacing = 6
        flow.minimumLineSpacing = 6
        flow.sectionInset = NSEdgeInsets(top: 10, left: 10, bottom: 10, right: 10)
        grid.collectionViewLayout = flow
        grid.dataSource = self
        grid.delegate = self
        grid.handler = self
        grid.isSelectable = true
        grid.allowsMultipleSelection = true
        grid.allowsEmptySelection = true
        grid.backgroundColors = [Self.background]
        grid.register(ThumbnailItem.self, forItemWithIdentifier: ThumbnailItem.identifier)
        grid.setDraggingSourceOperationMask(.copy, forLocal: false)
        scrollView.documentView = grid
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = true
        scrollView.backgroundColor = Self.background
        scrollView.contentView.postsFrameChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(clipViewFrameChanged(_:)),
                                               name: NSView.frameDidChangeNotification, object: scrollView.contentView)
    }

    /// Cells stretch so each row fills the grid exactly (no ragged right-hand gap).
    private var itemSize: NSSize {
        let spacing = flow.minimumInteritemSpacing
        let available = max(thumbSize, scrollView.contentSize.width - flow.sectionInset.left - flow.sectionInset.right)
        let columns = max(1, floor((available + spacing) / (thumbSize + spacing)))
        let width = floor((available - spacing * (columns - 1)) / columns)
        return NSSize(width: width, height: ((width - 14) * 0.72).rounded() + 45)
    }

    private var lastLayoutWidth: CGFloat = 0

    /// Re-fits columns whenever the visible width changes — including when a legacy scroller
    /// appears or the caption panel opens, which change the clip view but not our own view.
    @objc private func clipViewFrameChanged(_ note: Notification? = nil) {
        let w = scrollView.contentSize.width
        if abs(w - lastLayoutWidth) > 0.5 {
            lastLayoutWidth = w
            flow.itemSize = itemSize
        }
    }

    override func viewDidLayout() {
        super.viewDidLayout()
        clipViewFrameChanged()
    }

    private func buildStatusBar() {
        statusBar.wantsLayer = true
        statusBar.layer?.backgroundColor = NSColor(white: 0.14, alpha: 1).cgColor
        for f in [statusLeft, statusRight] {
            f.translatesAutoresizingMaskIntoConstraints = false
            f.font = .systemFont(ofSize: 11.5)
            f.textColor = NSColor(white: 0.72, alpha: 1)
            f.lineBreakMode = .byTruncatingTail
            statusBar.addSubview(f)
        }
        statusLeft.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        statusRight.alignment = .right
        NSLayoutConstraint.activate([
            statusLeft.leadingAnchor.constraint(equalTo: statusBar.leadingAnchor, constant: 12),
            statusLeft.centerYAnchor.constraint(equalTo: statusBar.centerYAnchor),
            statusRight.leadingAnchor.constraint(greaterThanOrEqualTo: statusLeft.trailingAnchor, constant: 16),
            statusRight.trailingAnchor.constraint(equalTo: statusBar.trailingAnchor, constant: -12),
            statusRight.centerYAnchor.constraint(equalTo: statusBar.centerYAnchor),
        ])
    }

    private func buildEmptyState() {
        emptyState.orientation = .vertical
        emptyState.alignment = .centerX
        emptyState.spacing = 12
        let icon = NSImageView(image: NSImage(systemSymbolName: "camera.aperture", accessibilityDescription: nil)!)
        icon.symbolConfiguration = .init(pointSize: 54, weight: .ultraLight)
        icon.contentTintColor = NSColor(white: 0.45, alpha: 1)
        emptyTitle.font = .systemFont(ofSize: 20, weight: .semibold)
        emptyTitle.textColor = NSColor(white: 0.9, alpha: 1)
        let sub = NSTextField(wrappingLabelWithString:
            "Deadlyne reads the JPEG previews already inside your RAW files, so even thousand-frame shoots open instantly.")
        sub.alignment = .center
        sub.textColor = NSColor(white: 0.6, alpha: 1)
        sub.preferredMaxLayoutWidth = 420
        let buttons = NSStackView(views: [
            symbolButton("folder", "Open Folder…", #selector(openFolderPanel(_:))),
            symbolButton("sdcard", "Ingest from Card…", #selector(showIngest(_:))),
        ])
        buttons.spacing = 10
        for case let b as NSButton in buttons.arrangedSubviews { b.controlSize = .large }
        let hint = NSTextField(labelWithString: "or drag a folder onto this window")
        hint.font = .systemFont(ofSize: 11)
        hint.textColor = NSColor(white: 0.45, alpha: 1)
        for v in [icon, emptyTitle, sub, buttons, hint] as [NSView] { emptyState.addArrangedSubview(v) }
        emptyState.setCustomSpacing(18, after: sub)
    }

    private func updateEmptyState() {
        emptyState.isHidden = !shown.isEmpty
        if folder == nil {
            emptyTitle.stringValue = "Open a folder of photos"
        } else if allPhotos.isEmpty {
            emptyTitle.stringValue = metadataReady ? "No photos in this folder" : "Scanning…"
        } else {
            emptyTitle.stringValue = "No photos match the filter"
        }
    }

    // MARK: Loading

    func openFolder(_ url: URL) {
        recordShootStats()
        closePreview()
        loadGeneration += 1
        let gen = loadGeneration
        ImagePipeline.shared.cancelAllThumbnails()
        folder = url
        let saved = RecentShoots.all.first { $0.path == url.standardizedFileURL.path }
        reviewedHighWater = saved?.reviewedCount ?? 0
        lastPhotoName = saved?.lastPhoto
        metadataReady = false
        allPhotos = []
        applyFilter()
        UserDefaults.standard.set(url.path, forKey: "lastFolder")
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
        view.window?.title = url.lastPathComponent
        view.window?.representedURL = url
        folderLabel.stringValue = (url.path as NSString).abbreviatingWithTildeInPath
        statusRight.stringValue = "Scanning…"
        RecentShoots.noteOpened(url)
        onFolderOpened?(url)

        DispatchQueue.global(qos: .userInitiated).async {
            let photos = FolderLoader.scan(url)
            DispatchQueue.main.async {
                guard gen == self.loadGeneration else { return }
                RecentShoots.update(url) { $0.photoCount = photos.count }
                Achievements.recordFolder(url, photos: photos.count)
                self.allPhotos = photos
                self.applyFilter()
                self.selectionIsPristine = true
                if !self.shown.isEmpty {
                    self.grid.selectionIndexPaths = [IndexPath(item: 0, section: 0)]
                    self.grid.scroll(.zero)
                }
                self.view.window?.makeFirstResponder(self.grid)
                self.updateStatus()
                self.loadMetadata(photos, gen: gen)
            }
        }
    }

    private func loadMetadata(_ photos: [Photo], gen: Int) {
        DispatchQueue.global(qos: .userInitiated).async {
            let started = Date()
            let loaded = FolderLoader.loadMetadata(photos) { n in
                DispatchQueue.main.async {
                    if gen == self.loadGeneration { self.statusRight.stringValue = "Reading metadata \(n) / \(photos.count)…" }
                }
            }
            NSLog("Deadlyne: metadata for %d photos in %.0f ms", photos.count, Date().timeIntervalSince(started) * 1000)
            DispatchQueue.main.async {
                guard gen == self.loadGeneration else { return }
                for (p, l) in zip(photos, loaded) {
                    if let v = l.culling { p.rating = v.rating; p.label = v.label; p.tagged = v.tagged }
                    p.iptc = l.iptc
                }
                self.metadataReady = true
                self.sortPhotos()
                self.applyFilter()
                self.recordShootStats()
                if self.selectionIsPristine, self.previewIndex == nil, !self.shown.isEmpty {
                    // Resume where culling stopped. Otherwise start at the top: capture-time order
                    // differs from filename order.
                    let resume = self.lastPhotoName.flatMap { name in self.shown.firstIndex { $0.baseName == name } }
                    let ip = IndexPath(item: resume ?? 0, section: 0)
                    self.grid.selectionIndexPaths = [ip]
                    if resume == nil {
                        self.grid.scroll(.zero)
                    } else {
                        self.grid.scrollToItems(at: [ip], scrollPosition: .centeredVertically)
                    }
                    self.updateStatus()
                }
                self.refreshVisibleCells()
                // Warm the rest of the contact sheet in display order, within the cache budget.
                let perThumb = ImagePipeline.thumbnailPixels * ImagePipeline.thumbnailPixels * 3
                let budget = max(200, Int(ProcessInfo.processInfo.physicalMemory) / 6 / perThumb)
                ImagePipeline.shared.warmThumbnails(Array(self.shown.prefix(budget)))
            }
        }
    }

    // MARK: Home screen hand-off

    /// Saves this shoot's counts, culling position and best frame (for the home screen).
    func recordShootStats() {
        guard let folder, metadataReady else { return }
        var tagged = 0, fiveStar = 0
        var best: Photo?
        for p in allPhotos {
            if p.tagged { tagged += 1 }
            if p.rating == 5 { fiveStar += 1 }
            guard p.rating > 0 || p.tagged else { continue }
            if best == nil || (p.rating, p.tagged ? 1 : 0) > (best!.rating, best!.tagged ? 1 : 0) { best = p }
        }
        let count = allPhotos.count, reviewed = min(reviewedHighWater, allPhotos.count), last = lastPhotoName
        RecentShoots.update(folder) { s in
            s.photoCount = count
            s.taggedCount = tagged
            s.fiveStarCount = fiveStar
            s.reviewedCount = reviewed
            s.lastPhoto = last
            s.coverName = best?.baseName
        }
    }

    /// Remembers how far culling got. Called when the user moves to a photo (not for select-all).
    private func noteCullPosition() {
        guard metadataReady else { return }
        let photo: Photo?
        if let i = previewIndex, shown.indices.contains(i) {
            photo = shown[i]
        } else {
            photo = grid.selectionIndexPaths.count == 1 ? selectedPhotos.first : nil
        }
        guard let photo, let i = allPhotos.firstIndex(where: { $0 === photo }) else { return }
        lastPhotoName = photo.baseName
        reviewedHighWater = max(reviewedHighWater, i + 1)
    }

    /// Before the home screen covers the browser: finish any caption edit and close the loupe.
    func prepareToLeave() {
        if captionPanel.isEditing { captionPanelWantsFocusBack() }
        closePreview()
        recordShootStats()
    }

    func didBecomeVisible() {
        view.window?.title = folder?.lastPathComponent ?? "Deadlyne"
        view.window?.representedURL = folder
        view.window?.makeFirstResponder(previewIndex != nil ? preview : grid)
        refreshVisibleCells()
        updateStatus()
    }

    private func sortPhotos() {
        if sortByName || !metadataReady {
            allPhotos.sort { $0.baseName.localizedStandardCompare($1.baseName) == .orderedAscending }
        } else {
            allPhotos.sort { ($0.captureDate ?? .distantPast, $0.baseName) < ($1.captureDate ?? .distantPast, $1.baseName) }
        }
    }

    private func passes(_ p: Photo) -> Bool {
        switch tagFilter {
        case .tagged where !p.tagged, .untagged where p.tagged: return false
        default: break
        }
        if p.rating < minRating { return false }
        if let labelFilter, p.label != labelFilter { return false }
        if !p.has(fileScope) { return false }
        if !searchText.isEmpty, !p.baseName.localizedCaseInsensitiveContains(searchText), !p.iptc.matches(searchText) {
            return false
        }
        return true
    }

    private func applyFilter() {
        let selected = Set(selectedPhotos.map(ObjectIdentifier.init))
        shown = allPhotos.filter(passes)
        grid.reloadData()
        let ips = Set(shown.indices.filter { selected.contains(ObjectIdentifier(shown[$0])) }.map { IndexPath(item: $0, section: 0) })
        grid.selectionIndexPaths = ips
        if let first = ips.min() { grid.scrollToItems(at: [first], scrollPosition: .nearestHorizontalEdge) }
        updateEmptyState()
        updateStatus()
    }

    // MARK: Selection helpers

    private var selectedIndices: [Int] { grid.selectionIndexPaths.map(\.item).sorted() }
    private var selectedPhotos: [Photo] { selectedIndices.filter(shown.indices.contains).map { shown[$0] } }

    /// What an action applies to: the photo in the loupe, otherwise the grid selection.
    private var targetPhotos: [Photo] {
        if let i = previewIndex, shown.indices.contains(i) { return [shown[i]] }
        return selectedPhotos
    }

    private var taggedPhotos: [Photo] { allPhotos.filter { $0.tagged && $0.has(fileScope) } }

    private var isEditingText: Bool { view.window?.firstResponder is NSText }

    // MARK: Culling

    private func handleCullingKey(_ e: NSEvent, photos: [Photo]) -> Bool {
        let mods = e.modifierFlags.intersection([.command, .control, .option])
        guard mods.isEmpty, !photos.isEmpty, let ch = e.charactersIgnoringModifiers?.lowercased(), ch.count == 1 else { return false }
        if ch == "t" {
            toggleTag(photos)
            return true
        }
        if let d = Int(ch) {
            if d <= 5 { setRating(d, photos) } else if let l = ColorLabel.forKey(d) { toggleLabel(l, photos) }
            return true
        }
        return false
    }

    private func toggleTag(_ ps: [Photo]) {
        let value = !ps.allSatisfy(\.tagged)
        mutate(ps) { $0.tagged = value }
    }

    private func setRating(_ n: Int, _ ps: [Photo]) {
        mutate(ps) { $0.rating = n }
    }

    private func toggleLabel(_ l: ColorLabel?, _ ps: [Photo]) {
        let clear = l == nil || ps.allSatisfy { $0.label == l }
        mutate(ps) { $0.label = clear ? nil : l }
    }

    private func mutate(_ ps: [Photo], _ change: (Photo) -> Void) {
        ps.forEach(change)
        let jobs = ps.map { ($0.sidecar, XMPSidecar.Values(rating: $0.rating, label: $0.label, tagged: $0.tagged),
                             $0.primary.pathExtension.uppercased()) }
        saveQueue.async {
            for (url, values, ext) in jobs {
                do { try XMPSidecar.write(values, to: url, sidecarForExtension: ext) } catch {
                    DispatchQueue.main.async { self.statusLeft.stringValue = "⚠️ Couldn’t save \(url.lastPathComponent): \(error.localizedDescription)" }
                }
            }
        }
        if let i = previewIndex {
            preview.refreshHUD(index: i, count: shown.count)
            if autoAdvance, i + 1 < shown.count { step(1) }
        } else if filterActive {
            applyFilter()
        }
        refreshVisibleCells()
        updateStatus()
    }

    private func refreshVisibleCells() {
        for case let item as ThumbnailItem in grid.visibleItems() { item.cell.refresh() }
    }

    // MARK: Captions

    /// Writes caption fields for `photos`: into the sidecar (RAW, or when JPG embedding is off)
    /// and into the JPG file itself when embedding is on.
    private func saveCaptions(_ photos: [Photo], fields: Set<IPTCField>) {
        let mode = captionPanel.jpegMode
        let embed = mode != .off
        let legacy = mode == .xmpAndIIM
        let jobs = photos.map { p in
            (sidecar: p.sidecar, ext: p.primary.pathExtension.uppercased(), info: p.iptc,
             hasRaw: p.raw != nil, jpeg: p.jpeg)
        }
        pendingSaves += jobs.count
        updateStatus()
        saveQueue.async {
            for (n, j) in jobs.enumerated() {
                var error: String?
                do {
                    if j.hasRaw || !embed || j.jpeg == nil {
                        try XMPSidecar.update(j.sidecar, sidecarForExtension: j.ext, culling: nil, iptc: j.info, fields: fields)
                    }
                    if embed, let jpeg = j.jpeg { try JPEGMetadata.embed(j.info, fields: fields, into: jpeg, legacyIPTC: legacy) }
                } catch let e {
                    error = "⚠️ Couldn’t save caption for \(j.sidecar.deletingPathExtension().lastPathComponent): \(e.localizedDescription)"
                }
                let last = n == jobs.count - 1
                DispatchQueue.main.async {
                    self.pendingSaves -= 1
                    if let error { self.statusLeft.stringValue = error }
                    if last || self.pendingSaves % 25 == 0 { self.updateStatus() }
                }
            }
        }
    }

    private func refreshCaptionPanel() {
        guard captionPanelVisible else { return }
        captionPanel.show(targetPhotos)
    }

    // MARK: Preview

    private func openPreview(at i: Int) {
        guard shown.indices.contains(i) else { return }
        previewIndex = i
        preview.isHidden = false
        preview.show(shown[i], index: i, count: shown.count)
        view.window?.makeFirstResponder(preview)
        prefetch(around: i)
        noteCullPosition()
        updateStatus()
    }

    private func closePreview() {
        guard let i = previewIndex else { return }
        previewIndex = nil
        preview.isHidden = true
        if shown.indices.contains(i) {
            let ip = IndexPath(item: i, section: 0)
            grid.selectionIndexPaths = [ip]
            grid.scrollToItems(at: [ip], scrollPosition: .nearestHorizontalEdge)
        }
        if filterActive { applyFilter() }
        view.window?.makeFirstResponder(grid)
        refreshVisibleCells()
        updateStatus()
    }

    private func step(_ delta: Int) {
        guard let i = previewIndex else { return }
        let n = i + delta
        guard shown.indices.contains(n) else { NSSound.beep(); return }
        previewIndex = n
        preview.show(shown[n], index: n, count: shown.count)
        prefetch(around: n)
        noteCullPosition()
        updateStatus()
    }

    /// Decode the neighbours ahead of time so the next arrow press is instant.
    private func prefetch(around i: Int) {
        for j in [i + 1, i + 2, i + 3, i - 1, i + 4] where shown.indices.contains(j) {
            ImagePipeline.shared.preview(for: shown[j], maxPixels: preview.previewPixels)
        }
    }

    // MARK: Status

    private func updateStatus() {
        if let busyMessage {
            statusRight.stringValue = busyMessage
        } else if !allPhotos.isEmpty {
            let tagged = allPhotos.reduce(0) { $0 + ($1.tagged ? 1 : 0) }
            let noun = fileScope == .both ? "photos" : fileScope == .raw ? "RAW files" : "JPG files"
            let count = shown.count == allPhotos.count ? "\(allPhotos.count) \(noun)" : "\(shown.count) of \(allPhotos.count) \(noun)"
            var text = "\(count)   ·   \(tagged) tagged"
            if pendingSaves > 0 { text = "Saving captions… \(pendingSaves) left   ·   " + text }
            statusRight.stringValue = text
        } else if folder != nil, metadataReady {
            statusRight.stringValue = "0 photos"
        }
        let sel = targetPhotos
        if sel.count == 1, let p = sel.first {
            let parts = [p.displayName + (p.isPair ? " + JPG" : ""), p.camera, p.lens, p.exifSummary,
                         p.captureDate.map { Photo.dateFormatter.string(from: $0) } ?? ""]
            statusLeft.stringValue = parts.filter { !$0.isEmpty }.joined(separator: "      ")
        } else if sel.count > 1 {
            statusLeft.stringValue = "\(sel.count) selected"
        } else {
            statusLeft.stringValue = ""
        }
        refreshCaptionPanel()
    }

    private func setBusy(_ message: String?) {
        busyMessage = message
        updateStatus()
    }

    // MARK: Actions

    @objc func goHome(_ sender: Any?) { onGoHome?() }

    @objc func openFolderPanel(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Open"
        panel.message = "Choose a folder of photos"
        // Start next to the current shoot, or the last one opened, to save Finder navigation.
        if let near = folder ?? RecentShoots.all.max(by: { $0.lastOpened < $1.lastOpened })?.url {
            panel.directoryURL = near.deletingLastPathComponent()
        }
        guard let window = view.window else { return }
        panel.beginSheetModal(for: window) { resp in
            if resp == .OK, let url = panel.url { self.openFolder(url) }
        }
    }

    @objc func showIngest(_ sender: Any?) { showIngest(from: nil) }

    /// Opens the Ingest window, with `card` selected as the source if given.
    func showIngest(from card: URL?) {
        if ingest == nil {
            ingest = IngestWindowController { [weak self] dest in self?.openFolder(dest) }
        }
        ingest?.prepare(source: card)
        ingest?.showWindow(nil)
    }

    @objc func filterChanged(_ sender: Any?) {
        tagFilter = TagFilter(rawValue: tagSegment.selectedSegment) ?? .all
        minRating = ratingPopup.indexOfSelectedItem
        labelFilter = labelPopup.indexOfSelectedItem > 0 ? ColorLabel.allCases[labelPopup.indexOfSelectedItem - 1] : nil
        setScope(FileScope(rawValue: filesPopup.indexOfSelectedItem) ?? .both, apply: false)
        let byName = sortPopup.indexOfSelectedItem == 1
        if byName != sortByName {
            sortByName = byName
            UserDefaults.standard.set(byName, forKey: "sortByName")
            sortPhotos()
        }
        applyFilter()
    }

    @objc func searchChanged(_ sender: Any?) {
        let text = searchField.stringValue.trimmingCharacters(in: .whitespaces)
        guard text != searchText else { return }
        searchText = text
        closePreview()
        applyFilter()
    }

    @objc func focusSearch(_ sender: Any?) {
        closePreview()
        view.window?.makeFirstResponder(searchField)
    }

    @objc func setFileScope(_ sender: NSMenuItem) {
        setScope(FileScope(rawValue: sender.tag) ?? .both, apply: true)
    }

    private func setScope(_ scope: FileScope, apply: Bool) {
        filesPopup.selectItem(at: scope.rawValue)
        guard scope != fileScope else { return }
        fileScope = scope
        ThumbnailCellView.scope = scope
        UserDefaults.standard.set(scope.rawValue, forKey: "fileScope")
        if apply {
            closePreview()
            applyFilter()
        }
    }

    @objc func showAll(_ sender: Any?) { setTagFilter(.all) }
    @objc func showTagged(_ sender: Any?) { setTagFilter(.tagged) }
    @objc func showUntagged(_ sender: Any?) { setTagFilter(.untagged) }

    private func setTagFilter(_ f: TagFilter) {
        closePreview()
        tagSegment.selectedSegment = f.rawValue
        filterChanged(nil)
    }

    @objc func sizeChanged(_ sender: Any?) {
        thumbSize = sizeSlider.doubleValue.rounded()
        UserDefaults.standard.set(Double(thumbSize), forKey: "thumbSize")
        flow.itemSize = itemSize
        if let first = selectedIndices.first {
            grid.scrollToItems(at: [IndexPath(item: first, section: 0)], scrollPosition: .nearestHorizontalEdge)
        }
    }

    @objc func biggerThumbnails(_ sender: Any?) { sizeSlider.doubleValue += 40; sizeChanged(nil) }
    @objc func smallerThumbnails(_ sender: Any?) { sizeSlider.doubleValue -= 40; sizeChanged(nil) }

    @objc func toggleTagMenu(_ sender: Any?) { toggleTag(targetPhotos) }

    @objc func setRatingMenu(_ sender: NSMenuItem) { setRating(sender.tag, targetPhotos) }

    @objc func setLabelMenu(_ sender: NSMenuItem) {
        toggleLabel(sender.tag == 0 ? nil : ColorLabel.allCases[sender.tag - 1], targetPhotos)
    }

    @objc func selectTagged(_ sender: Any?) {
        closePreview()
        grid.selectionIndexPaths = Set(shown.indices.filter { shown[$0].tagged }.map { IndexPath(item: $0, section: 0) })
        updateStatus()
    }

    @objc func togglePreview(_ sender: Any?) {
        if previewIndex != nil { closePreview() } else if let i = selectedIndices.first { openPreview(at: i) }
    }

    @objc func toggleZoom(_ sender: Any?) {
        if previewIndex == nil, let i = selectedIndices.first { openPreview(at: i) }
        preview.toggleZoom()
    }

    @objc func toggleAutoAdvance(_ sender: Any?) {
        autoAdvance.toggle()
        UserDefaults.standard.set(autoAdvance, forKey: "autoAdvance")
    }

    // MARK: Caption actions

    @objc func toggleCaptionPanel(_ sender: Any?) {
        setCaptionPanel(visible: !captionPanelVisible)
    }

    private func setCaptionPanel(visible: Bool) {
        if !visible, captionPanel.isEditing { captionPanelWantsFocusBack() }
        captionPanelVisible = visible
        UserDefaults.standard.set(visible, forKey: "captionPanel")
        captionButton.state = visible ? .on : .off
        captionPanel.isHidden = !visible
        captionPanelWidth.constant = visible ? CaptionPanel.width : 0
        refreshCaptionPanel()
    }

    /// ⌘↩ — jump into the caption field, or (while typing) save and return to the photos.
    @objc func editCaption(_ sender: Any?) {
        if captionPanel.isEditing {
            captionPanelWantsFocusBack()
            return
        }
        guard !targetPhotos.isEmpty else { NSSound.beep(); return }
        if !captionPanelVisible { setCaptionPanel(visible: true) }
        captionPanel.show(targetPhotos)
        captionPanel.focusCaption()
    }

    @objc func copyCaption(_ sender: Any?) {
        guard let p = targetPhotos.first else { return }
        captionClipboard = p.iptc
        statusLeft.stringValue = "Copied caption info from \(p.baseName)"
    }

    @objc func pasteCaption(_ sender: Any?) {
        guard let clip = captionClipboard, !targetPhotos.isEmpty else { NSSound.beep(); return }
        if captionPanel.isEditing { captionPanelWantsFocusBack() }
        let ps = targetPhotos
        ps.forEach { $0.iptc = clip }
        saveCaptions(ps, fields: Set(IPTCField.allCases))
        refreshVisibleCells()
        updateStatus()
    }

    /// Stamps Photographer, Credit and Copyright from the profile onto the target photos.
    /// `{year}` in the copyright uses each photo's own capture year.
    @objc func fillCreditsFromProfile(_ sender: Any?) {
        guard let profile = Profile.current else {
            onWantsProfile?()
            return
        }
        let ps = targetPhotos
        guard !ps.isEmpty else { NSSound.beep(); return }
        if captionPanel.isEditing { captionPanelWantsFocusBack() }
        var fields = Set<IPTCField>()
        for p in ps {
            for (f, v) in profile.captionFields(captureDate: p.captureDate) {
                p.iptc[f] = v
                fields.insert(f)
            }
        }
        guard !fields.isEmpty else { NSSound.beep(); return }
        saveCaptions(ps, fields: fields)
        refreshVisibleCells()
        updateStatus()
        statusLeft.stringValue = "Filled credits from your profile on \(ps.count) photo\(ps.count == 1 ? "" : "s")"
    }

    @objc func editCodeReplacements(_ sender: Any?) {
        onWantsCodes?()
    }

    // MARK: File actions

    @objc func revealInFinder(_ sender: Any?) {
        let urls = targetPhotos.map { $0.primary(for: fileScope) }
        if !urls.isEmpty { NSWorkspace.shared.activateFileViewerSelecting(urls) }
    }

    @objc func openInDefaultApp(_ sender: Any?) {
        for p in targetPhotos { NSWorkspace.shared.open(p.primary(for: fileScope)) }
    }

    @objc func copyTagged(_ sender: Any?) { transfer(taggedPhotos, move: false, what: "tagged") }
    @objc func moveTagged(_ sender: Any?) { transfer(taggedPhotos, move: true, what: "tagged") }
    @objc func copySelected(_ sender: Any?) { transfer(targetPhotos, move: false, what: "selected") }
    @objc func moveSelected(_ sender: Any?) { transfer(targetPhotos, move: true, what: "selected") }

    private var scopeNoun: String {
        switch fileScope {
        case .both: return "RAW, JPG and sidecars"
        case .raw: return "RAW files and sidecars"
        case .jpeg: return "JPG files only"
        }
    }

    private func transfer(_ ps: [Photo], move: Bool, what: String) {
        let items = ps.compactMap { p -> FileOps.Item? in
            let files = p.files(for: fileScope)
            return files.isEmpty ? nil : FileOps.Item(photo: p, files: files)
        }
        guard !items.isEmpty, busyMessage == nil, let window = view.window else { NSSound.beep(); return }
        let verb = move ? "Move" : "Copy"
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "\(verb) Here"
        panel.message = "\(verb) \(items.count) \(what) photo\(items.count == 1 ? "" : "s") (\(scopeNoun)) to…"
        panel.beginSheetModal(for: window) { resp in
            guard resp == .OK, let dest = panel.url else { return }
            if dest.standardizedFileURL.path == self.folder?.standardizedFileURL.path {
                self.alert("Choose a different folder", "The photos are already in this folder.")
                return
            }
            let verbing = move ? "Moving" : "Copying"
            self.setBusy("\(verbing) 0 / \(items.count)…")
            DispatchQueue.global(qos: .userInitiated).async {
                self.saveQueue.sync {} // let pending rating/caption writes land first
                let result = FileOps.transfer(items, to: dest, move: move) { n in
                    DispatchQueue.main.async { self.setBusy("\(verbing) \(n) / \(items.count)…") }
                }
                DispatchQueue.main.async {
                    self.setBusy(nil)
                    if move { self.forget(result) }
                    self.report(result, verb: move ? "Moved" : "Copied", dest: dest)
                }
            }
        }
    }

    /// Updates photos after some of their files left the folder; drops photos with none left.
    private func forget(_ result: FileOps.Result) {
        let gone = Set(result.handledFiles.map(\.standardizedFileURL))
        for p in allPhotos {
            if let r = p.raw, gone.contains(r.standardizedFileURL) { p.raw = nil }
            if let j = p.jpeg, gone.contains(j.standardizedFileURL) { p.jpeg = nil }
        }
        let previewAt = previewIndex
        allPhotos.removeAll { $0.raw == nil && $0.jpeg == nil }
        shown = allPhotos.filter(passes)
        grid.reloadData()
        if let i = previewAt {
            if shown.isEmpty {
                previewIndex = nil
                preview.isHidden = true
                view.window?.makeFirstResponder(grid)
            } else {
                let n = min(i, shown.count - 1)
                previewIndex = n
                preview.show(shown[n], index: n, count: shown.count)
                prefetch(around: n)
            }
        } else if !shown.isEmpty {
            let n = min(selectedIndices.first ?? 0, shown.count - 1)
            grid.selectionIndexPaths = [IndexPath(item: n, section: 0)]
        }
        updateEmptyState()
        updateStatus()
    }

    /// Files trashed for a photo under the current scope. The sidecar only goes when nothing
    /// of the photo remains — trashing the RAW of a pair keeps the JPG's ratings and captions.
    private func trashFiles(_ p: Photo) -> [URL] {
        switch fileScope {
        case .both: return p.allFiles
        case .raw: return p.jpeg == nil ? p.files(for: .raw) : [p.raw].compactMap { $0 }
        case .jpeg:
            guard let j = p.jpeg else { return [] }
            return p.raw == nil && FileManager.default.fileExists(atPath: p.sidecar.path) ? [j, p.sidecar] : [j]
        }
    }

    @objc func trashSelected(_ sender: Any?) {
        let items = targetPhotos.compactMap { p -> FileOps.Item? in
            let f = trashFiles(p)
            return f.isEmpty ? nil : FileOps.Item(photo: p, files: f)
        }
        guard !items.isEmpty, let window = view.window else { NSSound.beep(); return }
        let fileCount = items.reduce(0) { $0 + $1.files.count }
        let a = NSAlert()
        switch fileScope {
        case .both:
            a.messageText = "Move \(items.count) photo\(items.count == 1 ? "" : "s") to the Trash?"
            a.informativeText = "\(fileCount) files (RAW, JPG and sidecars). You can put them back from the Trash."
        case .raw, .jpeg:
            let kind = fileScope == .raw ? "RAW" : "JPG"
            a.messageText = "Move \(items.count) \(kind) file\(items.count == 1 ? "" : "s") to the Trash?"
            a.informativeText = "Only the \(kind) files are trashed; the other half of each pair stays. You can put them back from the Trash."
        }
        a.addButton(withTitle: "Move to Trash")
        a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { resp in
            guard resp == .alertFirstButtonReturn else { return }
            self.saveQueue.sync {}
            let result = FileOps.trash(items)
            self.forget(result)
            if !result.errors.isEmpty { self.alert("Some files couldn’t be moved to the Trash", result.errors.prefix(8).joined(separator: "\n")) }
        }
    }

    private func report(_ r: FileOps.Result, verb: String, dest: URL) {
        var msg = "\(verb) \(r.completed.count) photo\(r.completed.count == 1 ? "" : "s") (\(r.files) files) to \(dest.lastPathComponent)"
        if r.skipped > 0 { msg += " — skipped \(r.skipped) already there" }
        statusLeft.stringValue = msg
        if !r.errors.isEmpty {
            alert("\(verb) with errors", msg + "\n\n" + r.errors.prefix(8).joined(separator: "\n"))
        }
    }

    private func alert(_ title: String, _ text: String) {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        if let window = view.window { a.beginSheetModal(for: window) } else { a.runModal() }
    }

    func menuForPhotos() -> NSMenu {
        let m = NSMenu()
        func add(_ title: String, _ sel: Selector, tag: Int = 0) {
            let i = m.addItem(withTitle: title, action: sel, keyEquivalent: "")
            i.target = self
            i.tag = tag
        }
        add("Preview", #selector(togglePreview(_:)))
        add("Edit Caption", #selector(editCaption(_:)))
        m.addItem(.separator())
        add(targetPhotos.allSatisfy(\.tagged) ? "Untag" : "Tag", #selector(toggleTagMenu(_:)))
        let rating = NSMenu()
        for n in 0...5 {
            let i = rating.addItem(withTitle: n == 0 ? "No Rating" : String(repeating: "★", count: n),
                                   action: #selector(setRatingMenu(_:)), keyEquivalent: "")
            i.tag = n
            i.target = self
        }
        m.addItem(withTitle: "Rating", action: nil, keyEquivalent: "").submenu = rating
        let labels = NSMenu()
        for (n, title) in (["None"] + ColorLabel.allCases.map(\.rawValue)).enumerated() {
            let i = labels.addItem(withTitle: title, action: #selector(setLabelMenu(_:)), keyEquivalent: "")
            i.tag = n
            i.target = self
            if n > 0 { i.image = Self.dot(ColorLabel.allCases[n - 1].color) }
        }
        m.addItem(withTitle: "Color Label", action: nil, keyEquivalent: "").submenu = labels
        m.addItem(.separator())
        add("Copy Caption Info", #selector(copyCaption(_:)))
        add("Paste Caption Info", #selector(pasteCaption(_:)))
        m.addItem(.separator())
        add("Reveal in Finder", #selector(revealInFinder(_:)))
        add("Open in Default App", #selector(openInDefaultApp(_:)))
        m.addItem(.separator())
        add("Copy To…", #selector(copySelected(_:)))
        add("Move To…", #selector(moveSelected(_:)))
        m.addItem(.separator())
        add("Move to Trash", #selector(trashSelected(_:)))
        return m
    }
}

// MARK: - Menu validation

extension BrowserViewController: NSMenuItemValidation {
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        // Single-key shortcuts (T, 0–9, Space, Z) must not steal keystrokes while typing a caption.
        if !item.keyEquivalent.isEmpty, item.keyEquivalentModifierMask.intersection([.command, .control, .option]).isEmpty,
           isEditingText {
            return false
        }
        switch item.action {
        case #selector(toggleAutoAdvance(_:)):
            item.state = autoAdvance ? .on : .off
            return true
        case #selector(toggleCaptionPanel(_:)):
            item.title = captionPanelVisible ? "Hide Caption Panel" : "Show Caption Panel"
            return true
        case #selector(setFileScope(_:)):
            item.state = item.tag == fileScope.rawValue ? .on : .off
            return true
        case #selector(showAll(_:)): item.state = tagFilter == .all ? .on : .off; return true
        case #selector(showTagged(_:)): item.state = tagFilter == .tagged ? .on : .off; return true
        case #selector(showUntagged(_:)): item.state = tagFilter == .untagged ? .on : .off; return true
        case #selector(copyTagged(_:)), #selector(moveTagged(_:)):
            return busyMessage == nil && !taggedPhotos.isEmpty
        case #selector(selectTagged(_:)):
            return shown.contains(where: \.tagged)
        case #selector(copySelected(_:)), #selector(moveSelected(_:)):
            return busyMessage == nil && !targetPhotos.isEmpty
        case #selector(pasteCaption(_:)):
            return captionClipboard != nil && !targetPhotos.isEmpty
        case #selector(fillCreditsFromProfile(_:)):
            item.title = Profile.current == nil ? "Fill Credits from Profile…" : "Fill Credits from Profile"
            return !targetPhotos.isEmpty
        case #selector(editCaption(_:)):
            return captionPanel.isEditing || !targetPhotos.isEmpty
        case #selector(toggleTagMenu(_:)), #selector(setRatingMenu(_:)), #selector(setLabelMenu(_:)),
             #selector(revealInFinder(_:)), #selector(openInDefaultApp(_:)), #selector(trashSelected(_:)),
             #selector(togglePreview(_:)), #selector(toggleZoom(_:)), #selector(copyCaption(_:)):
            return !targetPhotos.isEmpty
        default:
            return true
        }
    }
}

// MARK: - Collection view

extension BrowserViewController: NSCollectionViewDataSource, NSCollectionViewDelegate {
    func collectionView(_ collectionView: NSCollectionView, numberOfItemsInSection section: Int) -> Int { shown.count }

    func collectionView(_ collectionView: NSCollectionView, itemForRepresentedObjectAt indexPath: IndexPath) -> NSCollectionViewItem {
        let item = collectionView.makeItem(withIdentifier: ThumbnailItem.identifier, for: indexPath) as! ThumbnailItem
        item.cell.delegate = self
        item.cell.configure(shown[indexPath.item])
        return item
    }

    func collectionView(_ collectionView: NSCollectionView, didSelectItemsAt indexPaths: Set<IndexPath>) {
        selectionIsPristine = false
        noteCullPosition()
        updateStatus()
    }

    func collectionView(_ collectionView: NSCollectionView, didDeselectItemsAt indexPaths: Set<IndexPath>) {
        selectionIsPristine = false
        updateStatus()
    }

    func collectionView(_ collectionView: NSCollectionView, canDragItemsAt indexPaths: Set<IndexPath>, with event: NSEvent) -> Bool { true }

    func collectionView(_ collectionView: NSCollectionView, pasteboardWriterForItemAt indexPath: IndexPath) -> NSPasteboardWriting? {
        shown[indexPath.item].primary(for: fileScope) as NSURL
    }
}

extension BrowserViewController: ThumbnailCellDelegate {
    func cellToggledTag(_ photo: Photo) { toggleTag([photo]) }
    func cell(_ photo: Photo, setRating rating: Int) { setRating(rating, [photo]) }
}

extension BrowserViewController: CaptionPanelDelegate {
    func captionTargets() -> [Photo] { targetPhotos }

    func captionPanel(commit field: IPTCField, value: String, removedKeywords: [String], to photos: [Photo]) {
        for p in photos {
            if field == .keywords {
                let removed = Set(removedKeywords.map { $0.lowercased() })
                var keywords = p.iptc.keywords.filter { !removed.contains($0.lowercased()) }
                for k in IPTCInfo.splitKeywords(CaptionVariables.expandAll(value, for: p))
                where !keywords.contains(where: { $0.caseInsensitiveCompare(k) == .orderedSame }) {
                    keywords.append(k)
                }
                p.iptc.keywords = keywords
            } else {
                p.iptc[field] = CaptionVariables.expandAll(value, for: p)
            }
        }
        saveCaptions(photos, fields: [field])
        refreshVisibleCells()
        if !searchText.isEmpty, previewIndex == nil, !captionPanel.isEditing { applyFilter() } else { updateStatus() }
    }

    func captionPanelWantsFocusBack() {
        view.window?.makeFirstResponder(previewIndex != nil ? preview : grid)
    }

    func captionPanelEditCodes() { editCodeReplacements(nil) }

    func captionPanelFillFromProfile() { fillCreditsFromProfile(nil) }
}

extension BrowserViewController: GridViewHandler {
    func grid(_ grid: GridView, handleKey event: NSEvent) -> Bool {
        if handleCullingKey(event, photos: selectedPhotos) { return true }
        switch event.keyCode {
        case 49, 36, 76: // space, return, enter
            togglePreview(nil)
            return true
        default:
            return false
        }
    }

    func grid(_ grid: GridView, doubleClickedItemAt index: Int) { openPreview(at: index) }

    func gridMenu(_ grid: GridView, for index: Int?) -> NSMenu? { index == nil ? nil : menuForPhotos() }
}

extension BrowserViewController: PreviewViewHandler {
    func previewHandleKey(_ e: NSEvent) -> Bool {
        guard let i = previewIndex else { return false }
        if handleCullingKey(e, photos: [shown[i]]) { return true }
        switch e.keyCode {
        case 123, 126: step(-1)                 // ← ↑
        case 124, 125: step(1)                  // → ↓
        case 53, 36, 76, 49: closePreview()     // esc, return, enter, space
        default:
            guard e.modifierFlags.intersection([.command, .control, .option]).isEmpty else { return false }
            switch e.charactersIgnoringModifiers?.lowercased() {
            case "z": preview.toggleZoom()
            case "i": preview.showInfo.toggle()
            default: return false
            }
        }
        return true
    }

    func previewClose() { closePreview() }
}

/// Root view that accepts a folder dragged from the Finder.
final class DropTargetView: NSView {
    var onDrop: ((URL) -> Void)?
    /// Lets the view hold keyboard focus itself (the home screen has no other natural focus).
    var takesFocus = false

    override var acceptsFirstResponder: Bool { takesFocus }

    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) { fatalError() }

    private func folderURL(_ info: NSDraggingInfo) -> URL? {
        guard let url = info.draggingPasteboard.readObjects(forClasses: [NSURL.self])?.first as? URL else { return nil }
        var isDir: ObjCBool = false
        FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
        return isDir.boolValue ? url : url.deletingLastPathComponent()
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        // Ignore drags that start from our own grid.
        sender.draggingSource == nil && folderURL(sender) != nil ? .generic : []
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let url = folderURL(sender) else { return false }
        onDrop?(url)
        return true
    }
}
