// Shoots and photos opened from outside: Finder's Open With, a folder dropped on the Dock icon, or a
// path on the command line. A folder opens as a shoot; a photo opens its folder with that photo in focus.
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { useStore } from "@/store"

interface OpenedPath {
  path: string
  isDir: boolean
}

let wired = false

export async function initOpening() {
  if (wired) return
  wired = true
  await listen("opened-paths", () => void openFromOutside())
  await openFromOutside()
}

async function openFromOutside() {
  const [first] = await invoke<OpenedPath[]>("take_opened_paths")
  if (!first) return
  if (first.isDir) return useStore.getState().openFolder(first.path)
  const folder = first.path.replace(/[\\/][^\\/]+$/, "")
  await useStore.getState().openFolder(folder, { select: first.path })
}
