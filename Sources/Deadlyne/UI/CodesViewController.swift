import AppKit
import UniformTypeIdentifiers

/// The Codes workspace: manage lookup files (rosters) on the left, edit the selected one as a
/// table or plain text in the middle, and set the delimiter and try codes out on the right.
/// Every edit saves immediately, so a roster is ready the moment you switch back to Photos.
final class CodesViewController: NSViewController {
    private let codes = CodeReplacements.shared
    private var selected: CodeList?

    // Sidebar
    private let listTable = NSTableView()
    private let listSummary = NSTextField(labelWithString: "")
    private let actionButton = NSPopUpButton(frame: .zero, pullsDown: true)

    // Editor
    private let titleLabel = NSTextField(labelWithString: "")
    private let subtitleLabel = NSTextField(labelWithString: "")
    private let modeSegment = NSSegmentedControl(labels: ["Table", "Text"], trackingMode: .selectOne, target: nil, action: nil)
    private let searchField = NSSearchField()
    private let addRowButton = NSButton()
    private let addColumnButton = NSButton()
    private let entryTable = EntryTableView()
    private let entryScroll = NSScrollView()
    private let textView = NSTextView()
    private let textScroll = NSScrollView()
    private let warningLabel = NSTextField(labelWithString: "")
    private let editorEmpty = NSStackView()
    private let editorEmptyTitle = NSTextField(labelWithString: "")
    private var editorViews: [NSView] = []

    // Inspector
    private let delimiterPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let liveCheckbox = NSButton(checkboxWithTitle: "Expand codes as you type", target: nil, action: nil)
    private let syntaxStack = NSStackView()
    private let tryView = NSTextView()
    private let tryResult = NSTextField(wrappingLabelWithString: "")
    private let activeLabel = NSTextField(wrappingLabelWithString: "")

    private var visibleRows: [Int] = []
    private var extraColumns = 0
    private var savingOwnChange = false
    private var textSaveWork: DispatchWorkItem?
    private static let modeKey = "codesEditorMode"
    private static let selectedKey = "codesSelectedList"

    private static let sidebarWidth: CGFloat = 250
    private static let inspectorWidth: CGFloat = 300
    private static let panelFill = NSColor(white: 0.13, alpha: 1)
    private static let barFill = NSColor(white: 0.14, alpha: 1)
    private static let divider = NSColor(white: 0.2, alpha: 1)

    // MARK: Building

    override func loadView() {
        let root = FileDropView()
        root.wantsLayer = true
        root.layer?.backgroundColor = BrowserViewController.background.cgColor
        root.onDrop = { [weak self] urls in self?.importFiles(urls) }
        view = root

        let sidebar = buildSidebar()
        let editor = buildEditor()
        let inspector = buildInspector()
        for v in [sidebar, editor, inspector] {
            v.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(v)
        }
        NSLayoutConstraint.activate([
            sidebar.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            sidebar.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            sidebar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            sidebar.widthAnchor.constraint(equalToConstant: Self.sidebarWidth),

            inspector.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            inspector.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            inspector.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            inspector.widthAnchor.constraint(equalToConstant: Self.inspectorWidth),

            editor.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            editor.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            editor.leadingAnchor.constraint(equalTo: sidebar.trailingAnchor),
            editor.trailingAnchor.constraint(equalTo: inspector.leadingAnchor),
        ])
        HomeViewController.letLabelsCompress(root)

        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(codesChanged(_:)), name: CodeReplacements.didChange, object: nil)
        nc.addObserver(self, selector: #selector(appDidBecomeActive(_:)), name: NSApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(appWillResignActive(_:)), name: NSApplication.willResignActiveNotification, object: nil)

        reloadLists(selecting: UserDefaults.standard.string(forKey: Self.selectedKey))
        updateInspector()
    }

    private func sectionLabel(_ s: String) -> NSTextField {
        let l = NSTextField(labelWithString: s.uppercased())
        l.font = .systemFont(ofSize: 9.5, weight: .semibold)
        l.textColor = NSColor(white: 0.55, alpha: 1)
        return l
    }

    private func smallButton(_ symbol: String, _ title: String, _ action: Selector) -> NSButton {
        let b = NSButton(title: title, image: NSImage(systemSymbolName: symbol, accessibilityDescription: title)!,
                         target: self, action: action)
        b.imagePosition = title.isEmpty ? .imageOnly : .imageLeading
        b.controlSize = .small
        b.bezelStyle = .push
        return b
    }

    private func buildSidebar() -> NSView {
        let panel = NSView()
        panel.wantsLayer = true
        panel.layer?.backgroundColor = Self.panelFill.cgColor

        let header = sectionLabel("Lookup files")
        listSummary.font = .systemFont(ofSize: 11)
        listSummary.textColor = .secondaryLabelColor
        listSummary.lineBreakMode = .byTruncatingTail

        let column = NSTableColumn(identifier: .init("list"))
        listTable.addTableColumn(column)
        listTable.headerView = nil
        listTable.rowHeight = 44
        listTable.backgroundColor = .clear
        listTable.intercellSpacing = NSSize(width: 0, height: 2)
        listTable.style = .plain
        listTable.selectionHighlightStyle = .regular
        listTable.dataSource = self
        listTable.delegate = self
        listTable.target = self
        listTable.doubleAction = #selector(renameList(_:))
        listTable.menu = listMenu()
        let scroll = NSScrollView()
        scroll.documentView = listTable
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true

        let newButton = smallButton("plus", "New", #selector(newList(_:)))
        newButton.toolTip = "New lookup file"
        let importButton = smallButton("square.and.arrow.down", "Import…", #selector(importPanel(_:)))
        importButton.toolTip = "Import a roster (.txt tab-delimited, or .csv)"
        actionButton.pullsDown = true
        actionButton.controlSize = .small
        actionButton.bezelStyle = .push
        actionButton.menu = listMenu(withTitleItem: true)
        (actionButton.cell as? NSPopUpButtonCell)?.arrowPosition = .noArrow
        actionButton.toolTip = "More actions for the selected file"
        let buttons = NSStackView(views: [newButton, importButton, NSView(), actionButton])

        let dropHint = NSTextField(wrappingLabelWithString: "Drop .txt or .csv rosters anywhere in this window to import them.")
        dropHint.font = .systemFont(ofSize: 10.5)
        dropHint.textColor = .tertiaryLabelColor
        dropHint.preferredMaxLayoutWidth = Self.sidebarWidth - 28

        let border = NSBox()
        border.boxType = .custom
        border.fillColor = Self.divider
        border.borderWidth = 0

        for v in [header, listSummary, scroll, buttons, dropHint, border] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            panel.addSubview(v)
        }
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: panel.topAnchor, constant: 16),
            header.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 14),
            listSummary.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 3),
            listSummary.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            listSummary.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -14),
            scroll.topAnchor.constraint(equalTo: listSummary.bottomAnchor, constant: 10),
            scroll.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 6),
            scroll.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -6),
            buttons.topAnchor.constraint(equalTo: scroll.bottomAnchor, constant: 10),
            buttons.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 12),
            buttons.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -12),
            dropHint.topAnchor.constraint(equalTo: buttons.bottomAnchor, constant: 10),
            dropHint.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 14),
            dropHint.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -14),
            dropHint.bottomAnchor.constraint(equalTo: panel.bottomAnchor, constant: -14),
            border.topAnchor.constraint(equalTo: panel.topAnchor),
            border.bottomAnchor.constraint(equalTo: panel.bottomAnchor),
            border.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
            border.widthAnchor.constraint(equalToConstant: 1),
        ])
        return panel
    }

    private func listMenu(withTitleItem: Bool = false) -> NSMenu {
        let m = NSMenu()
        if withTitleItem {
            m.addItem(withTitle: "", action: nil, keyEquivalent: "").image =
                NSImage(systemSymbolName: "ellipsis.circle", accessibilityDescription: "More")
        }
        m.addItem(withTitle: "Rename…", action: #selector(renameList(_:)), keyEquivalent: "")
        m.addItem(withTitle: "Add Prefix to Every Code…", action: #selector(addPrefix(_:)), keyEquivalent: "")
        m.addItem(withTitle: "Sort by Code", action: #selector(sortByCode(_:)), keyEquivalent: "")
        m.addItem(.separator())
        m.addItem(withTitle: "Show in Finder", action: #selector(revealList(_:)), keyEquivalent: "")
        m.addItem(withTitle: "Open Lookup Files Folder", action: #selector(openFolder(_:)), keyEquivalent: "")
        m.addItem(.separator())
        m.addItem(withTitle: "Move to Trash…", action: #selector(trashList(_:)), keyEquivalent: "")
        for item in m.items { item.target = self }
        return m
    }

    private func buildEditor() -> NSView {
        let panel = NSView()

        let bar = NSStackView()
        bar.orientation = .horizontal
        bar.spacing = 8
        bar.edgeInsets = NSEdgeInsets(top: 0, left: 16, bottom: 0, right: 12)
        bar.wantsLayer = true
        bar.layer?.backgroundColor = Self.barFill.cgColor
        titleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        titleLabel.textColor = NSColor(white: 0.93, alpha: 1)
        titleLabel.lineBreakMode = .byTruncatingTail
        subtitleLabel.font = .systemFont(ofSize: 11.5)
        subtitleLabel.textColor = .secondaryLabelColor
        subtitleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        subtitleLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)

        searchField.placeholderString = "Search codes"
        searchField.controlSize = .small
        searchField.sendsSearchStringImmediately = true
        searchField.target = self
        searchField.action = #selector(searchChanged(_:))
        searchField.widthAnchor.constraint(equalToConstant: 160).isActive = true

        modeSegment.controlSize = .small
        modeSegment.target = self
        modeSegment.action = #selector(modeChanged(_:))
        modeSegment.selectedSegment = UserDefaults.standard.integer(forKey: Self.modeKey) == 1 ? 1 : 0
        modeSegment.setToolTip("Edit as a table", forSegment: 0)
        modeSegment.setToolTip("Edit the raw tab-delimited file (paste straight from a spreadsheet)", forSegment: 1)

        for (b, symbol, title, action, tip) in [
            (addRowButton, "plus", "Code", #selector(addRow(_:)), "Add a code (⌘N in the table)"),
            (addColumnButton, "rectangle.split.3x1", "Column", #selector(addColumn(_:)), "Add an expansion column"),
        ] {
            b.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)
            b.title = title
            b.imagePosition = .imageLeading
            b.controlSize = .small
            b.bezelStyle = .push
            b.target = self
            b.action = action
            b.toolTip = tip
        }
        for v in [titleLabel, subtitleLabel, searchField, modeSegment, addColumnButton, addRowButton] as [NSView] {
            bar.addArrangedSubview(v)
        }
        bar.setCustomSpacing(14, after: subtitleLabel)
        bar.setCustomSpacing(12, after: modeSegment)
        bar.setVisibilityPriority(NSStackView.VisibilityPriority(600), for: subtitleLabel)
        bar.setVisibilityPriority(NSStackView.VisibilityPriority(650), for: addColumnButton)

        entryTable.owner = self
        entryTable.dataSource = self
        entryTable.delegate = self
        entryTable.rowHeight = 26
        entryTable.backgroundColor = BrowserViewController.background
        entryTable.gridStyleMask = [.solidHorizontalGridLineMask, .solidVerticalGridLineMask]
        entryTable.gridColor = NSColor(white: 0.17, alpha: 1)
        entryTable.intercellSpacing = NSSize(width: 0, height: 0)
        entryTable.style = .plain
        entryTable.allowsMultipleSelection = true
        entryTable.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
        entryTable.target = self
        entryTable.doubleAction = #selector(editClickedCell(_:))
        let headerMenu = NSMenu()
        headerMenu.delegate = self
        entryTable.headerView?.menu = headerMenu
        entryScroll.documentView = entryTable
        entryScroll.hasVerticalScroller = true
        entryScroll.hasHorizontalScroller = true
        entryScroll.autohidesScrollers = true
        entryScroll.drawsBackground = true
        entryScroll.backgroundColor = BrowserViewController.background

        textView.isRichText = false
        textView.allowsUndo = true
        textView.font = .monospacedSystemFont(ofSize: 12.5, weight: .regular)
        textView.textColor = NSColor(white: 0.92, alpha: 1)
        textView.backgroundColor = BrowserViewController.background
        textView.insertionPointColor = .white
        for flag in [\NSTextView.isAutomaticQuoteSubstitutionEnabled, \.isAutomaticDashSubstitutionEnabled,
                     \.isAutomaticTextReplacementEnabled, \.isAutomaticSpellingCorrectionEnabled, \.isContinuousSpellCheckingEnabled] {
            textView[keyPath: flag] = false
        }
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = true
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
        textView.textContainerInset = NSSize(width: 10, height: 10)
        textView.delegate = self
        let tabStops = (1...12).map { NSTextTab(textAlignment: .left, location: CGFloat($0) * 180) }
        let para = NSMutableParagraphStyle()
        para.tabStops = tabStops
        textView.defaultParagraphStyle = para
        textView.typingAttributes[.paragraphStyle] = para
        textScroll.documentView = textView
        textScroll.hasVerticalScroller = true
        textScroll.hasHorizontalScroller = true
        textScroll.autohidesScrollers = true

        warningLabel.font = .systemFont(ofSize: 11.5)
        warningLabel.textColor = HomeStyle.warning
        warningLabel.lineBreakMode = .byTruncatingTail
        let footer = NSView()
        footer.wantsLayer = true
        footer.layer?.backgroundColor = Self.barFill.cgColor
        warningLabel.translatesAutoresizingMaskIntoConstraints = false
        footer.addSubview(warningLabel)

        editorEmpty.orientation = .vertical
        editorEmpty.alignment = .centerX
        editorEmpty.spacing = 12
        let icon = NSImageView(image: NSImage(systemSymbolName: "list.bullet.rectangle", accessibilityDescription: nil)!)
        icon.symbolConfiguration = .init(pointSize: 48, weight: .ultraLight)
        icon.contentTintColor = NSColor(white: 0.45, alpha: 1)
        editorEmptyTitle.font = .systemFont(ofSize: 20, weight: .semibold)
        editorEmptyTitle.textColor = NSColor(white: 0.9, alpha: 1)
        let sub = NSTextField(wrappingLabelWithString:
            "A lookup file is a roster: a short code, a Tab, then the full name, team, position — as many columns as you need. "
            + "Make one before the game, then type codes while you caption.")
        sub.alignment = .center
        sub.textColor = NSColor(white: 0.6, alpha: 1)
        sub.preferredMaxLayoutWidth = 420
        let emptyButtons = NSStackView(views: [
            smallButton("plus", "New Lookup File", #selector(newList(_:))),
            smallButton("square.and.arrow.down", "Import Roster…", #selector(importPanel(_:))),
        ])
        emptyButtons.spacing = 10
        for case let b as NSButton in emptyButtons.arrangedSubviews { b.controlSize = .large }
        for v in [icon, editorEmptyTitle, sub, emptyButtons] as [NSView] { editorEmpty.addArrangedSubview(v) }
        editorEmpty.setCustomSpacing(18, after: sub)

        for v in [bar, entryScroll, textScroll, footer, editorEmpty] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            panel.addSubview(v)
        }
        editorViews = [bar, entryScroll, textScroll, footer]
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: panel.topAnchor),
            bar.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 46),
            footer.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: panel.bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: 28),
            warningLabel.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: 16),
            warningLabel.trailingAnchor.constraint(equalTo: footer.trailingAnchor, constant: -16),
            warningLabel.centerYAnchor.constraint(equalTo: footer.centerYAnchor),
            editorEmpty.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
            editorEmpty.centerYAnchor.constraint(equalTo: panel.centerYAnchor, constant: -20),
            editorEmpty.widthAnchor.constraint(lessThanOrEqualToConstant: 460),
        ])
        for scroll in [entryScroll, textScroll] {
            NSLayoutConstraint.activate([
                scroll.topAnchor.constraint(equalTo: bar.bottomAnchor),
                scroll.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
                scroll.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
                scroll.bottomAnchor.constraint(equalTo: footer.topAnchor),
            ])
        }
        return panel
    }

    private func buildInspector() -> NSView {
        let panel = NSView()
        panel.wantsLayer = true
        panel.layer?.backgroundColor = Self.panelFill.cgColor
        let inner = Self.inspectorWidth - 28

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 6
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 14, bottom: 18, right: 14)

        // Typing
        stack.addArrangedSubview(sectionLabel("Typing codes"))
        let delimiterLabel = NSTextField(labelWithString: "Delimiter")
        delimiterLabel.font = .systemFont(ofSize: 12.5)
        delimiterLabel.textColor = NSColor(white: 0.85, alpha: 1)
        let names = ["=": "equals", "\\": "backslash", ";": "semicolon", "~": "tilde", "`": "backtick", "|": "bar", "^": "caret"]
        for d in CodeReplacements.delimiterChoices {
            delimiterPopup.addItem(withTitle: "\(d)   \(names[d] ?? "")")
            delimiterPopup.lastItem?.representedObject = d
        }
        delimiterPopup.controlSize = .small
        delimiterPopup.target = self
        delimiterPopup.action = #selector(delimiterChanged(_:))
        delimiterPopup.toolTip = "The character that wraps a code while you caption"
        let delimiterRow = NSStackView(views: [delimiterLabel, NSView(), delimiterPopup])
        stack.addArrangedSubview(delimiterRow)
        delimiterRow.widthAnchor.constraint(equalToConstant: inner).isActive = true

        liveCheckbox.controlSize = .small
        liveCheckbox.font = .systemFont(ofSize: 11.5)
        liveCheckbox.target = self
        liveCheckbox.action = #selector(liveChanged(_:))
        stack.addArrangedSubview(liveCheckbox)
        let liveNote = note("A code turns into its text the moment you type the closing delimiter. When off, codes expand when you leave the caption field.", width: inner)
        stack.addArrangedSubview(liveNote)
        stack.setCustomSpacing(18, after: liveNote)

        // Syntax cheat sheet, built from a real code in the active files.
        stack.addArrangedSubview(sectionLabel("How it works"))
        syntaxStack.orientation = .vertical
        syntaxStack.alignment = .leading
        syntaxStack.spacing = 6
        stack.addArrangedSubview(syntaxStack)
        syntaxStack.widthAnchor.constraint(equalToConstant: inner).isActive = true
        stack.setCustomSpacing(18, after: syntaxStack)

        // Try it
        stack.addArrangedSubview(sectionLabel("Try it"))
        tryView.isRichText = false
        tryView.allowsUndo = true
        tryView.font = .systemFont(ofSize: 13)
        tryView.textColor = NSColor(white: 0.93, alpha: 1)
        tryView.backgroundColor = NSColor(white: 0.08, alpha: 1)
        tryView.insertionPointColor = .white
        tryView.textContainerInset = NSSize(width: 4, height: 5)
        tryView.isVerticallyResizable = true
        tryView.autoresizingMask = [.width]
        tryView.textContainer?.widthTracksTextView = true
        tryView.isAutomaticQuoteSubstitutionEnabled = false
        tryView.isAutomaticTextReplacementEnabled = false
        tryView.delegate = self
        let tryScroll = NSScrollView()
        tryScroll.documentView = tryView
        tryScroll.hasVerticalScroller = true
        tryScroll.borderType = .bezelBorder
        stack.addArrangedSubview(tryScroll)
        tryScroll.widthAnchor.constraint(equalToConstant: inner).isActive = true
        tryScroll.heightAnchor.constraint(equalToConstant: 86).isActive = true
        tryResult.font = .systemFont(ofSize: 11.5)
        tryResult.textColor = .secondaryLabelColor
        tryResult.preferredMaxLayoutWidth = inner
        stack.addArrangedSubview(tryResult)
        stack.setCustomSpacing(18, after: tryResult)

        // Active
        stack.addArrangedSubview(sectionLabel("Active while captioning"))
        activeLabel.font = .systemFont(ofSize: 11.5)
        activeLabel.textColor = NSColor(white: 0.78, alpha: 1)
        activeLabel.preferredMaxLayoutWidth = inner
        stack.addArrangedSubview(activeLabel)

        let doc = FlippedView()
        doc.translatesAutoresizingMaskIntoConstraints = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        doc.addSubview(stack)
        let scroll = NSScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.scrollerStyle = .overlay
        scroll.documentView = doc
        let border = NSBox()
        border.boxType = .custom
        border.fillColor = Self.divider
        border.borderWidth = 0
        border.translatesAutoresizingMaskIntoConstraints = false
        panel.addSubview(scroll)
        panel.addSubview(border)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: panel.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: panel.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: panel.trailingAnchor),
            doc.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            doc.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            doc.widthAnchor.constraint(equalToConstant: Self.inspectorWidth),
            stack.topAnchor.constraint(equalTo: doc.topAnchor),
            stack.leadingAnchor.constraint(equalTo: doc.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: doc.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: doc.bottomAnchor),
            border.topAnchor.constraint(equalTo: panel.topAnchor),
            border.bottomAnchor.constraint(equalTo: panel.bottomAnchor),
            border.leadingAnchor.constraint(equalTo: panel.leadingAnchor),
            border.widthAnchor.constraint(equalToConstant: 1),
        ])
        return panel
    }

    private func note(_ s: String, width: CGFloat) -> NSTextField {
        let l = NSTextField(wrappingLabelWithString: s)
        l.font = .systemFont(ofSize: 10.5)
        l.textColor = .tertiaryLabelColor
        l.preferredMaxLayoutWidth = width
        return l
    }

    // MARK: Workspace hand-off

    func didBecomeVisible() {
        codes.reloadIfChangedOnDisk()
        if selected == nil || codes.lists.isEmpty {
            view.window?.makeFirstResponder(listTable)
        } else if modeSegment.selectedSegment == 1 {
            view.window?.makeFirstResponder(textView)
        } else {
            view.window?.makeFirstResponder(entryTable)
            if entryTable.selectedRow < 0, entryTable.numberOfRows > 0 {
                entryTable.selectRowIndexes([0], byExtendingSelection: false)
            }
        }
    }

    /// Before another workspace covers this one: finish the edit in progress and save.
    func prepareToLeave() {
        if let editor = view.window?.firstResponder as? NSTextView, editor.isFieldEditor,
           (editor.delegate as? NSView)?.isDescendant(of: entryTable) == true {
            view.window?.makeFirstResponder(entryTable)
        }
        flushTextEdits()
    }

    @objc private func appDidBecomeActive(_ note: Notification) {
        guard !view.isHidden else { return }
        codes.reloadIfChangedOnDisk()
    }

    @objc private func appWillResignActive(_ note: Notification) { flushTextEdits() }

    // MARK: Refreshing

    @objc private func codesChanged(_ note: Notification) {
        if savingOwnChange {
            refreshListRows()
            updateHeader()
            updateWarnings()
            updateInspector()
            return
        }
        reloadLists(selecting: selected?.fileName)
        updateInspector()
    }

    private func reloadLists(selecting fileName: String?) {
        let lists = codes.lists
        listTable.reloadData()
        let index = lists.firstIndex { $0.fileName == fileName } ?? (lists.isEmpty ? nil : 0)
        if let index {
            listTable.selectRowIndexes([index], byExtendingSelection: false)
            select(lists[index])
        } else {
            select(nil)
        }
        updateSummary()
    }

    private func refreshListRows() {
        let sel = listTable.selectedRowIndexes
        listTable.reloadData()
        listTable.selectRowIndexes(sel, byExtendingSelection: false)
        updateSummary()
    }

    private func updateSummary() {
        let active = codes.activeLists.count
        let total = codes.lists.count
        if total == 0 {
            listSummary.stringValue = "No files yet"
        } else {
            listSummary.stringValue = "\(active) of \(total) on · \(codes.activeCodeCount) code\(codes.activeCodeCount == 1 ? "" : "s") ready"
        }
    }

    private func select(_ list: CodeList?) {
        flushTextEdits()
        let changed = list !== selected
        selected = list
        if changed {
            extraColumns = 0
            searchField.stringValue = ""
        }
        UserDefaults.standard.set(list?.fileName, forKey: Self.selectedKey)
        let hasList = list != nil
        editorEmpty.isHidden = hasList
        editorEmptyTitle.stringValue = codes.lists.isEmpty ? "No lookup files yet" : "Select a lookup file"
        applyMode()
        editorViews.forEach { if !hasList { $0.isHidden = true } }
        rebuildColumns()
        updateVisibleRows()
        entryTable.reloadData()
        textView.string = list?.text ?? ""
        textView.undoManager?.removeAllActions()
        updateHeader()
        updateWarnings()
        updateInspector()
    }

    private func applyMode() {
        let text = modeSegment.selectedSegment == 1
        let hasList = selected != nil
        entryScroll.isHidden = !hasList || text
        textScroll.isHidden = !hasList || !text
        editorViews.first?.isHidden = !hasList
        editorViews.last?.isHidden = !hasList
        searchField.isHidden = text
        addRowButton.isHidden = text
        addColumnButton.isHidden = text
    }

    private func updateHeader() {
        guard let list = selected else { return }
        titleLabel.stringValue = list.name
        let n = list.codeCount
        let cols = list.expansionColumns
        var parts = ["\(n) code\(n == 1 ? "" : "s")", "\(cols) column\(cols == 1 ? "" : "s")"]
        if !codes.isEnabled(list) { parts.append("off — not used while captioning") }
        subtitleLabel.stringValue = parts.joined(separator: " · ")
    }

    private var columnCount: Int { max(3, (selected?.expansionColumns ?? 0) + extraColumns) }

    private func rebuildColumns() {
        let wanted = columnCount + 1
        let names = selected.map(codes.columnNames(for:)) ?? []
        while entryTable.tableColumns.count > wanted { entryTable.removeTableColumn(entryTable.tableColumns.last!) }
        while entryTable.tableColumns.count < wanted {
            let i = entryTable.tableColumns.count
            let c = NSTableColumn(identifier: .init("col\(i)"))
            c.width = i == 0 ? 100 : 230
            c.minWidth = i == 0 ? 60 : 80
            c.maxWidth = 2000
            entryTable.addTableColumn(c)
        }
        for (i, c) in entryTable.tableColumns.enumerated() {
            if i == 0 {
                c.title = "Code"
                c.headerToolTip = "Type it between delimiters while captioning"
            } else {
                let name = i <= names.count ? names[i - 1] : ""
                c.title = "#\(i)" + (name.isEmpty ? "" : "  \(name)") + (i == 1 ? "  · default" : "")
                c.headerToolTip = i == 1
                    ? "What \(codes.delimiter)code\(codes.delimiter) types. Right-click to name this column."
                    : "What \(codes.delimiter)code#\(i)\(codes.delimiter) types. Right-click to name this column."
            }
        }
    }

    private func updateVisibleRows() {
        guard let list = selected else { visibleRows = []; return }
        let q = searchField.stringValue.trimmingCharacters(in: .whitespaces)
        if q.isEmpty {
            visibleRows = Array(list.rows.indices)
        } else {
            visibleRows = list.rows.indices.filter { i in
                list.rows[i].contains { $0.range(of: q, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
            }
        }
    }

    private var duplicateCodes: Set<String> {
        guard let list = selected else { return [] }
        var seen = Set<String>(), dups = Set<String>()
        for row in list.rows {
            let c = (row.first ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            guard !c.isEmpty else { continue }
            if !seen.insert(c).inserted { dups.insert(c) }
        }
        return dups
    }

    private func updateWarnings() {
        guard let list = selected else { warningLabel.stringValue = ""; return }
        var messages: [String] = []
        let dups = duplicateCodes
        if !dups.isEmpty {
            messages.append("Used twice in this file: " + dups.sorted().prefix(6).joined(separator: ", ") + (dups.count > 6 ? "…" : ""))
        }
        if codes.isEnabled(list) {
            let shadowed = codes.conflicts.filter { $0.value.contains(list.name) && $0.value.first != list.name }
            if !shadowed.isEmpty {
                let other = shadowed.first!.value.first!
                messages.append("\(shadowed.count) code\(shadowed.count == 1 ? " is" : "s are") also in “\(other)”, which wins")
            }
        }
        let bad = list.rows.compactMap { $0.first }.filter { code in
            code.contains(codes.delimiter) || code.contains(where: \.isWhitespace)
        }
        if !bad.isEmpty {
            messages.append("Codes can’t contain spaces or \(codes.delimiter): " + bad.prefix(4).joined(separator: ", "))
        }
        warningLabel.textColor = HomeStyle.warning
        if messages.isEmpty {
            warningLabel.textColor = .tertiaryLabelColor
            warningLabel.stringValue = "Saved automatically · \((list.url.path as NSString).abbreviatingWithTildeInPath)"
        } else {
            warningLabel.stringValue = "⚠︎ " + messages.joined(separator: "   ·   ")
        }
    }

    private func updateInspector() {
        let d = codes.delimiter
        if let i = CodeReplacements.delimiterChoices.firstIndex(of: d) { delimiterPopup.selectItem(at: i) }
        liveCheckbox.state = codes.expandsWhileTyping ? .on : .off

        // Examples come from the selected file when it's on, else any active file.
        let pool = ([selected].compactMap { $0 }.filter(codes.isEnabled) + codes.activeLists)
        let example = pool.lazy.compactMap { list -> (CodeList, [String])? in
            let rows = list.rows.filter { ($0.first ?? "").isEmpty == false && self.codes.resolve($0[0])?.list === list }
            guard let best = rows.max(by: { $0.count < $1.count }) else { return nil }
            return (list, best)
        }.first

        syntaxStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let code = example?.1.first ?? "L7"
        let values = example.map { Array($0.1.dropFirst()) } ?? ["Luka Dončić", "Dallas Mavericks", "guard"]
        let names = example.map { codes.columnNames(for: $0.0) } ?? ["Name", "Team", "Position"]
        let shown = max(1, min(3, values.count))
        for i in 0..<shown {
            let typed = i == 0 ? "\(d)\(code)\(d)" : "\(d)\(code)#\(i + 1)\(d)"
            let colName = i < names.count && !names[i].isEmpty ? "#\(i + 1) \(names[i])" : "column #\(i + 1)"
            syntaxStack.addArrangedSubview(syntaxRow(typed: typed, result: values[i], detail: colName))
        }
        let explain = note("Type a code between two \(d) and it turns into the text from its line. Add #2, #3… before the "
                           + "closing \(d) to use another column. Codes aren’t case-sensitive; unknown codes stay as typed."
                           + (example == nil ? " (Example — turn on a lookup file to see your own codes here.)" : ""),
                           width: Self.inspectorWidth - 28)
        syntaxStack.addArrangedSubview(explain)

        if tryView.string.isEmpty {
            tryResult.stringValue = "Type something like \(d)\(code)\(d) scores against \(d)\(code)#2\(d)"
            tryResult.textColor = .secondaryLabelColor
        }

        let active = codes.activeLists
        if active.isEmpty {
            activeLabel.stringValue = "No lookup files are on. Tick a file on the left to use its codes in the caption panel."
        } else {
            var lines = active.map { "•  \($0.name) — \($0.codeCount) code\($0.codeCount == 1 ? "" : "s")" }
            if !codes.conflicts.isEmpty {
                lines.append("\n\(codes.conflicts.count) code\(codes.conflicts.count == 1 ? " is" : "s are") in more than one file; "
                             + "the file that sorts first wins.")
            }
            activeLabel.stringValue = lines.joined(separator: "\n")
        }
    }

    private func syntaxRow(typed: String, result: String, detail: String) -> NSView {
        let left = NSTextField(labelWithString: typed)
        left.font = .monospacedSystemFont(ofSize: 12, weight: .semibold)
        left.textColor = HomeStyle.ready
        left.lineBreakMode = .byTruncatingTail
        let arrow = NSTextField(labelWithString: "→")
        arrow.textColor = .tertiaryLabelColor
        let right = NSTextField(labelWithString: result.isEmpty ? "(empty)" : result)
        right.font = .systemFont(ofSize: 12)
        right.textColor = NSColor(white: 0.9, alpha: 1)
        right.lineBreakMode = .byTruncatingTail
        right.toolTip = detail
        left.widthAnchor.constraint(lessThanOrEqualToConstant: 120).isActive = true
        for v in [left, right] { v.setContentCompressionResistancePriority(.defaultLow, for: .horizontal) }
        let row = NSStackView(views: [left, arrow, right])
        row.spacing = 6
        return row
    }

    // MARK: Actions — files

    @objc private func newList(_ sender: Any?) {
        flushTextEdits()
        let list = codes.createList(named: "Untitled Roster")
        reloadLists(selecting: list.fileName)
        renameList(nil)
    }

    @objc private func importPanel(_ sender: Any?) {
        guard let window = view.window else { return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.plainText, .tabSeparatedText, .commaSeparatedText, .text]
        panel.message = "Choose rosters to import — tab-delimited .txt (Photo Mechanic format) or .csv"
        panel.prompt = "Import"
        panel.beginSheetModal(for: window) { [weak self] resp in
            guard resp == .OK else { return }
            self?.importFiles(panel.urls)
        }
    }

    func importFiles(_ urls: [URL]) {
        flushTextEdits()
        var last: CodeList?
        var failures: [String] = []
        for url in urls {
            do { last = try codes.importFile(url) } catch { failures.append(error.localizedDescription) }
        }
        if let last { reloadLists(selecting: last.fileName) }
        if !failures.isEmpty, let window = view.window {
            let alert = NSAlert()
            alert.messageText = failures.count == 1 ? "Couldn’t import that file" : "Some files couldn’t be imported"
            alert.informativeText = failures.joined(separator: "\n")
            alert.beginSheetModal(for: window)
        }
    }

    /// The file a menu acts on: the right-clicked row, otherwise the selection.
    private var targetList: CodeList? {
        let lists = codes.lists
        if listTable.clickedRow >= 0, listTable.clickedRow < lists.count { return lists[listTable.clickedRow] }
        return selected
    }

    @objc private func renameList(_ sender: Any?) {
        guard let list = targetList, let window = view.window else { return }
        let field = NSTextField(string: list.name)
        field.frame = NSRect(x: 0, y: 0, width: 260, height: 24)
        let alert = NSAlert()
        alert.messageText = "Rename Lookup File"
        alert.informativeText = "Tip: name rosters by team and season, like “Fairborn Football 2026”."
        alert.accessoryView = field
        alert.addButton(withTitle: "Rename")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) { [weak self] resp in
            guard resp == .alertFirstButtonReturn, let self else { return }
            do {
                try self.codes.rename(list, to: field.stringValue)
                self.reloadLists(selecting: list.fileName)
            } catch {
                NSAlert(error: error).beginSheetModal(for: window)
            }
        }
    }

    @objc private func addPrefix(_ sender: Any?) {
        guard let list = targetList, let window = view.window else { return }
        let field = NSTextField(string: "")
        field.placeholderString = "e.g. f"
        field.frame = NSRect(x: 0, y: 0, width: 120, height: 24)
        let alert = NSAlert()
        alert.messageText = "Add a Prefix to Every Code in “\(list.name)”"
        alert.informativeText = "Handy when both teams have a #10: prefix Fairborn’s roster with “f” and 10 becomes f10."
        alert.accessoryView = field
        alert.addButton(withTitle: "Add Prefix")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) { [weak self] resp in
            let prefix = field.stringValue.trimmingCharacters(in: .whitespaces)
            guard resp == .alertFirstButtonReturn, !prefix.isEmpty, let self else { return }
            self.flushTextEdits()
            for i in list.rows.indices where !(list.rows[i].first ?? "").isEmpty {
                list.rows[i][0] = prefix + list.rows[i][0]
            }
            self.saveSelected(list, reloadEditor: true)
        }
    }

    @objc private func sortByCode(_ sender: Any?) {
        guard let list = targetList else { return }
        flushTextEdits()
        list.rows.sort { ($0.first ?? "").localizedStandardCompare($1.first ?? "") == .orderedAscending }
        saveSelected(list, reloadEditor: true)
    }

    @objc private func revealList(_ sender: Any?) {
        guard let list = targetList else { return }
        NSWorkspace.shared.activateFileViewerSelecting([list.url])
    }

    @objc private func openFolder(_ sender: Any?) {
        NSWorkspace.shared.open(CodeReplacements.listsDirectory)
    }

    @objc private func trashList(_ sender: Any?) {
        guard let list = targetList, let window = view.window else { return }
        let alert = NSAlert()
        alert.messageText = "Move “\(list.name)” to the Trash?"
        alert.informativeText = "Its \(list.codeCount) codes stop working in captions. You can get the file back from the Trash."
        alert.addButton(withTitle: "Move to Trash")
        alert.addButton(withTitle: "Cancel")
        alert.buttons.first?.hasDestructiveAction = true
        alert.beginSheetModal(for: window) { [weak self] resp in
            guard resp == .alertFirstButtonReturn, let self else { return }
            self.textSaveWork?.cancel()
            do { try self.codes.trash(list) } catch { NSAlert(error: error).beginSheetModal(for: window) }
        }
    }

    fileprivate func toggleEnabled(_ list: CodeList, _ on: Bool) {
        savingOwnChange = true
        codes.setEnabled(on, for: list)
        savingOwnChange = false
    }

    // MARK: Actions — editing

    private func saveSelected(_ list: CodeList, reloadEditor: Bool = false) {
        savingOwnChange = true
        codes.save(list)
        savingOwnChange = false
        guard list === selected else { return }
        if reloadEditor {
            rebuildColumns()
            updateVisibleRows()
            entryTable.reloadData()
            textView.string = list.text
        }
    }

    @objc private func searchChanged(_ sender: Any?) {
        updateVisibleRows()
        entryTable.reloadData()
    }

    @objc private func modeChanged(_ sender: Any?) {
        if modeSegment.selectedSegment == 0 {
            flushTextEdits()
        } else {
            view.window?.makeFirstResponder(entryTable)
            textView.string = selected?.text ?? ""
        }
        UserDefaults.standard.set(modeSegment.selectedSegment, forKey: Self.modeKey)
        applyMode()
        rebuildColumns()
        updateVisibleRows()
        entryTable.reloadData()
        didBecomeVisible()
    }

    @objc func addRow(_ sender: Any?) {
        guard let list = selected else { return }
        if modeSegment.selectedSegment == 1 {
            modeSegment.selectedSegment = 0
            modeChanged(nil)
        }
        view.window?.makeFirstResponder(entryTable)
        if !searchField.stringValue.isEmpty {
            searchField.stringValue = ""
        }
        list.rows.append([""])
        updateVisibleRows()
        entryTable.reloadData()
        let row = visibleRows.count - 1
        entryTable.selectRowIndexes([row], byExtendingSelection: false)
        entryTable.scrollRowToVisible(row)
        entryTable.editColumn(0, row: row, with: nil, select: true)
    }

    @objc private func addColumn(_ sender: Any?) {
        guard selected != nil else { return }
        extraColumns += 1
        rebuildColumns()
        entryTable.reloadData()
        let col = entryTable.tableColumns.count - 1
        entryTable.scrollColumnToVisible(col)
        let row = max(0, entryTable.selectedRow)
        if row < entryTable.numberOfRows { entryTable.editColumn(col, row: row, with: nil, select: true) }
    }

    @objc private func editClickedCell(_ sender: Any?) {
        let row = entryTable.clickedRow, col = entryTable.clickedColumn
        if row >= 0, col >= 0 {
            entryTable.editColumn(col, row: row, with: nil, select: true)
        } else if row < 0 {
            addRow(nil)
        }
    }

    fileprivate func editSelectedRow() {
        let row = entryTable.selectedRow
        guard row >= 0 else { return }
        entryTable.editColumn(0, row: row, with: nil, select: true)
    }

    fileprivate func deleteSelectedRows() {
        guard let list = selected else { return }
        let indices = entryTable.selectedRowIndexes.compactMap { $0 < visibleRows.count ? visibleRows[$0] : nil }
        guard !indices.isEmpty else { NSSound.beep(); return }
        let first = entryTable.selectedRowIndexes.first ?? 0
        for i in indices.sorted(by: >) { list.rows.remove(at: i) }
        saveSelected(list, reloadEditor: true)
        let next = min(first, entryTable.numberOfRows - 1)
        if next >= 0 { entryTable.selectRowIndexes([next], byExtendingSelection: false) }
    }

    /// Rows copied from a spreadsheet (tab-delimited) or a CSV paste are added to the file.
    fileprivate func pasteRows() {
        guard let list = selected, let s = NSPasteboard.general.string(forType: .string) else { NSSound.beep(); return }
        let parsed = s.contains("\t") || !s.contains(",") ? CodeList.parse(s).rows : CodeList.parseCSV(s).filter { $0.contains { !$0.isEmpty } }
        guard !parsed.isEmpty else { NSSound.beep(); return }
        searchField.stringValue = ""
        let start = list.rows.count
        list.rows.append(contentsOf: parsed)
        saveSelected(list, reloadEditor: true)
        entryTable.selectRowIndexes(IndexSet(start..<list.rows.count), byExtendingSelection: false)
        entryTable.scrollRowToVisible(list.rows.count - 1)
    }

    fileprivate func copyRows() {
        guard let list = selected else { return }
        let lines = entryTable.selectedRowIndexes.compactMap { $0 < visibleRows.count ? list.rows[visibleRows[$0]] : nil }
            .map { $0.joined(separator: "\t") }
        guard !lines.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(lines.joined(separator: "\n"), forType: .string)
    }

    private func scheduleTextSave() {
        textSaveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.flushTextEdits() }
        textSaveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
    }

    private func flushTextEdits() {
        guard let work = textSaveWork else { return }
        work.cancel()
        textSaveWork = nil
        guard let list = selected else { return }
        let parsed = CodeList.parse(textView.string)
        list.comments = parsed.comments
        list.rows = parsed.rows
        saveSelected(list)
        rebuildColumns()
        updateVisibleRows()
        entryTable.reloadData()
    }

    @objc private func delimiterChanged(_ sender: Any?) {
        guard let d = delimiterPopup.selectedItem?.representedObject as? String else { return }
        codes.delimiter = d
        rebuildColumns()
        tryView.string = ""
    }

    @objc private func liveChanged(_ sender: Any?) {
        codes.expandsWhileTyping = liveCheckbox.state == .on
    }

    private func renameColumn(_ column: Int) {
        guard let list = selected, column >= 1, let window = view.window else { return }
        let names = codes.columnNames(for: list)
        let field = NSTextField(string: column <= names.count ? names[column - 1] : "")
        field.placeholderString = ["Name", "Team", "Position", "Class", "Hometown"][min(column - 1, 4)]
        field.frame = NSRect(x: 0, y: 0, width: 220, height: 24)
        let alert = NSAlert()
        alert.messageText = "Name Column #\(column)"
        alert.informativeText = "Only a label for you — it isn’t written into the file, and =code#\(column)= keeps working."
            .replacingOccurrences(of: "=", with: codes.delimiter)
        alert.accessoryView = field
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) { [weak self] resp in
            guard resp == .alertFirstButtonReturn, let self else { return }
            self.savingOwnChange = true
            self.codes.setColumnName(field.stringValue, column: column, for: list)
            self.savingOwnChange = false
            self.rebuildColumns()
        }
    }

    @objc private func renameColumnMenu(_ sender: NSMenuItem) { renameColumn(sender.tag) }
}

// MARK: - Tables

extension CodesViewController: NSTableViewDataSource, NSTableViewDelegate {
    func numberOfRows(in tableView: NSTableView) -> Int {
        tableView === listTable ? codes.lists.count : visibleRows.count
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        if tableView === listTable {
            let cell = tableView.makeView(withIdentifier: ListCell.id, owner: nil) as? ListCell ?? ListCell()
            let list = codes.lists[row]
            cell.configure(list, enabled: codes.isEnabled(list))
            cell.onToggle = { [weak self] on in self?.toggleEnabled(list, on) }
            return cell
        }
        guard let list = selected, let tableColumn, row < visibleRows.count,
              let col = tableView.tableColumns.firstIndex(of: tableColumn) else { return nil }
        let cell = tableView.makeView(withIdentifier: EntryCell.id, owner: nil) as? EntryCell ?? EntryCell()
        let cells = list.rows[visibleRows[row]]
        let value = col < cells.count ? cells[col] : ""
        cell.field.stringValue = value
        cell.field.delegate = self
        cell.field.font = col == 0 ? .monospacedSystemFont(ofSize: 12.5, weight: .semibold) : .systemFont(ofSize: 12.5)
        cell.field.placeholderString = col == 0 && value.isEmpty ? "code" : nil
        cell.field.toolTip = nil
        if col == 0 {
            let key = value.trimmingCharacters(in: .whitespaces).lowercased()
            if duplicateCodes.contains(key) {
                cell.field.textColor = HomeStyle.danger
                cell.field.toolTip = "This code is used more than once in this file — only the first line is used."
            } else if codes.isEnabled(list), !key.isEmpty, let hit = codes.resolve(value.trimmingCharacters(in: .whitespaces)),
                      hit.list !== list {
                cell.field.textColor = HomeStyle.warning
                cell.field.toolTip = "Also in “\(hit.list.name)”, which wins because it sorts first."
            } else {
                cell.field.textColor = HomeStyle.ready
            }
        } else {
            cell.field.textColor = NSColor(white: 0.9, alpha: 1)
        }
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard (notification.object as? NSTableView) === listTable else { return }
        let lists = codes.lists
        let row = listTable.selectedRow
        let list = row >= 0 && row < lists.count ? lists[row] : nil
        if list !== selected { select(list) }
    }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        tableView === listTable ? ListRowView() : nil
    }
}

extension CodesViewController: NSTextFieldDelegate, NSTextViewDelegate {
    func controlTextDidEndEditing(_ obj: Notification) {
        guard let field = obj.object as? NSTextField, let list = selected else { return }
        let row = entryTable.row(for: field), col = entryTable.column(for: field)
        guard row >= 0, col >= 0, row < visibleRows.count else { return }
        let index = visibleRows[row]
        let value = field.stringValue.trimmingCharacters(in: .whitespaces)
        var cells = list.rows[index]
        while cells.count <= col { cells.append("") }
        if cells[col] != value {
            cells[col] = value
            list.rows[index] = cells
            saveSelected(list)
            if col == 0 {
                entryTable.reloadData(forRowIndexes: IndexSet(integersIn: 0..<entryTable.numberOfRows), columnIndexes: [0])
            }
        }

        // Tab / Shift-Tab / Return move through the table like a spreadsheet.
        let movement = (obj.userInfo?["NSTextMovement"] as? Int).flatMap(NSTextMovement.init(rawValue:))
        var next: (Int, Int)?
        let lastCol = entryTable.numberOfColumns - 1
        switch movement {
        case .tab: next = col < lastCol ? (row, col + 1) : (row + 1 < entryTable.numberOfRows ? (row + 1, 0) : nil)
        case .backtab: next = col > 0 ? (row, col - 1) : (row > 0 ? (row - 1, lastCol) : nil)
        case .return: next = row + 1 < entryTable.numberOfRows ? (row + 1, col) : nil
        default: break
        }
        guard let (r, c) = next else {
            if movement == .return || movement == .tab { view.window?.makeFirstResponder(entryTable) }
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self, r < self.entryTable.numberOfRows, c < self.entryTable.numberOfColumns else { return }
            self.entryTable.selectRowIndexes([r], byExtendingSelection: false)
            self.entryTable.scrollRowToVisible(r)
            self.entryTable.editColumn(c, row: r, with: nil, select: true)
        }
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.cancelOperation(_:)) {
            view.window?.makeFirstResponder(entryTable)
            return true
        }
        return false
    }

    func textDidChange(_ notification: Notification) {
        guard let tv = notification.object as? NSTextView else { return }
        if tv === textView {
            scheduleTextSave()
        } else if tv === tryView {
            switch LiveCodeExpansion.apply(to: tryView, force: true) {
            case .expanded(let hit):
                let names = codes.columnNames(for: hit.list)
                let col = hit.column <= names.count && !names[hit.column - 1].isEmpty ? "#\(hit.column) \(names[hit.column - 1])" : "column #\(hit.column)"
                let d = codes.delimiter
                tryResult.stringValue = "✓ \(d)\(hit.token)\(d) → “\(hit.text)”  ·  \(hit.list.name), \(col)"
                tryResult.textColor = HomeStyle.ready
            case .expandedPaste:
                tryResult.stringValue = "✓ Expanded the codes in the pasted text"
                tryResult.textColor = HomeStyle.ready
            case .unknown(let token):
                let bare = token.split(separator: "#").first.map(String.init) ?? token
                tryResult.stringValue = "No active code “\(bare)” — it stays as typed. Check the spelling, or turn on its file."
                tryResult.textColor = HomeStyle.warning
            case nil:
                if tryView.string.isEmpty { updateInspector() }
            }
        }
    }
}

extension CodesViewController: NSMenuDelegate {
    /// Right-click a column header to name it.
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        guard let header = entryTable.headerView, let event = NSApp.currentEvent else { return }
        let col = header.column(at: header.convert(event.locationInWindow, from: nil))
        guard col >= 1 else {
            menu.addItem(withTitle: "The code column can’t be renamed", action: nil, keyEquivalent: "").isEnabled = false
            return
        }
        let item = menu.addItem(withTitle: "Name Column #\(col)…", action: #selector(renameColumnMenu(_:)), keyEquivalent: "")
        item.target = self
        item.tag = col
    }
}

extension CodesViewController: NSMenuItemValidation {
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(renameList(_:)), #selector(addPrefix(_:)), #selector(sortByCode(_:)),
             #selector(revealList(_:)), #selector(trashList(_:)):
            return targetList != nil
        default:
            return true
        }
    }
}

// MARK: - Views

/// The roster table: Delete removes rows, ⌘C/⌘V copy and paste rows as tab-delimited text
/// (straight to and from a spreadsheet), Return edits the selected row.
private final class EntryTableView: NSTableView {
    weak var owner: CodesViewController?

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 51, 117: owner?.deleteSelectedRows()       // delete, forward delete
        case 36, 76: owner?.editSelectedRow()           // return, enter
        default:
            if event.modifierFlags.contains(.command), event.charactersIgnoringModifiers == "n" {
                owner?.addRow(nil)
            } else {
                super.keyDown(with: event)
            }
        }
    }

    @objc func paste(_ sender: Any?) { owner?.pasteRows() }
    @objc func copy(_ sender: Any?) { owner?.copyRows() }
    @objc func delete(_ sender: Any?) { owner?.deleteSelectedRows() }
}

private final class EntryCell: NSTableCellView {
    static let id = NSUserInterfaceItemIdentifier("entry")
    let field = NSTextField()

    init() {
        super.init(frame: .zero)
        identifier = Self.id
        field.isBordered = false
        field.drawsBackground = false
        field.isEditable = true
        field.focusRingType = .none
        field.lineBreakMode = .byTruncatingTail
        field.cell?.usesSingleLineMode = true
        field.translatesAutoresizingMaskIntoConstraints = false
        addSubview(field)
        textField = field
        NSLayoutConstraint.activate([
            field.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            field.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            field.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }
}

private final class ListCell: NSTableCellView {
    static let id = NSUserInterfaceItemIdentifier("list")
    private let check = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let name = NSTextField(labelWithString: "")
    private let detail = NSTextField(labelWithString: "")
    var onToggle: ((Bool) -> Void)?

    init() {
        super.init(frame: .zero)
        identifier = Self.id
        check.target = self
        check.action = #selector(toggled(_:))
        check.toolTip = "Use this file’s codes while captioning"
        name.font = .systemFont(ofSize: 13, weight: .medium)
        name.lineBreakMode = .byTruncatingTail
        detail.font = .systemFont(ofSize: 11)
        detail.textColor = .secondaryLabelColor
        detail.lineBreakMode = .byTruncatingTail
        let text = NSStackView(views: [name, detail])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 1
        for v in [check, text] as [NSView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            addSubview(v)
        }
        NSLayoutConstraint.activate([
            check.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            check.centerYAnchor.constraint(equalTo: centerYAnchor),
            text.leadingAnchor.constraint(equalTo: check.trailingAnchor, constant: 6),
            text.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -8),
            text.centerYAnchor.constraint(equalTo: centerYAnchor),
            name.widthAnchor.constraint(lessThanOrEqualToConstant: 190),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func configure(_ list: CodeList, enabled: Bool) {
        check.state = enabled ? .on : .off
        name.stringValue = list.name
        name.textColor = enabled ? NSColor(white: 0.93, alpha: 1) : NSColor(white: 0.55, alpha: 1)
        let n = list.codeCount
        detail.stringValue = "\(n) code\(n == 1 ? "" : "s")" + (enabled ? "" : " · off")
        setAccessibilityLabel("\(list.name), \(n) codes, \(enabled ? "on" : "off")")
    }

    @objc private func toggled(_ sender: NSButton) { onToggle?(sender.state == .on) }
}

/// Sidebar selection in the Codes workspace color.
private final class ListRowView: NSTableRowView {
    override func drawSelection(in dirtyRect: NSRect) {
        let r = bounds.insetBy(dx: 2, dy: 1)
        NSColor(white: 1, alpha: 0.08).setFill()
        NSBezierPath(roundedRect: r, xRadius: 7, yRadius: 7).fill()
        Workspace.codes.tint.setFill()
        NSBezierPath(roundedRect: NSRect(x: r.minX, y: r.minY + 8, width: 3, height: r.height - 16), xRadius: 1.5, yRadius: 1.5).fill()
    }

    override var interiorBackgroundStyle: NSView.BackgroundStyle { .normal }
}

/// Accepts roster files (.txt, .csv, .tsv) dragged from the Finder.
private final class FileDropView: NSView {
    var onDrop: (([URL]) -> Void)?

    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) { fatalError() }

    private func files(_ info: NSDraggingInfo) -> [URL] {
        let urls = info.draggingPasteboard.readObjects(forClasses: [NSURL.self]) as? [URL] ?? []
        return urls.filter { ["txt", "csv", "tsv", "tab"].contains($0.pathExtension.lowercased()) }
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        files(sender).isEmpty ? [] : .copy
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = files(sender)
        guard !urls.isEmpty else { return false }
        onDrop?(urls)
        return true
    }
}
