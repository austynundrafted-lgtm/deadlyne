// Actions on shoots, folders, collections and documents, shared by the sidebar, the library
// cards, the folder bar and their menus. Disk operations are always explicit and named for what
// they do ("Rename on disk", "Move to Trash"); everything else only changes the library.
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { create } from "zustand"
import { openFiles, reveal } from "@/lib/api"
import { isMac, plural } from "@/lib/format"
import {
  baseName,
  folderContents,
  folderTitle,
  isWithin,
  parentPath,
  samePath,
  useLibrary,
  type LibrarySection,
  type SubFolder,
} from "@/lib/library"
import { forgetRecentShoot } from "@/lib/recents"
import { continueReviewing, useViewing } from "@/lib/viewing"
import { useStore, type FolderDoc } from "@/store"
import { useUI } from "@/ui"
import { confirm, promptName } from "@/components/Prompts"

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

// MARK: - Opening

export function openShoot(path: string, origin?: LibrarySection) {
  return useStore.getState().openFolder(path, { origin })
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

export function deleteCollection(id: string) {
  const c = useLibrary.getState().collections.find((x) => x.id === id)
  if (!c) return
  const undo = useLibrary.getState().deleteCollection(id)
  const s = useStore.getState()
  if (s.librarySection?.kind === "collection" && s.librarySection.id === id) s.showSection({ kind: "all" })
  toast(`Deleted the collection “${c.name}”`, {
    description: "Its shoots and files are untouched.",
    action: { label: "Undo", onClick: undo },
  })
}

// MARK: - Shoots in the library

export function removeFromLibrary(path: string) {
  const undo = useLibrary.getState().removeShoot(path)
  forgetRecentShoot(path)
  toast(`Removed “${folderTitle(path)}” from Deadlyne`, {
    description: "The folder and its photos stay on disk. Open it again any time.",
    action: { label: "Undo", onClick: undo },
  })
}

/** For a shoot whose folder was moved or renamed outside Deadlyne: point it at the new place. */
export async function locateFolder(path: string) {
  const picked = await open({ directory: true, title: `Where is “${baseName(path)}” now?` })
  if (typeof picked !== "string") return
  await invoke("viewing_relocate", { from: path, to: picked })
  useLibrary.getState().relocate(path, picked)
  toast.success(`Found “${baseName(picked)}”`, { description: "Its collections and review progress came along." })
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
    useLibrary.getState().relocate(path, renamed)
    const s = useStore.getState()
    if (s.folder && isWithin(s.folder, path)) await s.openFolder(renamed + s.folder.slice(path.replace(/[\\/]+$/, "").length))
    refreshAround(renamed)
  } catch (e) {
    toast.error("Couldn’t rename the folder", { description: String(e) })
  }
}

export async function trashFolder(path: string) {
  const ok = await confirm({
    title: `Move “${baseName(path)}” to the Trash?`,
    description: `The folder and everything in it go to the ${isMac ? "Trash" : "Recycle Bin"}. You can put it back from there.`,
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
  toast.success(`Moved “${baseName(path)}” to the ${isMac ? "Trash" : "Recycle Bin"}`)
}

// MARK: - Documents

/** Lets the photographer pick files, then asks whether to copy them in or link them. */
export async function pickFiles(folder: string) {
  const picked = await open({ multiple: true, directory: false, title: `Add files to “${folderTitle(folder)}”` })
  const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : []
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
  invoke("quick_look", { path: doc.path }).catch((e) => toast.error("Couldn’t preview it", { description: String(e) }))
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
  const destination = await open({ directory: true, title: `Move “${doc.name}” to…` })
  if (typeof destination !== "string") return
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
  if (doc.linkId) {
    useLibrary.getState().unlinkDocument(doc.linkId)
    await useStore.getState().refreshContents()
    toast(`Removed the link to “${doc.name}”`, { description: "The file itself wasn’t touched." })
    return
  }
  const ok = await confirm({
    title: `Move “${doc.name}” to the Trash?`,
    description: `It’s a file inside this shoot folder. You can put it back from the ${isMac ? "Trash" : "Recycle Bin"}.`,
    action: "Move to Trash",
    destructive: true,
  })
  if (!ok) return
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
  const picked = await open({ multiple: false, directory: false, title: `Where is “${doc.name}” now?` })
  if (typeof picked !== "string") return
  useLibrary.getState().relinkDocument(doc.linkId, picked)
  await useStore.getState().refreshContents()
  useStore.setState({ selectedDoc: picked })
}
