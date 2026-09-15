import AppKit

/// Copies photos off memory cards into dated / job-named folders with optional renaming.
///
/// Folder and file names are templates. Tokens are filled per photo from its capture time:
/// {job} {date} {year} {month} {day} {time} {seq} {original} {camera}
final class IngestWindowController: NSWindowController, NSWindowDelegate {
    private let onFinish: (URL) -> Void

    private let sourcePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private var sources: [URL] = []
    private let destLabel = NSTextField(labelWithString: "")
    private var destination: URL?
    private let jobField = NSTextField()
    private let folderField = NSTextField()
    private let renameCheck = NSButton(checkboxWithTitle: "Rename files", target: nil, action: nil)
    private let renameField = NSTextField()
    private let seqStartField = NSTextField()
    private let skipCheck = NSButton(checkboxWithTitle: "Skip photos already ingested", target: nil, action: nil)
    private let ejectCheck = NSButton(checkboxWithTitle: "Eject card when finished", target: nil, action: nil)
    private let example = NSTextField(labelWithString: "")
    private let progress = NSProgressIndicator()
    private let statusLabel = NSTextField(labelWithString: "")
    private let startButton = NSButton(title: "Ingest", target: nil, action: nil)
    private let cancelButton = NSButton(title: "Close", target: nil, action: nil)

    private var running = false
    private var cancelled = false

    init(onFinish: @escaping (URL) -> Void) {
        self.onFinish = onFinish
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 440),
                              styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Ingest Photos"
        super.init(window: window)
        window.delegate = self
        buildUI()
        refreshSources()
        window.center()
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(volumesChanged(_:)),
                                                          name: NSWorkspace.didMountNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(volumesChanged(_:)),
                                                          name: NSWorkspace.didUnmountNotification, object: nil)
    }

    required init?(coder: NSCoder) { fatalError() }

    // MARK: UI

    private func label(_ s: String) -> NSTextField {
        let l = NSTextField(labelWithString: s)
        l.alignment = .right
        l.textColor = .secondaryLabelColor
        return l
    }

    private func buildUI() {
        guard let content = window?.contentView else { return }

        sourcePopup.target = self
        sourcePopup.action = #selector(sourceChanged(_:))

        destination = IngestSettings.destination
        destLabel.lineBreakMode = .byTruncatingMiddle
        destLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let destButton = NSButton(title: "Choose…", target: self, action: #selector(chooseDestination(_:)))
        let destRow = NSStackView(views: [destLabel, destButton])

        jobField.placeholderString = "e.g. Fairborn-vs-Tecumseh"
        jobField.stringValue = IngestSettings.job
        folderField.stringValue = IngestSettings.folderPattern
        renameField.stringValue = IngestSettings.renamePattern
        renameCheck.state = IngestSettings.renameOn ? .on : .off
        seqStartField.stringValue = "1"
        seqStartField.alignment = .right
        seqStartField.widthAnchor.constraint(equalToConstant: 60).isActive = true
        let seqRow = NSStackView(views: [renameField, label("start at"), seqStartField])
        skipCheck.state = IngestSettings.skipExisting ? .on : .off
        ejectCheck.state = IngestSettings.ejectWhenDone ? .on : .off
        for f in [jobField, folderField, renameField, seqStartField] { f.delegate = self }
        renameCheck.target = self
        renameCheck.action = #selector(optionsChanged(_:))

        let tokens = NSTextField(labelWithString: "Tokens: {job} {date} {year} {month} {day} {time} {seq} {original} {camera}")
        tokens.font = .systemFont(ofSize: 11)
        tokens.textColor = .tertiaryLabelColor
        example.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        example.textColor = .secondaryLabelColor
        example.lineBreakMode = .byTruncatingMiddle

        let grid = NSGridView(views: [
            [label("Source:"), sourcePopup],
            [label("Destination:"), destRow],
            [label("Job name:"), jobField],
            [label("Folder:"), folderField],
            [renameCheck, seqRow],
            [NSGridCell.emptyContentView, tokens],
            [label("Example:"), example],
            [NSGridCell.emptyContentView, skipCheck],
            [NSGridCell.emptyContentView, ejectCheck],
        ])
        grid.column(at: 0).xPlacement = .trailing
        grid.rowSpacing = 10
        grid.columnSpacing = 10
        grid.column(at: 1).width = 400

        progress.isIndeterminate = false
        progress.minValue = 0
        progress.maxValue = 1
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.font = .systemFont(ofSize: 11)
        statusLabel.lineBreakMode = .byTruncatingTail
        startButton.target = self
        startButton.action = #selector(start(_:))
        startButton.keyEquivalent = "\r"
        cancelButton.target = self
        cancelButton.action = #selector(cancel(_:))
        cancelButton.keyEquivalent = "\u{1b}"

        let buttons = NSStackView(views: [statusLabel, cancelButton, startButton])
        buttons.distribution = .fill
        statusLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        statusLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let stack = NSStackView(views: [grid, progress, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.edgeInsets = NSEdgeInsets(top: 22, left: 22, bottom: 20, right: 22)
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            progress.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -44),
            buttons.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -44),
        ])
        updateUI()
    }

    @objc private func volumesChanged(_ n: Notification) { if !running { refreshSources() } }

    /// Before showing: picks up a destination chosen on Home and preselects `card`.
    func prepare(source card: URL?) {
        guard !running else { return }
        destination = IngestSettings.destination
        if let card {
            refreshSources()
            if let i = sources.firstIndex(where: { $0.standardizedFileURL == card.standardizedFileURL }) { sourcePopup.selectItem(at: i) }
        }
        updateUI()
    }

    /// Lists mounted volumes that look like camera cards (they contain a DCIM folder).
    private func refreshSources() {
        let volumes = FileManager.default.mountedVolumeURLs(includingResourceValuesForKeys: nil, options: [.skipHiddenVolumes]) ?? []
        let cards = IngestEngine.memoryCards()
        let custom = sources.filter { !volumes.contains($0) && !cards.contains($0) }
        sources = cards + custom
        sourcePopup.removeAllItems()
        for s in sources {
            let isCard = cards.contains(s)
            sourcePopup.addItem(withTitle: isCard ? "\(s.lastPathComponent)  (memory card)" : s.path)
            sourcePopup.lastItem?.image = NSImage(systemSymbolName: isCard ? "sdcard" : "folder", accessibilityDescription: nil)
        }
        if sources.isEmpty { sourcePopup.addItem(withTitle: "No memory card found") ; sourcePopup.lastItem?.isEnabled = false }
        sourcePopup.menu?.addItem(.separator())
        sourcePopup.addItem(withTitle: "Choose Folder…")
        sourcePopup.selectItem(at: 0)
        updateUI()
    }

    private var selectedSource: URL? {
        let i = sourcePopup.indexOfSelectedItem
        return sources.indices.contains(i) ? sources[i] : nil
    }

    @objc private func sourceChanged(_ sender: Any?) {
        guard sourcePopup.titleOfSelectedItem == "Choose Folder…" else { updateUI(); return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.message = "Choose a card or folder to ingest from"
        panel.beginSheetModal(for: window!) { resp in
            if resp == .OK, let url = panel.url, !self.sources.contains(url) { self.sources.append(url) }
            self.refreshSources()
            if let url = panel.url, let i = self.sources.firstIndex(of: url) { self.sourcePopup.selectItem(at: i) }
            self.updateUI()
        }
    }

    @objc private func chooseDestination(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Choose"
        panel.message = "Where should ingested photos go?"
        panel.beginSheetModal(for: window!) { resp in
            guard resp == .OK, let url = panel.url else { return }
            self.destination = url
            IngestSettings.destination = url
            IngestSettings.notify()
            self.updateUI()
        }
    }

    @objc private func optionsChanged(_ sender: Any?) { updateUI() }

    private func updateUI() {
        destLabel.stringValue = destination.map { ($0.path as NSString).abbreviatingWithTildeInPath } ?? "Not set"
        renameField.isEnabled = renameCheck.state == .on
        seqStartField.isEnabled = renameCheck.state == .on
        let sample = IngestNaming(job: jobName, folderPattern: folderField.stringValue,
                                  renamePattern: renameCheck.state == .on ? renameField.stringValue : nil)
        let (folder, name) = sample.names(original: "MCD_0001", date: Date(), camera: "Canon EOS R3", seq: seqStart)
        example.stringValue = "\(folder)/\(name).CR3"
        startButton.isEnabled = !running && selectedSource != nil && destination != nil
        cancelButton.title = running ? "Stop" : "Close"
    }

    private var jobName: String { IngestSettings.sanitizedJob(jobField.stringValue) }

    private var seqStart: Int { max(0, Int(seqStartField.stringValue) ?? 1) }

    // MARK: Ingest

    @objc private func cancel(_ sender: Any?) {
        if running { cancelled = true } else { close() }
    }

    @objc private func start(_ sender: Any?) {
        guard let source = selectedSource, let destination, !running else { return }
        IngestSettings.job = jobField.stringValue
        IngestSettings.folderPattern = folderField.stringValue
        IngestSettings.renamePattern = renameField.stringValue
        IngestSettings.renameOn = renameCheck.state == .on
        IngestSettings.skipExisting = skipCheck.state == .on
        IngestSettings.ejectWhenDone = ejectCheck.state == .on
        IngestSettings.notify()

        let naming = IngestNaming(job: jobName, folderPattern: folderField.stringValue,
                                  renamePattern: renameCheck.state == .on ? renameField.stringValue : nil)
        let skip = skipCheck.state == .on, eject = ejectCheck.state == .on
        let firstSeq = seqStart
        running = true
        cancelled = false
        updateUI()
        statusLabel.stringValue = "Scanning \(source.lastPathComponent)…"
        progress.doubleValue = 0
        IngestActivity.begin(source: source, destination: destination) { [weak self] in self?.cancelled = true }

        DispatchQueue.global(qos: .userInitiated).async {
            let summary = IngestEngine.run(source: source, destination: destination, naming: naming, skipExisting: skip,
                                           firstSeq: firstSeq, isCancelled: { self.cancelled }) { p in
                DispatchQueue.main.async {
                    self.progress.doubleValue = p.fraction
                    self.statusLabel.stringValue = p.filesDone == 0 ? "Copying \(p.filesTotal) files…" : p.message
                    IngestActivity.update(p)
                }
            }
            DispatchQueue.main.async {
                IngestActivity.end()
                self.running = false
                self.updateUI()
                self.statusLabel.stringValue = summary.message
                self.progress.doubleValue = summary.cancelled ? self.progress.doubleValue : 1
                if eject, !summary.cancelled, summary.errors.isEmpty, self.isVolumeRoot(source) {
                    try? NSWorkspace.shared.unmountAndEjectDevice(at: source)
                }
                if !summary.errors.isEmpty {
                    let a = NSAlert()
                    a.messageText = "Ingest finished with errors"
                    a.informativeText = summary.errors.prefix(8).joined(separator: "\n")
                    a.beginSheetModal(for: self.window!)
                }
                Achievements.recordIngest(summary.copiedPhotos) // before opening, so the folder isn't counted twice
                if let open = summary.firstFolder { self.onFinish(open) }
            }
        }
    }

    private func isVolumeRoot(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isVolumeKey]))?.isVolume ?? false
    }

    func windowWillClose(_ notification: Notification) { cancelled = true }
}

extension IngestWindowController: NSTextFieldDelegate {
    func controlTextDidChange(_ obj: Notification) { updateUI() }
}
