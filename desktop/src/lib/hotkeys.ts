// Keyboard shortcuts — the same keys as the Mac app, so muscle memory carries over.
import { useEffect } from "react"
import { LABELS, type Label } from "@/lib/api"
import { openFolderDialog } from "@/lib/actions"
import { targetPhotos, useStore, visiblePhotos } from "@/store"

/** 6 red, 7 yellow, 8 green, 9 blue (Lightroom / Bridge convention). */
const LABEL_KEYS: Record<string, Label> = { "6": LABELS[0], "7": LABELS[1], "8": LABELS[2], "9": LABELS[3] }

export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest("input, textarea, [contenteditable=true], [role=menu], [role=dialog]")) return
      const s = useStore.getState()
      const cmd = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (cmd && !e.shiftKey && !e.altKey) {
        if (key === "o") return run(e, openFolderDialog)
        if (key === "1") return run(e, () => s.setWorkspace("home"))
        if (key === "2") return run(e, () => s.setWorkspace("photos"))
      }
      if (s.workspace !== "photos" || !s.folder) return

      if (cmd && e.altKey && ["1", "2", "3"].includes(e.key)) {
        const tagFilter = (["all", "tagged", "untagged"] as const)[Number(e.key) - 1]
        return run(e, () => s.setFilter({ tagFilter }))
      }
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
    let escapeHandled = false
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
