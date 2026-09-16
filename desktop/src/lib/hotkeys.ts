// Keyboard shortcuts — the same keys as the Mac app, so muscle memory carries over.
// ⌘ on macOS is Ctrl on Windows. Shortcuts with ⌥ use `e.code`, since ⌥ changes the typed character.
import { useEffect } from "react"
import { LABELS, type Label } from "@/lib/api"
import { askTrash, copyOrMove, openFolderDialog } from "@/lib/actions"
import { targetPhotos, useStore, visiblePhotos } from "@/store"
import { useUI } from "@/ui"

/** 6 red, 7 yellow, 8 green, 9 blue (Lightroom / Bridge convention). */
const LABEL_KEYS: Record<string, Label> = { "6": LABELS[0], "7": LABELS[1], "8": LABELS[2], "9": LABELS[3] }

function focusSearch() {
  useStore.getState().setWorkspace("photos")
  requestAnimationFrame(() => {
    const el = document.getElementById("photo-search") as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

export function useHotkeys() {
  useEffect(() => {
    let escapeHandled = false

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = !!target.closest("input, textarea, select, [contenteditable=true]")
      if (target.closest("[role=menu], [role=dialog], [role=alertdialog], [role=listbox]")) return
      const s = useStore.getState()
      const ui = useUI.getState()
      const cmd = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const photos = s.workspace === "photos" && !!s.folder

      // These work everywhere, even while typing in a field.
      if (cmd && !e.altKey && !e.shiftKey) {
        if (key === "o") return run(e, openFolderDialog)
        if (key === "1") return run(e, () => s.setWorkspace("home"))
        if (key === "2") return run(e, () => s.setWorkspace("photos"))
        if (key === "3") return run(e, () => s.setWorkspace("codes"))
        if (key === "f") return run(e, focusSearch)
        if (key === "i" && s.folder) return run(e, () => s.setCaptionPanel(!s.captionPanel))
      }
      if (cmd && e.shiftKey && e.code === "KeyI") return run(e, () => ui.open("ingest"))
      if (typing) return

      if (cmd && e.key === "Enter" && photos) return run(e, s.focusCaption)
      if (!photos) return

      if (cmd && e.altKey) {
        if (e.code === "Digit1") return run(e, () => s.setFilter({ tagFilter: "all" }))
        if (e.code === "Digit2") return run(e, () => s.setFilter({ tagFilter: "tagged" }))
        if (e.code === "Digit3") return run(e, () => s.setFilter({ tagFilter: "untagged" }))
        if (e.code === "Digit4") return run(e, () => s.setFilter({ fileScope: "both" }))
        if (e.code === "Digit5") return run(e, () => s.setFilter({ fileScope: "raw" }))
        if (e.code === "Digit6") return run(e, () => s.setFilter({ fileScope: "jpeg" }))
        if (e.code === "KeyC") return run(e, s.copyCaptions)
        if (e.code === "KeyV") return run(e, s.pasteCaptions)
        if (e.code === "KeyP") return run(e, () => s.fillCredits() || ui.open("profile"))
      }
      if (cmd && e.shiftKey) {
        if (e.code === "KeyC") return run(e, () => copyOrMove("tagged", false))
        if (e.code === "KeyM") return run(e, () => copyOrMove("tagged", true))
        if (e.code === "KeyT") return run(e, s.selectTagged)
        if (e.code === "KeyU") return run(e, () => ui.openSend("tagged"))
      }
      if (cmd && (e.key === "Backspace" || e.key === "Delete")) return run(e, askTrash)
      if (cmd && key === "a") return run(e, s.selectAll)
      if (cmd && (e.key === "=" || e.key === "+")) return run(e, () => s.setThumbSize(s.thumbSize * 1.15))
      if (cmd && e.key === "-") return run(e, () => s.setThumbSize(s.thumbSize / 1.15))
      if (cmd || e.altKey) return

      // Culling
      if (key === "t") {
        const targets = targetPhotos(s)
        return run(e, () => s.cull(() => ({ tagged: !targets.every((p) => p.tagged) })))
      }
      if (/^[0-5]$/.test(e.key)) return run(e, () => s.cull(() => ({ rating: Number(e.key) })))
      if (LABEL_KEYS[e.key]) {
        const label = LABEL_KEYS[e.key]
        const targets = targetPhotos(s)
        return run(e, () => s.cull(() => ({ label: targets.every((p) => p.label === label) ? null : label })))
      }

      // Moving around
      const step = s.loupe ? 1 : s.columns
      switch (e.key) {
        case "ArrowLeft": return run(e, () => s.move(-1, e.shiftKey && !s.loupe))
        case "ArrowRight": return run(e, () => s.move(1, e.shiftKey && !s.loupe))
        case "ArrowUp": return run(e, () => s.move(-step, e.shiftKey && !s.loupe))
        case "ArrowDown": return run(e, () => s.move(step, e.shiftKey && !s.loupe))
        case "Home": return run(e, () => s.move(-Infinity))
        case "End": return run(e, () => s.move(visiblePhotos(s).length))
        case " ":
        case "Enter": return run(e, () => s.setLoupe(!s.loupe))
        case "Escape":
          escapeHandled = true
          if (s.loupe) return run(e, () => s.setLoupe(false))
      }
    }

    // Fallback for when Escape's keydown never reaches the page (some macOS setups swallow it).
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const handled = escapeHandled
      escapeHandled = false
      if (handled || (e.target as HTMLElement).closest("input, textarea, [role=menu], [role=dialog]")) return
      const s = useStore.getState()
      if (s.workspace === "photos" && s.loupe) run(e, () => s.setLoupe(false))
    }

    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [])
}

function run(e: KeyboardEvent, fn: () => unknown) {
  e.preventDefault()
  fn()
}
