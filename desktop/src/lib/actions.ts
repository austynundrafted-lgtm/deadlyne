// Actions shared by buttons, menus, keyboard shortcuts and drag-and-drop.
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { FILE_SCOPES, openFiles, primaryFile, reveal } from "@/lib/api"
import { targetPhotos, useStore } from "@/store"
import { useUI } from "@/ui"

export async function openFolderDialog() {
  const path = await open({ directory: true, multiple: false, title: "Open a shoot" })
  if (typeof path === "string") await useStore.getState().openFolder(path)
}

/** Copy or move the tagged photos (or the selection) to a folder the user picks. */
export async function copyOrMove(which: "tagged" | "selected", moveFiles: boolean) {
  const s = useStore.getState()
  const photos = which === "tagged" ? s.photos.filter((p) => p.tagged) : targetPhotos(s)
  if (!photos.length) {
    toast(which === "tagged" ? "No tagged photos yet. Press T to tag." : "Select photos first.")
    return
  }
  const scope = FILE_SCOPES.find((f) => f.value === s.fileScope)!.label
  const destination = await open({
    directory: true,
    title: `${moveFiles ? "Move" : "Copy"} ${photos.length} ${which} photo${photos.length === 1 ? "" : "s"} (${scope}) to…`,
  })
  if (typeof destination === "string") await s.transfer(photos, destination, moveFiles)
}

export function askTrash() {
  if (targetPhotos(useStore.getState()).length) useUI.getState().open("confirmTrash")
}

/** Shows the photo (the first of the selection) in Finder or Explorer. */
export function revealTarget() {
  const s = useStore.getState()
  const p = targetPhotos(s)[0]
  if (p) reveal(primaryFile(p, s.fileScope))
}

/** Most apps open one window per file, so a whole game's worth is almost always a slip. */
const OPEN_LIMIT = 20

/** Opens the photos in the default app for their type, like double-clicking them in Finder. */
export function openTargets() {
  const s = useStore.getState()
  const photos = targetPhotos(s)
  if (!photos.length) return
  if (photos.length > OPEN_LIMIT) {
    toast(`Select ${OPEN_LIMIT} or fewer photos to open them.`)
    return
  }
  openFiles(photos.map((p) => primaryFile(p, s.fileScope))).catch((e) => toast.error("Couldn’t open them", { description: String(e) }))
}
