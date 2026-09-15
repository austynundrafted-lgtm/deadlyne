import AppKit

/// Hosts the workspaces — Home, the photo browser and Code Replacements — in the main window,
/// switched from the tab bar in the title bar. Every workspace stays loaded while another shows,
/// so going back to the photos keeps the selection and is instant.
final class RootViewController: NSViewController {
    let home = HomeViewController()
    let browser = BrowserViewController()
    let codes = CodesViewController()
    let tabBar = WorkspaceTabBar()
    private(set) var workspace = Workspace.home
    var showingHome: Bool { workspace == .home }
    private var profileEditor: ProfileWindowController?

    override func loadView() {
        view = NSView()
        for child in [browser, codes, home] as [NSViewController] {
            addChild(child)
            child.view.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(child.view)
            NSLayoutConstraint.activate([
                child.view.topAnchor.constraint(equalTo: view.topAnchor),
                child.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                child.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                child.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            ])
        }
        browser.view.isHidden = true
        codes.view.isHidden = true
        home.delegate = self
        browser.onFolderOpened = { [weak self] _ in self?.show(.photos) }
        browser.onGoHome = { [weak self] in self?.show(.home) }
        browser.onWantsProfile = { [weak self] in self?.showProfile(nil) }
        browser.onWantsCodes = { [weak self] in self?.show(.codes) }
        tabBar.onSelect = { [weak self] w in self?.show(w) }
        NotificationCenter.default.addObserver(self, selector: #selector(badgesUnlocked(_:)),
                                               name: Achievements.didUnlock, object: nil)
    }

    /// Opens a shoot. If the browser already has it loaded, just switches back to it.
    func openFolder(_ url: URL) {
        if browser.folder?.standardizedFileURL.path == url.standardizedFileURL.path {
            show(.photos)
        } else {
            browser.openFolder(url)
        }
    }

    func showHome() { show(.home) }
    func showBrowser() { show(.photos) }

    func show(_ target: Workspace) {
        guard target != workspace else {
            focusCurrentScreen()
            return
        }
        switch workspace {
        case .photos: browser.prepareToLeave()
        case .codes: codes.prepareToLeave()
        case .home: break
        }
        workspace = target
        tabBar.selection = target
        if target == .home { home.refresh() }
        home.view.isHidden = target != .home
        browser.view.isHidden = target != .photos
        codes.view.isHidden = target != .codes
        focusCurrentScreen()
    }

    /// Gives keyboard focus to the visible screen, so browser shortcuts never act on a hidden grid.
    func focusCurrentScreen() {
        switch workspace {
        case .home:
            view.window?.title = "Deadlyne"
            view.window?.representedURL = nil
            view.window?.makeFirstResponder(home.view)
        case .photos:
            browser.didBecomeVisible()
        case .codes:
            view.window?.title = "Code Replacements"
            view.window?.representedURL = nil
            codes.didBecomeVisible()
        }
    }

    // MARK: Actions (reachable from the home screen through the responder chain)

    @objc func toggleHome(_ sender: Any?) {
        if showingHome {
            if browser.folder != nil { show(.photos) }
        } else {
            show(.home)
        }
    }

    @objc func showWorkspace(_ sender: NSMenuItem) {
        if let w = Workspace(rawValue: sender.tag) { show(w) }
    }

    @objc func openFolderPanel(_ sender: Any?) { browser.openFolderPanel(sender) }
    @objc func showIngest(_ sender: Any?) { browser.showIngest(sender) }
    @objc func editCodeReplacements(_ sender: Any?) { show(.codes) }

    @objc func showProfile(_ sender: Any?) {
        guard let window = view.window else { return }
        if let editor = profileEditor {
            editor.window?.makeKeyAndOrderFront(nil)
            return
        }
        let editor = ProfileWindowController()
        editor.onClose = { [weak self] in self?.profileEditor = nil }
        profileEditor = editor
        editor.present(on: window)
    }

    @objc func showAchievements(_ sender: Any?) {
        if achievementsWindow == nil { achievementsWindow = AchievementsWindowController() }
        achievementsWindow?.showWindow(nil)
    }

    // MARK: Badge unlocks

    private var achievementsWindow: AchievementsWindowController?
    private var banner: UnlockBanner?

    @objc private func badgesUnlocked(_ note: Notification) {
        guard let badges = note.object as? [Badge], !badges.isEmpty else { return }
        hideBanner(animated: false)
        let b = UnlockBanner(badges: badges)
        b.onClick = { [weak self] in
            self?.hideBanner(animated: true)
            self?.showAchievements(nil)
        }
        b.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(b) // above both screens
        NSLayoutConstraint.activate([
            b.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            b.topAnchor.constraint(equalTo: view.topAnchor, constant: 58),
        ])
        banner = b
        b.alphaValue = 0
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.25
            b.animator().alphaValue = 1
        }
        NSSound(named: "Glass")?.play()
        NSAccessibility.post(element: b, notification: .announcementRequested,
                             userInfo: [.announcement: b.announcement, .priority: NSAccessibilityPriorityLevel.high.rawValue])
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self, weak b] in
            guard let self, let b, self.banner === b else { return }
            self.hideBanner(animated: true)
        }
    }

    private func hideBanner(animated: Bool) {
        guard let b = banner else { return }
        banner = nil
        guard animated else { b.removeFromSuperview(); return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.3
            b.animator().alphaValue = 0
        }, completionHandler: { b.removeFromSuperview() })
    }
}

extension RootViewController: NSMenuItemValidation {
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(showWorkspace(_:)) {
            item.state = item.tag == workspace.rawValue ? .on : .off
            return true
        }
        if item.action == #selector(toggleHome(_:)) {
            item.title = showingHome ? "Back to Photos" : "Back to Home"
            return !showingHome || browser.folder != nil
        }
        return true
    }
}

extension RootViewController: NSToolbarDelegate {
    static let tabsItem = NSToolbarItem.Identifier("DeadlyneWorkspaceTabs")

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [Self.tabsItem, .flexibleSpace] }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [Self.tabsItem, .flexibleSpace] }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        guard id == Self.tabsItem else { return nil }
        let item = NSToolbarItem(itemIdentifier: id)
        item.label = "Workspace"
        item.view = tabBar
        return item
    }
}

extension RootViewController: HomeViewControllerDelegate {
    func homeIngest(from card: URL?) { browser.showIngest(from: card) }
    func homeOpenFolderPanel() { browser.openFolderPanel(nil) }
    func homeOpen(_ url: URL) { openFolder(url) }
    func homeEditProfile() { showProfile(nil) }
    func homeShowAchievements() { showAchievements(nil) }
}
