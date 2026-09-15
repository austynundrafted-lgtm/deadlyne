import AppKit
import UniformTypeIdentifiers

/// Creates or edits the optional photographer profile (shown as a sheet). Local only.
final class ProfileWindowController: NSWindowController, NSTextFieldDelegate {
    var onClose: (() -> Void)?

    private let existing = Profile.current
    private let avatarView = AvatarView()
    private var avatarImage: NSImage?
    private var avatarChanged = false
    private let nameField = NSTextField()
    private let creditField = NSTextField()
    private let copyrightField = NSTextField()
    private let emailField = NSTextField()
    private let websiteField = NSTextField()
    private let preview = NSTextField(labelWithString: "")
    private let removePhotoButton = NSButton(title: "Remove", target: nil, action: nil)
    private let saveButton = NSButton(title: "Save Profile", target: nil, action: nil)

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 500), styleMask: [.titled],
                              backing: .buffered, defer: false)
        super.init(window: window)
        avatarImage = existing == nil ? nil : Profile.avatar
        build()
        if let p = existing {
            nameField.stringValue = p.name
            creditField.stringValue = p.creditLine
            copyrightField.stringValue = p.copyright
            emailField.stringValue = p.email
            websiteField.stringValue = p.website
        } else {
            copyrightField.stringValue = Profile.defaultCopyright
        }
        update()
    }

    required init?(coder: NSCoder) { fatalError() }

    func present(on parent: NSWindow) {
        guard let window else { return }
        parent.beginSheet(window) { [weak self] _ in self?.onClose?() }
        window.makeFirstResponder(nameField)
    }

    // MARK: UI

    private func label(_ s: String) -> NSTextField {
        let l = NSTextField(labelWithString: s)
        l.alignment = .right
        l.textColor = .secondaryLabelColor
        return l
    }

    private func build() {
        guard let content = window?.contentView else { return }

        avatarView.onClick = { [weak self] in self?.choosePhoto(nil) }
        avatarView.onImageDropped = { [weak self] img in self?.setAvatar(img) }
        avatarView.toolTip = "Click or drop an image"
        avatarView.translatesAutoresizingMaskIntoConstraints = false
        avatarView.widthAnchor.constraint(equalToConstant: 84).isActive = true
        avatarView.heightAnchor.constraint(equalToConstant: 84).isActive = true

        let title = NSTextField(labelWithString: existing == nil ? "Create Your Profile" : "Your Profile")
        title.font = .systemFont(ofSize: 18, weight: .semibold)
        let sub = NSTextField(wrappingLabelWithString:
            "Optional — Deadlyne works the same without one. Your profile stays on this Mac: no account, nothing is uploaded.")
        sub.font = .systemFont(ofSize: 12)
        sub.textColor = .secondaryLabelColor
        sub.preferredMaxLayoutWidth = 370
        let choose = NSButton(title: "Choose Photo…", target: self, action: #selector(choosePhoto(_:)))
        removePhotoButton.target = self
        removePhotoButton.action = #selector(removePhoto(_:))
        for b in [choose, removePhotoButton] { b.controlSize = .small }
        let photoButtons = NSStackView(views: [choose, removePhotoButton])
        photoButtons.spacing = 6
        let headerText = NSStackView(views: [title, sub, photoButtons])
        headerText.orientation = .vertical
        headerText.alignment = .leading
        headerText.spacing = 5
        headerText.setCustomSpacing(10, after: sub)
        let header = NSStackView(views: [avatarView, headerText])
        header.spacing = 18
        header.alignment = .centerY

        nameField.placeholderString = "Your name (required)"
        creditField.placeholderString = "e.g. your business or publication"
        copyrightField.placeholderString = Profile.defaultCopyright
        emailField.placeholderString = "you@example.com"
        websiteField.placeholderString = "yoursite.com"
        for f in [nameField, creditField, copyrightField, emailField, websiteField] { f.delegate = self }
        let copyrightHelp = NSTextField(labelWithString: "{year} becomes each photo’s capture year; {name} your name.")
        copyrightHelp.font = .systemFont(ofSize: 11)
        copyrightHelp.textColor = .tertiaryLabelColor

        let grid = NSGridView(views: [
            [label("Name:"), nameField],
            [label("Credit line:"), creditField],
            [label("Copyright:"), copyrightField],
            [NSGridCell.emptyContentView, copyrightHelp],
            [label("Email:"), emailField],
            [label("Website:"), websiteField],
        ])
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 1).width = 380
        grid.rowSpacing = 9
        grid.columnSpacing = 10
        grid.row(at: 3).topPadding = -3
        grid.row(at: 0).yPlacement = .center

        let previewTitle = NSTextField(labelWithString: "CAPTION → FILL CREDITS FROM PROFILE (⌥⌘P) WRITES")
        previewTitle.font = .systemFont(ofSize: 9.5, weight: .semibold)
        previewTitle.textColor = .tertiaryLabelColor
        preview.font = .systemFont(ofSize: 12)
        preview.textColor = .secondaryLabelColor
        preview.maximumNumberOfLines = 3
        preview.lineBreakMode = .byTruncatingTail
        let previewStack = NSStackView(views: [previewTitle, preview])
        previewStack.orientation = .vertical
        previewStack.alignment = .leading
        previewStack.spacing = 5
        let previewBox = NSBox()
        previewBox.boxType = .custom
        previewBox.cornerRadius = 8
        previewBox.fillColor = NSColor(white: 1, alpha: 0.04)
        previewBox.borderColor = NSColor(white: 1, alpha: 0.1)
        previewBox.contentViewMargins = NSSize(width: 12, height: 10)
        previewBox.contentView = previewStack

        let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancel(_:)))
        cancel.keyEquivalent = "\u{1b}"
        saveButton.target = self
        saveButton.action = #selector(save(_:))
        saveButton.keyEquivalent = "\r"
        let buttons = NSStackView()
        if existing != nil {
            let delete = NSButton(title: "Delete Profile…", target: self, action: #selector(deleteProfile(_:)))
            buttons.addView(delete, in: .leading)
        }
        buttons.addView(cancel, in: .trailing)
        buttons.addView(saveButton, in: .trailing)

        let stack = NSStackView(views: [header, grid, previewBox, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 20
        stack.edgeInsets = NSEdgeInsets(top: 24, left: 24, bottom: 20, right: 24)
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            previewBox.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -48),
            buttons.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -48),
        ])
    }

    private var draft: Profile {
        var p = Profile()
        p.name = nameField.stringValue.trimmingCharacters(in: .whitespaces)
        p.creditLine = creditField.stringValue.trimmingCharacters(in: .whitespaces)
        let c = copyrightField.stringValue.trimmingCharacters(in: .whitespaces)
        p.copyright = c.isEmpty ? Profile.defaultCopyright : c
        p.email = emailField.stringValue.trimmingCharacters(in: .whitespaces)
        p.website = websiteField.stringValue.trimmingCharacters(in: .whitespaces)
        return p
    }

    private func update() {
        let p = draft
        avatarView.profile = p
        avatarView.image = avatarImage
        removePhotoButton.isEnabled = avatarImage != nil
        saveButton.isEnabled = !p.name.isEmpty
        let fields = p.captionFields(captureDate: nil)
        preview.stringValue = [IPTCField.creator, .credit, .copyright]
            .map { "\($0.label):  \(fields[$0] ?? "—")" }
            .joined(separator: "\n")
    }

    func controlTextDidChange(_ obj: Notification) { update() }

    // MARK: Actions

    private func setAvatar(_ image: NSImage?) {
        avatarImage = image
        avatarChanged = true
        update()
    }

    @objc private func choosePhoto(_ sender: Any?) {
        guard let window else { return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.message = "Choose a profile photo"
        panel.beginSheetModal(for: window) { resp in
            guard resp == .OK, let url = panel.url, let img = NSImage(contentsOf: url) else { return }
            self.setAvatar(img)
        }
    }

    @objc private func removePhoto(_ sender: Any?) { setAvatar(nil) }

    @objc private func save(_ sender: Any?) {
        let p = draft
        guard !p.name.isEmpty else {
            NSSound.beep()
            window?.makeFirstResponder(nameField)
            return
        }
        if avatarChanged { Profile.saveAvatar(avatarImage) }
        Profile.current = p
        dismiss()
    }

    @objc private func cancel(_ sender: Any?) { dismiss() }

    @objc private func deleteProfile(_ sender: Any?) {
        guard let window else { return }
        let a = NSAlert()
        a.messageText = "Delete your profile?"
        a.informativeText = "Your name, credit line, copyright and photo are removed from Deadlyne. "
            + "Captions already written to your photos aren’t changed."
        a.addButton(withTitle: "Delete Profile")
        a.addButton(withTitle: "Cancel")
        a.buttons.first?.hasDestructiveAction = true
        a.beginSheetModal(for: window) { resp in
            guard resp == .alertFirstButtonReturn else { return }
            Profile.current = nil
            self.dismiss()
        }
    }

    private func dismiss() {
        guard let window else { return }
        if let parent = window.sheetParent { parent.endSheet(window) } else { window.close() }
    }
}
