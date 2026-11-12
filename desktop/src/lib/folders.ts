// Actions on shoots, folders, collections and documents, shared by the sidebar, the library
// cards, the folder bar and their menus. Disk operations are always explicit and named for what
// they do ("Rename on disk", "Move to Trash"); everything else only changes the library.
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { create } from "zustand"
import { openFiles, reveal } from "@/lib/api"
import { plural, trashName } from "@/lib/format"
import { pickFiles as choose, pickFolder, preview } from "@/lib/platform"
import {
  baseName,
  folderContents,
  folderTitle,
  isWithin,
  parentPath,
  samePath,
  statsFor,
  useLibrary,
  type LibrarySection,
  type SubFolder,
} from "@/lib/library"
import { forgetRecentShoot, relocateRecentShoots } from "@/lib/recents"
import { continueReviewing, useViewing } from "@/lib/viewing"
import { targetPhotos, useStore, type FolderDoc } from "@/store"
import { useUI } from "@/ui"
import { confirm, promptName } from "@/lib/prompts"

// MARK: - Subfolder tree (the sidebar's expanded folders)

interface TreeState {
  children: Record<string, SubFolder[] | "error">
  load: (path: string) => Promise<void>
}

export const useTree = create<TreeState>((set) => ({
  children: {},
  load: async (path) => {
    try {
      const { subfolders } = await folderContents(path)
      set((s) => ({ children: { ...s.children, [path]: subfolders } }))
      if (subfolders.length) useLibrary.getState().refreshStats(subfolders.map((f) => f.path))
    } catch {
      set((s) => ({ children: { ...s.children, [path]: "error" } }))
    }
  },
}))

/** Re-reads every place that may show `path`'s parent: the tree, the open folder, the stats. */
function refreshAround(path: string) {
  const parent = parentPath(path)
  const tree = useTree.getState()
  for (const p of Object.keys(tree.children)) if (samePath(p, parent) || samePath(p, path)) tree.load(p)
  const s = useStore.getState()
  if (s.folder && (samePath(s.folder, parent) || samePath(s.folder, path))) s.refreshContents()
  useLibrary.getState().refreshStats()
}

/** Refresh an expanded folder and, if it is open, its contact sheet and contents. */
export async function refreshFolder(path: string) {
  const s = useStore.getState()
  if (s.folder && samePath(s.folder, path)) {
    const selected = new Set(s.selected)
    const focus = s.focus
    await s.openFolder(path, { origin: s.origin, tab: s.folderTab, select: focus ?? undefined })
    const current = useStore.getState()
    if (current.folder && samePath(current.folder, path)) {
      const valid = new Set(current.photos.map((photo) => photo.id))
      const retained = new Set([...selected].filter((id) => valid.has(id)))
      if (retained.size) {
        const nextFocus = focus && retained.has(focus) ? focus : [...retained][0]
        useStore.setState({ selected: retained, focus: nextFocus, anchor: nextFocus, pristine: false })
      }
    }
  }
  await useTree.getState().load(path)
  await useLibrary.getState().refreshStats([path])
}

/** Copy or move the active photo selection into a folder chosen from the library. */
export async function transferSelectionHere(destination: string, moveFiles: boolean) {
  const s = useStore.getState()
  const photos = targetPhotos(s)
  if (!s.folder || !photos.length) {
    toast("Select photos first.")
    return
  }
  if (s.busy) return
  await s.transfer(photos, destination, moveFiles)
  refreshAround(destination)
}

// MARK: - Opening

/**
 * Opens a shoot from the library, Home or the sidebar. One whose folder has gone missing gets a
 * plain explanation and a way to find it, instead of a file-system error and a trip to another screen.
 */
export async function openShoot(path: string, origin?: LibrarySection) {
  // One message per folder: asking again replaces it, and it goes away once the folder opens.
  const message = `missing:${path.replace(/[\\/]+$/, "")}`
  if (await stillMissing(path)) {
    toast.error(`Can’t find “${folderTitle(path)}”`, {
      id: message,
      description: "The folder may have been moved or renamed, or its drive isn’t connected.",
      duration: 12000,
      action: {
        label: "Locate…",
        // Opening it was the point: carry on once it's found.
        onClick: async () => {
          const found = await locateFolder(path)
          if (found) await useStore.getState().openFolder(found, { origin })
        },
      },
    })
    return
  }
  toast.dismiss(message)
  return useStore.getState().openFolder(path, { origin })
}

/** True when the library already shows this folder as missing and a fresh look agrees (its drive may be back). */
async function stillMissing(path: string) {
  const lib = useLibrary.getState()
  const known = statsFor(lib.stats, path)
  if (!known || known.exists) return false
  await lib.refreshStats([path])
  const now = statsFor(useLibrary.getState().stats, path)
  return !!now && !now.exists
}

/** Opens a shoot and picks up where the review stopped. */
export async function resumeShoot(path: string, origin?: LibrarySection) {
  const s = useStore.getState()
  if (!s.folder || !samePath(s.folder, path)) await s.openFolder(path, { origin, tab: "photos" })
  if (useStore.getState().folder && samePath(useStore.getState().folder!, path)) continueReviewing()
}

// MARK: - Collections

export async function newCollection(parent: string | null = null, shoots: string[] = []) {
  const name = await promptName({
    title: parent ? "New collection inside" : "New collection",
    description: "Collections group shoots without moving any files.",
    label: "Name",
    initial: "",
    action: "Create",
  })
  if (!name) return null
  const id = useLibrary.getState().createCollection(name, parent, shoots)
  if (shoots.length) toast.success(`Added ${plural(shoots.length, "shoot")} to ${name}`)
  return id
}

export async function renameCollection(id: string) {
  const c = useLibrary.getState().collections.find((x) => x.id === id)
  if (!c) return
  const name = await promptName({ title: "Rename collection", label: "Name", initial: c.name, action: "Rename" })
  if (name) useLibrary.getState().renameCollection(id, name)
}

export async function deleteCollection(id: string) {
  const c = useLibrary.getState().collections.find((x) => x.id === id)
  if (!c) return
  if (!await confirm({
    title: "Are you sure you want to delete this collection?",
    description: `“${c.name}” and its subcollections will be removed. Their shoots and photo files stay on disk.`,
    action: "Delete collection", destructive: true,
  })) return
  const undo = useLibrary.getState().deleteCollection(id)
  const s = useStore.getState()
  if (s.librarySection?.kind === "collection" && s.librarySection.id === id) s.showSection({ kind: "all" })
  toast(`Deleted the collection “${c.name}”`, {
    description: "Its shoots and files are untouched.",
    action: { label: "Undo", onClick: undo },
  })
}

// MARK: - Shoots in the library

export async function removeFromLibrary(path: string) {
  if (!await confirm({
    title: "Are you sure you want to remove this shoot?",
    description: `“${folderTitle(path)}” will be removed from Deadlyne. Its folder and photos stay on disk.`,
    action: "Remove from Deadlyne", destructive: true,
  })) return
  const undo = useLibrary.getState().removeShoot(path)
  forgetRecentShoot(path)
  toast(`Removed “${folderTitle(path)}” from Deadlyne`, {
    description: "The folder and its photos stay on disk. Open it again any time.",
    action: { label: "Undo", onClick: undo },
  })
}

export async function removeFromCollection(id: string, path: string) {
  const collection = useLibrary.getState().collections.find((c) => c.id === id)
  if (!collection || !await confirm({
    title: "Are you sure you want to remove this shoot from the collection?",
    description: `“${folderTitle(path)}” will leave “${collection.name}”. Its folder and photos stay on disk.`,
    action: "Remove from collection", destructive: true,
  })) return
  useLibrary.getState().removeFromCollection(id, path)
}

export async function removeRecentShoot(path: string) {
  if (!await confirm({
    title: "Are you sure you want to remove this recent shoot?",
    description: `“${folderTitle(path)}” will leave Recent shoots. Its folder and photos stay on disk.`,
    action: "Remove from recents", destructive: true,
  })) return
  await forgetRecentShoot(path)
}

/** A folder now lives somewhere else: its review progress, library entries and recents follow it. */
export async function followMovedFolder(from: string, to: string) {
  await invoke("viewing_relocate", { from, to }).catch(() => {})
  useLibrary.getState().relocate(from, to)
  await relocateRecentShoots(from, to)
}

/** For a shoot whose folder was moved or renamed outside Deadlyne: point it at the new place. Resolves to where it is now. */
export async function locateFolder(path: string): Promise<string | null> {
  const picked = await pickFolder(`Where is “${baseName(path)}” now?`)
  if (!picked) return null
  await followMovedFolder(path, picked)
  toast.success(`Found “${baseName(picked)}”`, { description: "Its collections and review progress came along." })
  return picked
}

export async function resetProgress(path: string) {
  const ok = await confirm({
    title: `Reset viewing progress for “${folderTitle(path)}”?`,
    description: "Every photo in this folder and the folders inside it will count as not viewed. Tags, ratings and captions aren’t affected.",
    action: "Reset progress",
    destructive: true,
  })
  if (!ok) return
  await useViewing.getState().reset(path, true)
  toast.success("Viewing progress reset")
}

// MARK: - Folders on disk

export async function newFolder(parent: string) {
  const name = await promptName({
    title: "New folder",
    description: `Creates a folder on disk inside “${baseName(parent)}”.`,
    label: "Name",
    initial: "Untitled folder",
    action: "Create",
  })
  if (!name) return
  try {
    const path = await invoke<string>("create_folder", { parent, name })
    refreshAround(path)
    toast.success(`Created “${baseName(path)}”`)
  } catch (e) {
    toast.error("Couldn’t create the folder", { description: String(e) })
  }
}

export async function renameOnDisk(path: string) {
  const name = await promptName({
    title: "Rename folder on disk",
    description: "Renames the real folder. Collections, pins and review progress follow it.",
    label: "Folder name",
    initial: baseName(path),
    action: "Rename",
  })
  if (!name || name === baseName(path)) return
  try {
    const renamed = await invoke<string>("rename_path", { path, newName: name })
    await followMovedFolder(path, renamed)
    const s = useStore.getState()
    if (s.folder && isWithin(s.folder, path)) await s.openFolder(renamed + s.folder.slice(path.replace(/[\\/]+$/, "").length))
    refreshAround(renamed)
  } catch (e) {
    toast.error("Couldn’t rename the folder", { description: String(e) })
  }
}

export async function trashFolder(path: string) {
  const ok = await confirm({
    title: "Are you sure you want to delete this folder?",
    description: `“${baseName(path)}” and everything in it will move to ${trashName}. You can restore it from there.`,
    action: "Move to Trash",
    destructive: true,
  })
  if (!ok) return
  try {
    await invoke("trash_path", { path })
  } catch (e) {
    toast.error("Couldn’t move it to the Trash", { description: String(e) })
    return
  }
  const lib = useLibrary.getState()
  for (const shoot of lib.shoots.filter((x) => isWithin(x.path, path))) lib.removeShoot(shoot.path)
  const s = useStore.getState()
  if (s.folder && isWithin(s.folder, path)) {
    const parent = parentPath(path)
    if (lib.shoots.some((x) => isWithin(parent, x.path))) await s.openFolder(parent)
    else s.showSection(s.origin)
  }
  refreshAround(path)
  toast.success(`Moved “${baseName(path)}” to ${trashName}`)
}

// MARK: - Documents

/** Lets the photographer pick files, then asks whether to copy them in or link them. */
export async function pickFiles(folder: string) {
  const paths = await choose(`Add files to “${folderTitle(folder)}”`)
  if (paths.length) useUI.getState().openAddFiles(folder, paths)
}

export async function addFiles(folder: string, paths: string[], mode: "copy" | "link") {
  if (mode === "link") {
    const n = useLibrary.getState().linkDocuments(folder, paths)
    await useStore.getState().refreshContents()
    toast.success(n ? `Linked ${plural(n, "file")}` : "Those files are already linked", {
      description: n ? "They stay where they are. Deadlyne only remembers them." : undefined,
    })
    return
  }
  const r = await invoke<{ added: FolderDoc[]; errors: string[] }>("add_documents", { folder, paths })
  await useStore.getState().refreshContents()
  if (r.errors.length) {
    toast.error(r.added.length ? `Added ${plural(r.added.length, "file")}, with problems` : "Couldn’t add those files", {
      description: r.errors.slice(0, 4).join("\n"),
    })
  } else {
    toast.success(`Copied ${plural(r.added.length, "file")} into ${folderTitle(folder)}`, { description: "The originals stay where they were." })
  }
  if (r.added[0]) useStore.setState({ folderTab: "documents", selectedDoc: r.added[0].path })
}

export function quickLook(doc: FolderDoc) {
  if (!doc.exists) return
  preview(doc.path).catch((e) => toast.error("Couldn’t preview it", { description: String(e) }))
}

export function openDoc(doc: FolderDoc) {
  if (!doc.exists) return
  openFiles([doc.path]).catch((e) => toast.error("Couldn’t open it", { description: String(e) }))
}

export const revealDoc = (doc: FolderDoc) => doc.exists && reveal(doc.path)

export async function renameDoc(doc: FolderDoc) {
  if (doc.linkId) return
  const name = await promptName({ title: "Rename document", label: "File name", initial: doc.name, action: "Rename" })
  if (!name || name === doc.name) return
  try {
    const path = await invoke<string>("rename_path", { path: doc.path, newName: name })
    await useStore.getState().refreshContents()
    useStore.setState({ selectedDoc: path })
  } catch (e) {
    toast.error("Couldn’t rename it", { description: String(e) })
  }
}

export async function moveDoc(doc: FolderDoc) {
  const destination = await pickFolder(`Move “${doc.name}” to…`)
  if (!destination) return
  if (doc.linkId) {
    // A link moves to another folder in the library; the file itself stays put.
    useLibrary.getState().unlinkDocument(doc.linkId)
    useLibrary.getState().linkDocuments(destination, [doc.path])
    await useStore.getState().refreshContents()
    toast.success(`Linked “${doc.name}” to ${folderTitle(destination)}`)
    return
  }
  const r = await invoke<{ added: FolderDoc[]; errors: string[] }>("move_documents", { paths: [doc.path], destination })
  await useStore.getState().refreshContents()
  if (r.errors.length) toast.error("Couldn’t move it", { description: r.errors.join("\n") })
  else toast.success(`Moved “${doc.name}” to ${baseName(destination)}`)
}

export async function removeDoc(doc: FolderDoc) {
  if (!await confirm({
    title: doc.linkId ? "Are you sure you want to remove this document link?" : "Are you sure you want to delete this document?",
    description: doc.linkId ? `The link to “${doc.name}” will be removed from this shoot. The file itself stays where it is.` : `“${doc.name}” will move to ${trashName}. You can restore it from there.`,
    action: doc.linkId ? "Remove link" : "Move to Trash",
    destructive: true,
  })) return
  if (doc.linkId) {
    useLibrary.getState().unlinkDocument(doc.linkId)
    await useStore.getState().refreshContents()
    toast(`Removed the link to “${doc.name}”`, { description: "The file itself wasn’t touched." })
    return
  }
  try {
    await invoke("trash_path", { path: doc.path })
  } catch (e) {
    toast.error("Couldn’t move it to the Trash", { description: String(e) })
  }
  await useStore.getState().refreshContents()
}

/** A linked document that moved: point the link at the file's new place. */
export async function relinkDoc(doc: FolderDoc) {
  if (!doc.linkId) return
  const [picked] = await choose(`Where is “${doc.name}” now?`, { multiple: false })
  if (!picked) return
  useLibrary.getState().relinkDocument(doc.linkId, picked)
  await useStore.getState().refreshContents()
  useStore.setState({ selectedDoc: picked })
}
