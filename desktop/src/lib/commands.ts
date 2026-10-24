// Every command the menu bar, the keyboard and the toolbar can ask for, by id. The ids are the
// menu item ids in src-tauri/src/native.rs, so the menu bar and the keys never drift apart. Each
// command checks for itself that it makes sense right now, because the menu can ask at any time.
import { toast } from "sonner"
import { LABELS, type Label } from "@/lib/api"
import { askTrash, copyOrMove, openExport, openFolderDialog, openTargets, revealTarget } from "@/lib/actions"
import { newFolder } from "@/lib/folders"
import { checkForUpdates } from "@/lib/updates"
import { continueReviewing } from "@/lib/viewing"
import { toggleSidebar } from "@/components/Sidebar"
import { targetPhotos, useStore, type Workspace } from "@/store"
import { useUI } from "@/ui"

/** Where the photographer is: in a shoot folder, and on its contact sheet (the only place culling acts). */
export function where() {
  const s = useStore.getState()
  const inFolder = s.workspace === "photos" && !!s.folder && !s.librarySection
  return { s, inFolder, photos: inFolder && s.folderTab === "photos" }
}

function onSheet(fn: (s: ReturnType<typeof useStore.getState>) => void) {
  return () => {
    const { s, photos } = where()
    if (photos) fn(s)
  }
}

export function focusSearch() {
  useStore.getState().setWorkspace("photos")
  requestAnimationFrame(() => {
    const el = document.getElementById("photo-search") as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

/** ⌘A selects the text of a field when one has the cursor, otherwise every photo in view. */
function selectAll() {
  const el = document.activeElement as HTMLElement | null
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.select()
  if (el?.isContentEditable) return void document.execCommand("selectAll")
  const { s, photos } = where()
  if (photos) s.selectAll()
}

export const toggleTag = onSheet((s) => {
  const targets = targetPhotos(s)
  s.cull(() => ({ tagged: !targets.every((p) => p.tagged) }))
})

export const rate = (rating: number) => onSheet((s) => s.cull(() => ({ rating })))

/** Pressing a label's key again clears it, like Lightroom. */
export const setLabel = (label: Label | null) =>
  onSheet((s) => {
    const targets = targetPhotos(s)
    s.cull(() => ({ label: label && targets.every((p) => p.label === label) ? null : label }))
  })

export const toggleAutoAdvance = onSheet((s) => {
  s.setAutoAdvance(!s.autoAdvance)
  toast(s.autoAdvance ? "Auto-advance off" : "Auto-advance on", {
    description: s.autoAdvance ? undefined : "In the loupe, the next photo comes up after you tag, rate or label.",
  })
})

/** Z: 100% to check focus (opens the loupe if needed); again to fit. */
export const toggleZoom = onSheet((s) => {
  if (!s.loupe) s.setLoupe(true)
  const now = useStore.getState()
  now.setZoom(now.zoom ? null : { x: 0.5, y: 0.5 })
})

const workspace = (w: Workspace) => () => useStore.getState().setWorkspace(w)

export const commands: Record<string, () => void> = {
  open: () => void openFolderDialog(),
  ingest: () => useUI.getState().open("ingest"),
  "new-folder": () => {
    const { s, inFolder } = where()
    if (inFolder) void newFolder(s.folder!)
  },
  export: () => openExport(),
  send: () => {
    if (useStore.getState().folder) useUI.getState().openSend("tagged")
  },
  "copy-tagged": () => void copyOrMove("tagged", false),
  "move-tagged": () => void copyOrMove("tagged", true),
  reveal: onSheet(revealTarget),
  "open-default": onSheet(openTargets),
  trash: onSheet(askTrash),
  "select-all": selectAll,
  deselect: onSheet((s) => s.deselectAll()),
  "select-tagged": onSheet((s) => s.selectTagged()),
  find: focusSearch,
  "caption-panel": () => {
    const s = useStore.getState()
    if (s.folder) s.setCaptionPanel(!s.captionPanel)
  },
  "edit-caption": onSheet((s) => s.focusCaption()),
  "copy-caption": onSheet((s) => s.copyCaptions()),
  "paste-caption": onSheet((s) => s.pasteCaptions()),
  "fill-credits": onSheet((s) => s.fillCredits() || useUI.getState().open("profile")),
  codes: workspace("codes"),
  tag: toggleTag,
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((n) => [`rate:${n}`, rate(n)])),
  ...Object.fromEntries(LABELS.slice(0, 4).map((label, i) => [`label:${i}`, setLabel(label)])),
  "label:none": setLabel(null),
  "auto-advance": toggleAutoAdvance,
  continue: onSheet(continueReviewing),
  unviewed: onSheet((s) => s.setUnviewedOnly(!s.unviewedOnly)),
  "workspace:home": workspace("home"),
  "workspace:photos": workspace("photos"),
  "workspace:codes": workspace("codes"),
  loupe: onSheet((s) => s.setLoupe(!s.loupe)),
  zoom: toggleZoom,
  "scope:both": onSheet((s) => s.setFilter({ fileScope: "both" })),
  "scope:raw": onSheet((s) => s.setFilter({ fileScope: "raw" })),
  "scope:jpeg": onSheet((s) => s.setFilter({ fileScope: "jpeg" })),
  "filter:all": onSheet((s) => s.setFilter({ tagFilter: "all" })),
  "filter:tagged": onSheet((s) => s.setFilter({ tagFilter: "tagged" })),
  "filter:untagged": onSheet((s) => s.setFilter({ tagFilter: "untagged" })),
  "thumbs-bigger": onSheet((s) => s.setThumbSize(s.thumbSize * 1.15)),
  "thumbs-smaller": onSheet((s) => s.setThumbSize(s.thumbSize / 1.15)),
  sidebar: () => {
    if (useStore.getState().workspace === "photos") toggleSidebar()
  },
  settings: () => useUI.getState().open("profile"),
  "check-updates": () => void checkForUpdates({ quiet: false }),
  shortcuts: () => useUI.getState().open("shortcuts"),
}
