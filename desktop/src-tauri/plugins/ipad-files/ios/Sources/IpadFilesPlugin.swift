// Files on iPad for Deadlyne. iPadOS only lets an app read what the photographer picked in the
// Files browser, so every shoot folder, memory card and document comes through these pickers.
// Each pick is opened in place (never copied) and remembered as a security-scoped bookmark, so it
// stays readable after Deadlyne relaunches. Quick Look and the share sheet stand in for Finder.

import QuickLook
import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

class PickFilesArgs: Decodable {
  let multiple: Bool?
}

class PathArgs: Decodable {
  let path: String
}

class PathsArgs: Decodable {
  let paths: [String]
}

class IpadFilesPlugin: Plugin, UIDocumentPickerDelegate, QLPreviewControllerDataSource {
  private let bookmarksKey = "deadlyneBookmarks"
  private var pending: Invoke?
  private var pickingFolder = false
  private var previewItem: URL?

  // MARK: - Bookmarks

  private func bookmarks() -> [String: Data] {
    UserDefaults.standard.dictionary(forKey: bookmarksKey) as? [String: Data] ?? [:]
  }

  private func saveBookmarks(_ all: [String: Data]) {
    UserDefaults.standard.set(all, forKey: bookmarksKey)
  }

  private func remember(_ url: URL) {
    guard let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else { return }
    var all = bookmarks()
    all[url.path] = data
    saveBookmarks(all)
  }

  /// Reopens everything picked before. Access lasts until Deadlyne quits.
  @objc public func restoreAccess(_ invoke: Invoke) {
    var restored: [[String: Any]] = []
    var all = bookmarks()
    for (saved, data) in all {
      var stale = false
      guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
        restored.append(["saved": saved, "current": NSNull()])
        continue
      }
      _ = url.startAccessingSecurityScopedResource()
      if stale || url.path != saved {
        // It moved or was renamed: keep a fresh bookmark under its new path.
        all.removeValue(forKey: saved)
        if let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
          all[url.path] = fresh
        }
      }
      restored.append(["saved": saved, "current": url.path])
    }
    saveBookmarks(all)
    invoke.resolve(["restored": restored])
  }

  // MARK: - Pickers

  @objc public func pickFolder(_ invoke: Invoke) {
    present(invoke, types: [UTType.folder], multiple: false, folder: true)
  }

  @objc public func pickFiles(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PickFilesArgs.self)
    present(invoke, types: [UTType.item], multiple: args.multiple ?? true, folder: false)
  }

  private func present(_ invoke: Invoke, types: [UTType], multiple: Bool, folder: Bool) {
    DispatchQueue.main.async {
      guard let host = self.manager.viewController else {
        invoke.reject("Deadlyne isn't ready to show the Files browser yet.")
        return
      }
      if let previous = self.pending {
        previous.reject("Another picker opened.")
      }
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
      picker.allowsMultipleSelection = multiple
      picker.shouldShowFileExtensions = true
      picker.delegate = self
      self.pending = invoke
      self.pickingFolder = folder
      host.present(picker, animated: true)
    }
  }

  public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = pending else { return }
    pending = nil
    for url in urls {
      _ = url.startAccessingSecurityScopedResource()
      remember(url)
    }
    if pickingFolder {
      invoke.resolve(["path": urls.first?.path])
    } else {
      invoke.resolve(["paths": urls.map { $0.path }])
    }
  }

  public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    guard let invoke = pending else { return }
    pending = nil
    invoke.resolve(pickingFolder ? ["path": nil] : ["paths": [String]()])
  }

  // MARK: - Quick Look and sharing

  @objc public func preview(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    DispatchQueue.main.async {
      guard let host = self.manager.viewController else {
        invoke.reject("Deadlyne isn't ready to preview yet.")
        return
      }
      self.previewItem = URL(fileURLWithPath: args.path)
      let ql = QLPreviewController()
      ql.dataSource = self
      host.present(ql, animated: true)
      invoke.resolve()
    }
  }

  public func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
    previewItem == nil ? 0 : 1
  }

  public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
    previewItem! as NSURL
  }

  @objc public func share(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathsArgs.self)
    DispatchQueue.main.async {
      guard let host = self.manager.viewController else {
        invoke.reject("Deadlyne isn't ready to share yet.")
        return
      }
      let items = args.paths.map { URL(fileURLWithPath: $0) }
      let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
      // iPad shows the sheet as a popover: anchor it at the top of the window.
      if let pop = sheet.popoverPresentationController {
        pop.sourceView = host.view
        pop.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.safeAreaInsets.top + 44, width: 1, height: 1)
        pop.permittedArrowDirections = [.up]
      }
      host.present(sheet, animated: true)
      invoke.resolve()
    }
  }
}

@_cdecl("init_plugin_ipad_files")
func initPlugin() -> Plugin {
  return IpadFilesPlugin()
}
