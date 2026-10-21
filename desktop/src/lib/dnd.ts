// Dragging shoots and collections around the library (onto a collection, Favorites, Archive…).
// Pointer events rather than HTML drag and drop, because the window already takes file drops from
// Finder, and so the drag looks the same on macOS and Windows. Nothing here touches the disk:
// every drop is a change to the virtual library.
import { useEffect } from "react"
import { create } from "zustand"

export type DragItem =
  | { kind: "shoot"; path: string; label: string; from?: string }
  | { kind: "collection"; id: string; label: string }

interface DropTarget {
  accepts: (item: DragItem) => boolean
  drop: (item: DragItem) => void
}

interface DndState {
  item: DragItem | null
  x: number
  y: number
  /** The drop target under the pointer that accepts the item. */
  over: string | null
}

export const useDnd = create<DndState>(() => ({ item: null, x: 0, y: 0, over: null }))

const targets = new Map<string, DropTarget>()

/** Registers a drop target. Spread `{ "data-drop-id": id }` on its element. */
export function useDropTarget(id: string, target: DropTarget) {
  useEffect(() => {
    if (!id) return
    targets.set(id, target)
    return () => {
      if (targets.get(id) === target) targets.delete(id)
    }
  })
  return useDnd((s) => (!id ? null : s.over === id ? "over" : s.item && target.accepts(s.item) ? "can" : null))
}

function targetAt(x: number, y: number, item: DragItem): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-id]")
  const id = el?.dataset.dropId
  return id && targets.get(id)?.accepts(item) ? id : null
}

/** Pointer-down handler that starts a drag after the pointer moves a few pixels. */
export function dragSource(getItem: () => DragItem) {
  return (e: React.PointerEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
    const start = { x: e.clientX, y: e.clientY }
    let item: DragItem | null = null

    const move = (ev: PointerEvent) => {
      if (!item) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return
        item = getItem()
        document.body.style.cursor = "grabbing"
      }
      useDnd.setState({ item, x: ev.clientX, y: ev.clientY, over: targetAt(ev.clientX, ev.clientY, item) })
    }
    const end = (ev: PointerEvent | KeyboardEvent) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("keydown", cancel, true)
      document.body.style.cursor = ""
      if (!item) return
      const cancelled = ev instanceof KeyboardEvent
      const over = cancelled ? null : useDnd.getState().over
      useDnd.setState({ item: null, over: null })
      // The click that ends a drag shouldn't also open what was under the pointer.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation()
        c.preventDefault()
      }
      window.addEventListener("click", swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener("click", swallow, true), 0)
      if (over) targets.get(over)?.drop(item)
    }
    const cancel = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !item) return
      ev.stopPropagation()
      end(ev)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("keydown", cancel, true)
  }
}
