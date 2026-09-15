import AppKit

protocol CaptionPanelDelegate: AnyObject {
    /// Photos the panel edits: the photo in the preview, otherwise the grid selection.
    func captionTargets() -> [Photo]
    /// One field was edited. Keywords are merged: `value` holds the keywords to ensure,
    /// `removedKeywords` the ones the user deleted from the common set.
    func captionPanel(commit field: IPTCField, value: String, removedKeywords: [String], to photos: [Photo])
    /// Esc / ⌘↩ — hand keyboard focus back to the grid or preview.
    func captionPanelWantsFocusBack()
    func captionPanelEditCodes()
    func captionPanelFillFromProfile()
}

/// Photo Mechanic–style IPTC panel. Edits apply to every targeted photo and are saved the
/// moment you leave a field (Tab, Esc, ⌘↩ or clicking elsewhere) — like Lightroom's panel.
final class CaptionPanel: NSView, NSTokenFieldDelegate, NSTextViewDelegate {
    weak var delegate: CaptionPanelDelegate?

    static let width: CGFloat = 330

    private var controls: [IPTCField: NSTextField] = [:]
    private let captionView = NSTextView()
    private let captionScroll = NSScrollView()
    private let keywordField = NSTokenField()
    private let header = NSTextField(labelWithString: "Caption")
    private let subheader = NSTextField(labelWithString: "")
    private let jpegModePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let help = NSTextField(wrappingLabelWithString: "")
    private let codeStatus = NSTextField(labelWithString: "")

    private var shown: [Photo] = []
    private var original: [IPTCField: String] = [:]
    private var mixed: Set<IPTCField> = []
    private var editingField: IPTCField?
    private var editingTargets: [Photo] = []
    private var committing = false

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(white: 0.13, alpha: 1).cgColor
        build()
    }

    required init?(coder: NSCoder) { fatalError() }

    // MARK: Building

    private func build() {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 4
        stack.edgeInsets = NSEdgeInsets(top: 14, left: 14, bottom: 16, right: 14)

        header.font = .systemFont(ofSize: 15, weight: .semibold)
        header.textColor = NSColor(white: 0.93, alpha: 1)
        subheader.font = .systemFont(ofSize: 11)
        subheader.textColor = .secondaryLabelColor
        subheader.lineBreakMode = .byTruncatingTail
        stack.addArrangedSubview(header)
        stack.addArrangedSubview(subheader)
        stack.setCustomSpacing(12, after: subheader)

        var keyViews: [NSView] = []
        for f in IPTCField.allCases {
            stack.addArrangedSubview(label(f.label))
            let control: NSView
            switch f {
            case .caption:
                captionView.isRichText = false
                captionView.allowsUndo = true
                captionView.font = .systemFont(ofSize: 13)
                captionView.textColor = NSColor(white: 0.93, alpha: 1)
                captionView.backgroundColor = NSColor(white: 0.08, alpha: 1)
                captionView.insertionPointColor = .white
                captionView.textContainerInset = NSSize(width: 4, height: 5)
                captionView.isVerticallyResizable = true
                captionView.autoresizingMask = [.width]
                captionView.textContainer?.widthTracksTextView = true
                captionView.isAutomaticQuoteSubstitutionEnabled = false
                captionView.isAutomaticDashSubstitutionEnabled = false
                captionView.isAutomaticTextReplacementEnabled = false
                captionView.delegate = self
                captionScroll.documentView = captionView
                captionScroll.hasVerticalScroller = true
                captionScroll.borderType = .bezelBorder
                captionScroll.heightAnchor.constraint(equalToConstant: 120).isActive = true
                control = captionScroll
                keyViews.append(captionView)
            case .keywords:
                keywordField.delegate = self
                keywordField.tokenizingCharacterSet = CharacterSet(charactersIn: ",;")
                keywordField.font = .systemFont(ofSize: 12)
                keywordField.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
                keywordField.cell?.wraps = true
                keywordField.cell?.isScrollable = false
                control = keywordField
                keyViews.append(keywordField)
            default:
                let tf = NSTextField()
                tf.delegate = self
                tf.font = .systemFont(ofSize: 12.5)
                tf.lineBreakMode = .byTruncatingTail
                tf.cell?.usesSingleLineMode = true
                controls[f] = tf
                control = tf
                keyViews.append(tf)
            }
            control.translatesAutoresizingMaskIntoConstraints = false
            stack.addArrangedSubview(control)
            control.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -28).isActive = true
            stack.setCustomSpacing(10, after: control)
        }
        for (a, b) in zip(keyViews, keyViews.dropFirst() + [keyViews[0]]) { a.nextKeyView = b }

        stack.setCustomSpacing(14, after: stack.arrangedSubviews.last!)
        stack.addArrangedSubview(label("Captions in JPG files"))
        jpegModePopup.addItems(withTitles: JPEGCaptionMode.allCases.map(\.title))
        jpegModePopup.selectItem(at: JPEGCaptionMode.saved.rawValue)
        jpegModePopup.target = self
        jpegModePopup.action = #selector(jpegModeChanged(_:))
        jpegModePopup.controlSize = .small
        jpegModePopup.toolTip = """
            XMP is read by Lightroom, Photo Mechanic, Photoshop and modern newsroom systems. \
            Legacy IPTC (IIM) is the older format some wire services and archives still require. \
            RAW files always get captions in their XMP sidecar.
            """
        stack.addArrangedSubview(jpegModePopup)

        help.font = .systemFont(ofSize: 10.5)
        help.textColor = .tertiaryLabelColor
        help.preferredMaxLayoutWidth = Self.width - 28
        stack.setCustomSpacing(10, after: jpegModePopup)
        stack.addArrangedSubview(help)

        let codes = NSButton(title: "Codes…", target: self, action: #selector(editCodes(_:)))
        codes.image = NSImage(systemSymbolName: "text.badge.plus", accessibilityDescription: nil)
        codes.imagePosition = .imageLeading
        codes.toolTip = "Manage lookup files and the code delimiter (⌘3)"
        codes.controlSize = .small
        let credits = NSButton(title: "Fill from Profile", target: self, action: #selector(fillFromProfile(_:)))
        credits.controlSize = .small
        credits.image = NSImage(systemSymbolName: "person.crop.circle", accessibilityDescription: nil)
        credits.imagePosition = .imageLeading
        credits.toolTip = "Fill Photographer, Credit and Copyright from your profile (⌥⌘P)"
        stack.setCustomSpacing(10, after: help)
        stack.addArrangedSubview(NSStackView(views: [codes, credits]))

        // Scrollable so short windows still reach every field.
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
        addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            doc.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            doc.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            doc.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            stack.topAnchor.constraint(equalTo: doc.topAnchor),
            stack.leadingAnchor.constraint(equalTo: doc.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: doc.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: doc.bottomAnchor),
        ])
        codeStatus.font = .systemFont(ofSize: 10.5)
        codeStatus.lineBreakMode = .byTruncatingTail
        codeStatus.preferredMaxLayoutWidth = Self.width - 28
        stack.setCustomSpacing(8, after: stack.arrangedSubviews.last!)
        stack.addArrangedSubview(codeStatus)
        NotificationCenter.default.addObserver(self, selector: #selector(codesChanged(_:)),
                                               name: CodeReplacements.didChange, object: nil)
        codesChanged(nil)
        show([])
    }

    /// The help text names the current delimiter, so it always matches what you should type.
    @objc private func codesChanged(_ note: Notification?) {
        let codes = CodeReplacements.shared
        let d = codes.delimiter
        let when = codes.expandsWhileTyping ? "as soon as you type the closing \(d)" : "when you leave the field"
        help.stringValue = "Type \(d)code\(d) for code replacements (\(d)code#2\(d) for another column) — it expands \(when). "
            + "Variables fill in per photo: \(CaptionVariables.all.joined(separator: " "))\n"
            + "Changes save when you leave a field. Esc or ⌘↩ returns to the photos."
        let n = codes.activeCodeCount
        let files = codes.activeLists.map(\.name)
        if n == 0 {
            codeStatus.stringValue = "No code replacements are on"
            codeStatus.textColor = .tertiaryLabelColor
        } else {
            codeStatus.stringValue = "● \(n) code\(n == 1 ? "" : "s") ready · " + files.joined(separator: ", ")
            codeStatus.textColor = HomeStyle.ready.withAlphaComponent(0.85)
        }
        codeStatus.toolTip = files.joined(separator: "\n")
    }

    private func label(_ s: String) -> NSTextField {
        let l = NSTextField(labelWithString: s.uppercased())
        l.font = .systemFont(ofSize: 9.5, weight: .semibold)
        l.textColor = NSColor(white: 0.55, alpha: 1)
        return l
    }

    @objc private func jpegModeChanged(_ sender: Any?) {
        jpegMode.save()
    }

    @objc private func editCodes(_ sender: Any?) { delegate?.captionPanelEditCodes() }

    @objc private func fillFromProfile(_ sender: Any?) { delegate?.captionPanelFillFromProfile() }

    var jpegMode: JPEGCaptionMode { JPEGCaptionMode(rawValue: jpegModePopup.indexOfSelectedItem) ?? .xmpAndIIM }

    // MARK: Display

    /// Shows the common values of `photos`; fields that differ read "Multiple values".
    func show(_ photos: [Photo]) {
        if editingField != nil, !committing, !Self.same(photos, editingTargets) { commitEditing() }
        shown = photos
        let enabled = !photos.isEmpty
        header.stringValue = "Caption"
        switch photos.count {
        case 0: subheader.stringValue = "Select photos to caption"
        case 1: subheader.stringValue = photos[0].displayName
        default: subheader.stringValue = "\(photos.count) photos — edits apply to all"
        }

        for f in IPTCField.allCases where f != editingField {
            let value: String
            let isMixed: Bool
            if f == .keywords {
                let sets = photos.map { Set($0.iptc.keywords.map { $0.lowercased() }) }
                let common = sets.dropFirst().reduce(sets.first ?? []) { $0.intersection($1) }
                let ordered = (photos.first?.iptc.keywords ?? []).filter { common.contains($0.lowercased()) }
                value = ordered.joined(separator: ", ")
                isMixed = sets.contains { $0 != common }
                keywordField.objectValue = ordered
                keywordField.isEnabled = enabled
            } else {
                let values = photos.map { $0.iptc[f] }
                let first = values.first ?? ""
                isMixed = !values.allSatisfy { $0 == first }
                value = isMixed ? "" : first
                if f == .caption {
                    if captionView.string != value { captionView.string = value }
                    captionView.isEditable = enabled
                } else {
                    controls[f]?.stringValue = value
                    controls[f]?.isEnabled = enabled
                }
            }
            original[f] = value
            if isMixed { mixed.insert(f) } else { mixed.remove(f) }
            let placeholder = isMixed ? "Multiple values" : ""
            if f == .keywords { keywordField.placeholderString = isMixed ? "Some photos have other keywords" : "Add keywords…" }
            else { controls[f]?.placeholderString = placeholder }
        }
    }

    private static func same(_ a: [Photo], _ b: [Photo]) -> Bool {
        a.count == b.count && zip(a, b).allSatisfy { $0 === $1 }
    }

    // MARK: Editing

    func focusCaption() {
        window?.makeFirstResponder(captionView)
        captionView.selectAll(nil)
    }

    var isEditing: Bool {
        guard let fr = window?.firstResponder as? NSView else { return false }
        return fr.isDescendant(of: self)
    }

    private func field(for object: Any?) -> IPTCField? {
        if let tv = object as? NSTextView, tv === captionView { return .caption }
        if let tf = object as? NSTextField {
            if tf === keywordField { return .keywords }
            return controls.first { $0.value === tf }?.key
        }
        return nil
    }

    private func currentValue(_ f: IPTCField) -> String {
        switch f {
        case .caption: return captionView.string
        case .keywords:
            let tokens = (keywordField.objectValue as? [Any])?.compactMap { $0 as? String } ?? []
            return tokens.joined(separator: ", ")
        default: return controls[f]?.stringValue ?? ""
        }
    }

    private func beginEditing(_ f: IPTCField) {
        guard editingField != f else { return }
        if editingField != nil { commitEditing() }
        editingField = f
        editingTargets = delegate?.captionTargets() ?? shown
    }

    /// Saves the field being edited to the photos it was opened for.
    func commitEditing() {
        guard let f = editingField, !committing else { return }
        committing = true
        defer { committing = false }
        editingField = nil
        let value = currentValue(f)
        let old = original[f] ?? ""
        guard value != old, !editingTargets.isEmpty else { return }
        var removed: [String] = []
        if f == .keywords {
            let new = Set(IPTCInfo.splitKeywords(value).map { $0.lowercased() })
            removed = IPTCInfo.splitKeywords(old).filter { !new.contains($0.lowercased()) }
        }
        delegate?.captionPanel(commit: f, value: value, removedKeywords: removed, to: editingTargets)
    }

    func controlTextDidBeginEditing(_ obj: Notification) {
        if let f = field(for: obj.object) { beginEditing(f) }
    }

    func controlTextDidEndEditing(_ obj: Notification) {
        if field(for: obj.object) == editingField { commitEditing() }
    }

    func textDidBeginEditing(_ notification: Notification) { beginEditing(.caption) }

    /// Code replacements expand the moment the closing delimiter is typed.
    func textDidChange(_ notification: Notification) {
        if (notification.object as? NSTextView) === captionView { LiveCodeExpansion.apply(to: captionView) }
    }

    func controlTextDidChange(_ obj: Notification) {
        if let editor = obj.userInfo?["NSFieldEditor"] as? NSTextView { LiveCodeExpansion.apply(to: editor) }
    }

    func textDidEndEditing(_ notification: Notification) {
        if editingField == .caption { commitEditing() }
    }

    /// In text views, Esc arrives as `complete:` (word completion), not `cancelOperation:`.
    private static func isEscape(_ selector: Selector) -> Bool {
        selector == #selector(NSResponder.cancelOperation(_:)) || selector == #selector(NSResponder.complete(_:))
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if Self.isEscape(selector) {
            delegate?.captionPanelWantsFocusBack()
            return true
        }
        return false
    }

    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        switch selector {
        case _ where Self.isEscape(selector):
            delegate?.captionPanelWantsFocusBack()
            return true
        case #selector(NSResponder.insertTab(_:)):
            window?.selectNextKeyView(nil)
            return true
        case #selector(NSResponder.insertBacktab(_:)):
            window?.selectPreviousKeyView(nil)
            return true
        default:
            return false
        }
    }
}

final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}
