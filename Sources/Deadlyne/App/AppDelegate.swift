import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private let root = RootViewController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        NSApp.mainMenu = buildMenu()

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Deadlyne"
        // The title bar holds the workspace tabs (Home · Photos · Codes), Affinity-style.
        let toolbar = NSToolbar(identifier: "DeadlyneMainToolbar")
        toolbar.delegate = root
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        _ = root.view
        window.toolbar = toolbar
        window.toolbarStyle = .unified
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 680, height: 480)
        // The content lives inside a plain autoresized container rather than being the
        // window's contentViewController. Otherwise Auto Layout reaches the window itself
        // and sizes it to the content's fitting width — which snapped the window back to
        // the width of its widest row on every layout pass, no matter how big the display.
        let container = NSView()
        container.autoresizesSubviews = true
        window.contentView = container
        root.view.translatesAutoresizingMaskIntoConstraints = true
        root.view.frame = container.bounds
        root.view.autoresizingMask = [.width, .height]
        container.addSubview(root.view)
        // The view controller is spliced into the responder chain by hand, since the
        // window no longer does it, so menu commands still reach the browser.
        root.view.nextResponder = root
        root.nextResponder = window
        let target = restoreFrame()
        window.delegate = self
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(saveFrame), name: NSWindow.didResizeNotification, object: window)
        nc.addObserver(self, selector: #selector(saveFrame), name: NSWindow.didMoveNotification, object: window)
        window.tabbingMode = .disallowed
        window.makeKeyAndOrderFront(nil)
        if let target { window.setFrame(target, display: true) }
        // AppKit snaps a brand-new window to its content's fitting size the first time it
        // is shown, so put the frame we actually asked for back.
        if let target, window.frame != target { window.setFrame(target, display: true) }
        NSApp.activate(ignoringOtherApps: true)

        // The app always lands on the home screen, unless it was launched with a folder to open.
        let args = CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-") }
        if let path = args.first {
            root.openFolder(URL(fileURLWithPath: path))
        }
        root.focusCurrentScreen()
    }

    // MARK: Window size

    /// Window frames are remembered per display, so a 32" external monitor gets a window
    /// sized for it rather than the one that fit the laptop screen.
    private func frameKey(for screen: NSScreen) -> String {
        let f = screen.frame
        return "windowFrame.\(Int(f.width))x\(Int(f.height))"
    }

    private static let lastScreenKey = "windowLastScreen"

    private func screen(forKey key: String) -> NSScreen? {
        NSScreen.screens.first { frameKey(for: $0) == key }
    }

    @discardableResult
    private func restoreFrame() -> NSRect? {
        // Reopen on the display the window was last used on, if it is still attached.
        let last = UserDefaults.standard.string(forKey: Self.lastScreenKey).flatMap(screen(forKey:))
        guard let screen = last ?? NSScreen.main ?? NSScreen.screens.first else {
            window.setContentSize(NSSize(width: 1440, height: 900))
            window.center()
            return nil
        }
        let target = frame(for: screen)
        window.setFrame(target, display: false)
        return target
    }

    /// The size the window had on this display, or most of the display if it has never
    /// been opened there.
    private func frame(for screen: NSScreen) -> NSRect {
        if let saved = UserDefaults.standard.string(forKey: frameKey(for: screen)) {
            let f = NSRectFromString(saved)
            if !f.isEmpty, screen.visibleFrame.intersects(f) { return f }
        }
        let visible = screen.visibleFrame
        let w = max(window.minSize.width, visible.width * 0.92)
        let h = max(window.minSize.height, visible.height * 0.94)
        return NSRect(x: visible.midX - w / 2, y: visible.midY - h / 2, width: w, height: h).integral
    }

    /// Zoom — double-click the title bar, or ⌥-click the green button — fills the display.
    func windowWillUseStandardFrame(_ window: NSWindow, defaultFrame: NSRect) -> NSRect {
        window.screen?.visibleFrame ?? defaultFrame
    }

    /// Dragged onto a display it has never been opened on: size it for that display
    /// instead of keeping a width meant for a smaller screen.
    func windowDidChangeScreen(_ notification: Notification) {
        guard let screen = window.screen, UserDefaults.standard.string(forKey: frameKey(for: screen)) == nil else { return }
        // Wait for the drag to finish, so the window doesn't resize under the pointer.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            guard let self, NSEvent.pressedMouseButtons == 0,
                  let screen = self.window.screen,
                  UserDefaults.standard.string(forKey: self.frameKey(for: screen)) == nil else { return }
            self.window.setFrame(self.frame(for: screen), display: true, animate: true)
            self.saveFrame()
        }
    }

    @objc private func saveFrame() {
        guard let screen = window.screen, window.isVisible, !window.isZoomed else { return }
        let d = UserDefaults.standard
        d.set(NSStringFromRect(window.frame), forKey: frameKey(for: screen))
        d.set(frameKey(for: screen), forKey: Self.lastScreenKey)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        root.browser.recordShootStats()
    }

    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        var isDir: ObjCBool = false
        FileManager.default.fileExists(atPath: filename, isDirectory: &isDir)
        let url = URL(fileURLWithPath: filename)
        root.openFolder(isDir.boolValue ? url : url.deletingLastPathComponent())
        return true
    }

    // MARK: Menu

    private func buildMenu() -> NSMenu {
        let main = NSMenu()

        func menu(_ title: String, _ items: [NSMenuItem]) {
            let m = NSMenu(title: title)
            items.forEach(m.addItem)
            main.addItem(withTitle: title, action: nil, keyEquivalent: "").submenu = m
        }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command], tag: Int = 0) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.tag = tag
            return i
        }
        let sep = { NSMenuItem.separator() }
        let B = BrowserViewController.self
        let R = RootViewController.self

        menu("Deadlyne", [
            item("About Deadlyne", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            sep(),
            item("Profile…", #selector(R.showProfile(_:)), ","),
            item("Achievements…", #selector(R.showAchievements(_:))),
            sep(),
            item("Hide Deadlyne", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
            sep(),
            item("Quit Deadlyne", #selector(NSApplication.terminate(_:)), "q"),
        ])

        let recent = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
        let recentMenu = NSMenu(title: "Open Recent")
        recentMenu.perform(NSSelectorFromString("_setMenuName:"), with: "NSRecentDocumentsMenu")
        recentMenu.addItem(item("Clear Menu", #selector(NSDocumentController.clearRecentDocuments(_:))))
        recent.submenu = recentMenu

        menu("File", [
            item("Open Folder…", #selector(B.openFolderPanel(_:)), "o"),
            recent,
            item("Ingest from Card…", #selector(B.showIngest(_:)), "i", [.command, .shift]),
            sep(),
            item("Copy Tagged Photos To…", #selector(B.copyTagged(_:)), "c", [.command, .shift]),
            item("Move Tagged Photos To…", #selector(B.moveTagged(_:)), "m", [.command, .shift]),
            item("Copy Selected To…", #selector(B.copySelected(_:))),
            item("Move Selected To…", #selector(B.moveSelected(_:))),
            sep(),
            item("Reveal in Finder", #selector(B.revealInFinder(_:)), "r", [.command, .shift]),
            item("Open in Default App", #selector(B.openInDefaultApp(_:)), "e"),
            sep(),
            item("Move to Trash", #selector(B.trashSelected(_:)), "\u{8}"),
            sep(),
            item("Close Window", #selector(NSWindow.performClose(_:)), "w"),
        ])

        menu("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            sep(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSResponder.selectAll(_:)), "a"),
            sep(),
            item("Select Tagged", #selector(B.selectTagged(_:)), "t", [.command, .shift]),
            item("Deselect All", #selector(NSCollectionView.deselectAll(_:)), "d"),
            sep(),
            item("Find…", #selector(B.focusSearch(_:)), "f"),
        ])

        menu("Caption", [
            item("Show Caption Panel", #selector(B.toggleCaptionPanel(_:)), "i"),
            item("Edit Caption", #selector(B.editCaption(_:)), "\r"),
            sep(),
            item("Copy Caption Info", #selector(B.copyCaption(_:)), "c", [.command, .option]),
            item("Paste Caption Info", #selector(B.pasteCaption(_:)), "v", [.command, .option]),
            item("Fill Credits from Profile", #selector(B.fillCreditsFromProfile(_:)), "p", [.command, .option]),
            sep(),
            item("Code Replacements…", #selector(B.editCodeReplacements(_:))),
        ])

        var cull: [NSMenuItem] = [item("Toggle Tag", #selector(B.toggleTagMenu(_:)), "t", [])]
        cull.append(sep())
        for n in 0...5 {
            cull.append(item(n == 0 ? "No Rating" : "Rate " + String(repeating: "★", count: n),
                             #selector(B.setRatingMenu(_:)), "\(n)", [], tag: n))
        }
        cull.append(sep())
        for (n, label) in ColorLabel.allCases.enumerated() {
            let key = n < 4 ? "\(n + 6)" : ""
            cull.append(item("\(label.rawValue) Label", #selector(B.setLabelMenu(_:)), key, [], tag: n + 1))
        }
        cull.append(item("No Label", #selector(B.setLabelMenu(_:)), tag: 0))
        cull.append(sep())
        cull.append(item("Auto-Advance After Rating", #selector(B.toggleAutoAdvance(_:)), "a", [.command, .shift]))
        menu("Cull", cull)

        let files = NSMenuItem(title: "Files", action: nil, keyEquivalent: "")
        let filesMenu = NSMenu(title: "Files")
        for scope in FileScope.allCases {
            filesMenu.addItem(item(scope.title, #selector(B.setFileScope(_:)), "\(scope.rawValue + 4)", [.command, .option], tag: scope.rawValue))
        }
        files.submenu = filesMenu

        menu("View", Workspace.allCases.map {
            item($0 == .codes ? "Code Replacements" : $0.title, #selector(R.showWorkspace(_:)), "\($0.rawValue + 1)", tag: $0.rawValue)
        } + [
            sep(),
            item("Home", #selector(R.toggleHome(_:)), "h", [.command, .shift]),
            sep(),
            item("Preview", #selector(B.togglePreview(_:)), " ", []),
            item("Zoom to 100%", #selector(B.toggleZoom(_:)), "z", []),
            sep(),
            files,
            sep(),
            item("Show All Photos", #selector(B.showAll(_:)), "1", [.command, .option]),
            item("Show Tagged", #selector(B.showTagged(_:)), "2", [.command, .option]),
            item("Show Untagged", #selector(B.showUntagged(_:)), "3", [.command, .option]),
            sep(),
            item("Larger Thumbnails", #selector(B.biggerThumbnails(_:)), "="),
            item("Smaller Thumbnails", #selector(B.smallerThumbnails(_:)), "-"),
            sep(),
            item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])

        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
        windowMenu.addItem(item("Zoom", #selector(NSWindow.performZoom(_:))))
        main.addItem(withTitle: "Window", action: nil, keyEquivalent: "").submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        return main
    }
}
