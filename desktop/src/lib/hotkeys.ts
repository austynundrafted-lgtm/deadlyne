// Keyboard shortcuts — the same keys as the Mac app, so muscle memory carries over.
// ⌘ on macOS is Ctrl on Windows. Shortcuts with ⌥ use `e.code`, since ⌥ changes the typed character.
// On macOS the menu bar shows the same keys (src-tauri/src/native.rs): a key handled here never
// reaches the menu, and one left alone (while typing, say) falls through to it.
import { useEffect } from "react"
import { commands } from "@/lib/commands"
import { useStore, visiblePhotos } from "@/store"

/** 6 red, 7 yellow, 8 green, 9 blue (Lightroom / Bridge convention). */
const LABEL_KEYS: Record<string, string> = { "6": "label:0", "7": "label:1", "8": "label:2", "9": "label:3" }

export function useHotkeys() {
  useEffect(() => {
    let escapeHandled = false

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = !!target.closest("input, textarea, select, [contenteditable=true]")
      if (target.closest("[role=menu], [role=dialog], [role=alertdialog], [role=listbox]")) return
      const s = useStore.getState()
      const cmd = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const inFolder = s.workspace === "photos" && !!s.folder && !s.librarySection
      // Culling keys only act on the contact sheet, never on a library list or the documents.
      const photos = inFolder && s.folderTab === "photos"

      // These work everywhere, even while typing in a field.
      if (cmd && !e.altKey && !e.shiftKey) {
        if (key === "o") return run(e, commands.open)
        if (key === "1") return run(e, commands["workspace:home"])
        if (key === "2") return run(e, commands["workspace:photos"])
        if (key === "3") return run(e, commands["workspace:codes"])
        if (key === "f") return run(e, commands.find)
        if (key === "i" && s.folder) return run(e, commands["caption-panel"])
      }
      if (cmd && e.shiftKey && e.code === "KeyI") return run(e, commands.ingest)
      if (cmd && e.altKey && e.code === "KeyS" && s.workspace === "photos") return run(e, commands.sidebar)
      if (cmd && e.shiftKey && e.code === "KeyN" && inFolder) return run(e, commands["new-folder"])
      // The sidebar tree and folder lists move with the arrows themselves.
      if (typing || target.closest("[role=tree], [data-card], [data-doc]")) return

      if (cmd && e.key === "Enter" && photos) return run(e, commands["edit-caption"])
      if (e.key === "?" && !cmd) return run(e, commands.shortcuts)
      if (!photos) return

      if (cmd && e.altKey) {
        if (e.code === "Digit1") return run(e, commands["filter:all"])
        if (e.code === "Digit2") return run(e, commands["filter:tagged"])
        if (e.code === "Digit3") return run(e, commands["filter:untagged"])
        if (e.code === "Digit4") return run(e, commands["scope:both"])
        if (e.code === "Digit5") return run(e, commands["scope:raw"])
        if (e.code === "Digit6") return run(e, commands["scope:jpeg"])
        if (e.code === "KeyC") return run(e, commands["copy-caption"])
        if (e.code === "KeyV") return run(e, commands["paste-caption"])
        if (e.code === "KeyP") return run(e, commands["fill-credits"])
        if (e.code === "KeyR") return run(e, commands.continue)
        if (e.code === "KeyU") return run(e, commands.unviewed)
      }
      if (cmd && e.shiftKey) {
        if (e.code === "KeyC") return run(e, commands["copy-tagged"])
        if (e.code === "KeyM") return run(e, commands["move-tagged"])
        if (e.code === "KeyT") return run(e, commands["select-tagged"])
        if (e.code === "KeyU") return run(e, commands.send)
        if (e.code === "KeyE") return run(e, commands.export)
        if (e.code === "KeyR") return run(e, commands.reveal)
        if (e.code === "KeyA") return run(e, commands["auto-advance"])
      }
      if (cmd && (e.key === "Backspace" || e.key === "Delete")) return run(e, commands.trash)
      if (cmd && key === "a") return run(e, commands["select-all"])
      if (cmd && key === "d") return run(e, commands.deselect)
      if (cmd && key === "e") return run(e, commands["open-default"])
      if (cmd && (e.key === "=" || e.key === "+")) return run(e, commands["thumbs-bigger"])
      if (cmd && e.key === "-") return run(e, commands["thumbs-smaller"])
      if (cmd || e.altKey) return

      // Culling
      if (key === "t") return run(e, commands.tag)
      if (/^[0-5]$/.test(e.key)) return run(e, commands[`rate:${e.key}`])
      if (LABEL_KEYS[e.key]) return run(e, commands[LABEL_KEYS[e.key]])
      // Z: 100% to check focus (opens the loupe if needed). Esc fits it again first.
      if (key === "z") return run(e, commands.zoom)

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
        case "Enter": return run(e, commands.loupe)
        case "Escape":
          escapeHandled = true
          if (s.zoom) return run(e, () => s.setZoom(null))
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
      if (s.workspace === "photos" && s.zoom) run(e, () => s.setZoom(null))
      else if (s.workspace === "photos" && s.loupe) run(e, () => s.setLoupe(false))
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
