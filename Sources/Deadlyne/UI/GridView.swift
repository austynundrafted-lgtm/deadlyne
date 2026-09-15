import AppKit

protocol GridViewHandler: AnyObject {
    /// Return true if the key was consumed.
    func grid(_ grid: GridView, handleKey event: NSEvent) -> Bool
    func grid(_ grid: GridView, doubleClickedItemAt index: Int)
    func gridMenu(_ grid: GridView, for index: Int?) -> NSMenu?
}

/// NSCollectionView with Photo Mechanic–style single-key culling shortcuts.
final class GridView: NSCollectionView {
    weak var handler: GridViewHandler?

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        if handler?.grid(self, handleKey: event) == true { return }
        super.keyDown(with: event)
    }

    /// Where a shift-click range starts: the last photo clicked without Shift.
    private var anchorItem: Int?
    /// The selection when the anchor was set; shift-click ranges are added on top of it.
    private var baseSelection: Set<IndexPath> = []

    override func mouseDown(with event: NSEvent) {
        let pt = convert(event.locationInWindow, from: nil)
        let ip = indexPathForItem(at: pt)
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags.contains(.shift), !flags.contains(.command), event.clickCount == 1, let ip {
            window?.makeFirstResponder(self)
            extendSelection(to: ip)
            return
        }
        super.mouseDown(with: event)
        if let ip {
            anchorItem = ip.item
            baseSelection = selectionIndexPaths.subtracting([ip])
        }
        if event.clickCount == 2, let ip { handler?.grid(self, doubleClickedItemAt: ip.item) }
    }

    /// Selects every photo between the anchor and `ip`, keeping what was selected before the anchor click.
    private func extendSelection(to ip: IndexPath) {
        let count = numberOfItems(inSection: 0)
        guard ip.item < count else { return }
        let old = selectionIndexPaths
        // The anchor goes stale if the selection changed some other way (arrow keys, filters, select all).
        if anchorItem == nil || !old.contains(IndexPath(item: anchorItem!, section: 0)) || anchorItem! >= count {
            anchorItem = old.map(\.item).min() ?? ip.item
            baseSelection = old
        }
        let a = anchorItem!
        let range = Set((min(a, ip.item)...max(a, ip.item)).map { IndexPath(item: $0, section: 0) })
        let new = baseSelection.filter { $0.item < count }.union(range)
        selectionIndexPaths = new
        let removed = old.subtracting(new), added = new.subtracting(old)
        if !removed.isEmpty { delegate?.collectionView?(self, didDeselectItemsAt: removed) }
        if !added.isEmpty { delegate?.collectionView?(self, didSelectItemsAt: added) }
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let pt = convert(event.locationInWindow, from: nil)
        let ip = indexPathForItem(at: pt)
        if let ip, !selectionIndexPaths.contains(ip) {
            selectionIndexPaths = [ip]
            delegate?.collectionView?(self, didSelectItemsAt: [ip])
        }
        return handler?.gridMenu(self, for: ip?.item)
    }
}
