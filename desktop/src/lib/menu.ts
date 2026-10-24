// The macOS menu bar, built in Rust (src-tauri/src/native.rs). Its items run the same commands as
// the keyboard (lib/commands.ts). This side tells it what is enabled and checked, keeps Open Recent
// current, and runs what it picks. Windows keeps the keyboard shortcuts only, with no menu bar yet.
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { commands } from "@/lib/commands"
import { folderTitle } from "@/lib/library"
import { onRecentShoots, recentShoots, type RecentShoot } from "@/lib/recents"
import { isSidebarRail } from "@/components/Sidebar"
import { useStore } from "@/store"

/** Mirrors `MenuState` in native.rs. */
interface MenuState {
  workspace: string
  inFolder: boolean
  photos: boolean
  hasPhotos: boolean
  hasTargets: boolean
  loupe: boolean
  zoom: boolean
  captionPanel: boolean
  autoAdvance: boolean
  unviewedOnly: boolean
  tagFilter: string
  fileScope: string
  sidebar: boolean
}

function menuState(): MenuState {
  const s = useStore.getState()
  const inFolder = s.workspace === "photos" && !!s.folder && !s.librarySection
  return {
    workspace: s.workspace,
    inFolder,
    photos: inFolder && s.folderTab === "photos",
    hasPhotos: !!s.folder && s.photos.length > 0,
    hasTargets: s.loupe ? !!s.focus : s.selected.size > 0,
    loupe: s.loupe,
    zoom: !!s.zoom,
    captionPanel: s.captionPanel,
    autoAdvance: s.autoAdvance,
    unviewedOnly: s.unviewedOnly,
    tagFilter: s.tagFilter,
    fileScope: s.fileScope,
    sidebar: !isSidebarRail(),
  }
}

let wired = false
let last = ""

/** Sends the menu what changed, and nothing when nothing did (the store updates often). */
function push() {
  const state = menuState()
  const key = JSON.stringify(state)
  if (key === last) return
  last = key
  invoke("menu_state", { state }).catch(() => {})
}

export async function initMenu() {
  // Only macOS builds a menu bar; elsewhere the calls below are no-ops on the Rust side.
  if (wired) return
  wired = true
  await listen<{ id: string; path?: string }>("menu", ({ payload }) => {
    // A dialog owns the keyboard while it is open; the menu waits for it to close.
    if (document.activeElement?.closest("[role=dialog], [role=alertdialog]")) return
    if (payload.id === "open-recent") {
      if (payload.path) void useStore.getState().openFolder(payload.path)
      return
    }
    commands[payload.id]?.()
  })
  useStore.subscribe(push)
  window.addEventListener("deadlyne-sidebar", push)
  push()

  const sendRecents = (list: RecentShoot[]) =>
    invoke("menu_recents", { items: list.map((r) => ({ path: r.path, name: folderTitle(r.path) })) }).catch(() => {})
  onRecentShoots(sendRecents)
  await sendRecents(await recentShoots())
}
