// The library: every shoot Deadlyne has opened, plus the photographer's own organization of them.
// Collections, pins, favorites, archive and linked documents are virtual: they live in
// library.json and never move or rename anything on disk. Folder operations that do touch the disk
// (new folder, rename, Move to Trash) are separate, explicit actions in lib/folders.ts.
import { invoke } from "@tauri-apps/api/core"
import { LazyStore } from "@tauri-apps/plugin-store"
import { create } from "zustand"
import { recentShoots } from "@/lib/recents"
import { shootName } from "@/lib/shootName"

export interface LibraryShoot {
  path: string
  addedAt: number
  openedAt: number
  favorite?: boolean
  pinned?: boolean
  archived?: boolean
}

/** A virtual group of shoots. Collections nest through `parent`. */
export interface Collection {
  id: string
  name: string
  parent: string | null
  shoots: string[]
  createdAt: number
}

/** A file attached to a folder by reference: it stays where it is on disk. */
export interface LinkedDoc {
  id: string
  folder: string
  path: string
  addedAt: number
}

export interface FolderStats {
  path: string
  exists: boolean
  error: string | null
  photos: number
  viewed: number
  totalPhotos: number
  totalViewed: number
  subfolders: number
  documents: number
  modified: number | null
}

export interface DocEntry {
  path: string
  name: string
  ext: string
  size: number
  modified: number | null
  exists: boolean
}

export interface SubFolder {
  path: string
  name: string
}

export type LibrarySection =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "favorites" }
  | { kind: "archive" }
  | { kind: "collection"; id: string }

export const SECTION_TITLES: Record<Exclude<LibrarySection["kind"], "collection">, string> = {
  all: "All shoots",
  recent: "Recent shoots",
  favorites: "Favorites",
  archive: "Archive",
}

export const folderStats = (paths: string[]) => invoke<FolderStats[]>("folder_stats", { paths })
export const folderContents = (path: string) => invoke<{ subfolders: SubFolder[]; documents: DocEntry[] }>("folder_contents", { path })
export const docsInfo = (paths: string[]) => invoke<DocEntry[]>("docs_info", { paths })

export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path
export const parentPath = (path: string) => path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "")
export const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "")
/** True when `child` is `parent` or inside it. */
export const isWithin = (child: string, parent: string) => {
  const p = parent.replace(/[\\/]+$/, "")
  return child === p || child.startsWith(p + "/") || child.startsWith(p + "\\")
}
/** The readable title of a shoot folder ("Boys Varsity · Fairborn vs Tecumseh"). */
export const folderTitle = (path: string) => shootName(baseName(path)).title

/** How much of a folder (and everything below it) has been viewed, 0–1. */
export const progressOf = (s?: FolderStats) => (s && s.totalPhotos ? s.totalViewed / s.totalPhotos : 0)

const file = new LazyStore("library.json")

interface LibraryState {
  loaded: boolean
  shoots: LibraryShoot[]
  collections: Collection[]
  links: LinkedDoc[]
  stats: Record<string, FolderStats>

  load: () => Promise<void>
  /** Remembers a shoot that was just opened (adds it to the library the first time). */
  noteOpened: (path: string) => void
  addShoots: (paths: string[]) => void
  updateShoot: (path: string, patch: Partial<Omit<LibraryShoot, "path">>) => void
  /** Forgets a shoot. Its files and its progress record stay; opening it again brings it back. */
  removeShoot: (path: string) => () => void
  /** A folder was renamed or found elsewhere: point everything that referred to it at the new place. */
  relocate: (from: string, to: string) => void

  createCollection: (name: string, parent: string | null, shoots?: string[]) => string
  renameCollection: (id: string, name: string) => void
  moveCollection: (id: string, parent: string | null) => void
  duplicateCollection: (id: string) => string | null
  /** Deletes a collection and its sub-collections. Returns an undo. */
  deleteCollection: (id: string) => () => void
  addToCollection: (id: string, paths: string[]) => void
  removeFromCollection: (id: string, path: string) => void

  linkDocuments: (folder: string, paths: string[]) => number
  unlinkDocument: (id: string) => void
  relinkDocument: (id: string, path: string) => void

  refreshStats: (paths?: string[]) => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function persist(get: () => LibraryState) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    const { shoots, collections, links } = get()
    await file.set("shoots", shoots)
    await file.set("collections", collections)
    await file.set("links", links)
    await file.save()
  }, 300)
}

const newId = () => crypto.randomUUID()
let loading: Promise<void> | null = null

/** A collection and every collection nested inside it. */
export function descendantIds(collections: Collection[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const c of collections) {
      if (c.parent && out.has(c.parent) && !out.has(c.id)) {
        out.add(c.id)
        grew = true
      }
    }
  }
  return out
}

export const useLibrary = create<LibraryState>((set, get) => {
  const mutate = (patch: Partial<LibraryState> | ((s: LibraryState) => Partial<LibraryState>)) => {
    set(patch)
    persist(get)
  }

  async function loadOnce() {
    const [shoots, collections, links] = await Promise.all([
      file.get<LibraryShoot[]>("shoots"),
      file.get<Collection[]>("collections"),
      file.get<LinkedDoc[]>("links"),
    ])
    let list = shoots ?? []
    // First run: the library starts with the recent shoots Home already knows.
    if (!shoots) {
      list = (await recentShoots()).map((r) => ({ path: r.path, addedAt: r.openedAt, openedAt: r.openedAt }))
    }
    // Anything noted before the file finished loading wins.
    const early = get().shoots
    const merged = [...early, ...list.filter((s) => !early.some((e) => samePath(e.path, s.path)))]
    set({ loaded: true, shoots: merged, collections: collections ?? [], links: links ?? [] })
    if (!shoots || early.length) persist(get)
    get().refreshStats()
  }

  return {
    loaded: false,
    shoots: [],
    collections: [],
    links: [],
    stats: {},

    // Once per launch: a second read would merge the stale file back over changes made since.
    load: () => (loading ??= loadOnce()),

    noteOpened: (path) => {
      const now = Date.now()
      const existing = get().shoots.find((s) => samePath(s.path, path))
      // A subfolder of a shoot that's already here is reached through it, not listed again.
      if (!existing && get().shoots.some((s) => isWithin(path, s.path))) {
        get().refreshStats([path])
        return
      }
      mutate((s) => ({
        shoots: existing
          ? s.shoots.map((x) => (x === existing ? { ...x, openedAt: now } : x))
          : [...s.shoots, { path, addedAt: now, openedAt: now }],
      }))
      get().refreshStats([path])
    },

    addShoots: (paths) => {
      const now = Date.now()
      const fresh = paths.filter((p) => !get().shoots.some((s) => samePath(s.path, p)))
      if (!fresh.length) return
      mutate((s) => ({ shoots: [...s.shoots, ...fresh.map((path) => ({ path, addedAt: now, openedAt: 0 }))] }))
      get().refreshStats(fresh)
    },

    updateShoot: (path, patch) => {
      if (!get().shoots.some((s) => samePath(s.path, path))) get().addShoots([path])
      mutate((s) => ({ shoots: s.shoots.map((x) => (samePath(x.path, path) ? { ...x, ...patch } : x)) }))
    },

    removeShoot: (path) => {
      const before = { shoots: get().shoots, collections: get().collections }
      mutate((s) => ({
        shoots: s.shoots.filter((x) => !samePath(x.path, path)),
        collections: s.collections.map((c) => ({ ...c, shoots: c.shoots.filter((p) => !samePath(p, path)) })),
      }))
      return () => mutate(before)
    },

    relocate: (from, to) => {
      const swap = (p: string) => (isWithin(p, from) ? to + p.slice(from.replace(/[\\/]+$/, "").length) : p)
      mutate((s) => ({
        shoots: s.shoots.map((x) => ({ ...x, path: swap(x.path) })),
        collections: s.collections.map((c) => ({ ...c, shoots: c.shoots.map(swap) })),
        links: s.links.map((l) => ({ ...l, folder: swap(l.folder), path: swap(l.path) })),
      }))
      get().refreshStats([to])
    },

    createCollection: (name, parent, shoots = []) => {
      const id = newId()
      if (shoots.length) get().addShoots(shoots)
      mutate((s) => ({ collections: [...s.collections, { id, name: name.trim() || "Untitled collection", parent, shoots, createdAt: Date.now() }] }))
      return id
    },

    renameCollection: (id, name) =>
      mutate((s) => ({ collections: s.collections.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c)) })),

    moveCollection: (id, parent) => {
      // Never inside itself or one of its own children.
      if (parent && descendantIds(get().collections, id).has(parent)) return
      mutate((s) => ({ collections: s.collections.map((c) => (c.id === id ? { ...c, parent } : c)) }))
    },

    duplicateCollection: (id) => {
      const src = get().collections.find((c) => c.id === id)
      if (!src) return null
      // Copies the collection and everything nested in it; the shoots themselves are only referenced.
      const ids = descendantIds(get().collections, id)
      const map = new Map([...ids].map((x) => [x, newId()]))
      const copies = get()
        .collections.filter((c) => ids.has(c.id))
        .map((c) => ({
          ...c,
          id: map.get(c.id)!,
          parent: c.id === id ? c.parent : map.get(c.parent!)!,
          name: c.id === id ? `${c.name} copy` : c.name,
          shoots: [...c.shoots],
          createdAt: Date.now(),
        }))
      mutate((s) => ({ collections: [...s.collections, ...copies] }))
      return map.get(id)!
    },

    deleteCollection: (id) => {
      const before = get().collections
      const gone = descendantIds(before, id)
      mutate((s) => ({ collections: s.collections.filter((c) => !gone.has(c.id)) }))
      return () => mutate({ collections: before })
    },

    addToCollection: (id, paths) => {
      get().addShoots(paths)
      mutate((s) => ({
        collections: s.collections.map((c) =>
          c.id === id ? { ...c, shoots: [...c.shoots, ...paths.filter((p) => !c.shoots.some((x) => samePath(x, p)))] } : c,
        ),
      }))
    },

    removeFromCollection: (id, path) =>
      mutate((s) => ({ collections: s.collections.map((c) => (c.id === id ? { ...c, shoots: c.shoots.filter((p) => !samePath(p, path)) } : c)) })),

    linkDocuments: (folder, paths) => {
      const fresh = paths.filter((p) => !get().links.some((l) => samePath(l.folder, folder) && samePath(l.path, p)))
      mutate((s) => ({ links: [...s.links, ...fresh.map((path) => ({ id: newId(), folder, path, addedAt: Date.now() }))] }))
      return fresh.length
    },

    unlinkDocument: (id) => mutate((s) => ({ links: s.links.filter((l) => l.id !== id) })),
    relinkDocument: (id, path) => mutate((s) => ({ links: s.links.map((l) => (l.id === id ? { ...l, path } : l)) })),

    refreshStats: async (paths) => {
      const list = paths ?? get().shoots.map((s) => s.path)
      if (!list.length) return
      try {
        const fresh = await folderStats(list)
        set((s) => {
          const stats = { ...s.stats }
          for (const f of fresh) stats[f.path] = f
          return { stats }
        })
      } catch {
        // Stats are a nicety: the folders still open without them.
      }
    },
  }
})

/** The stats for a folder, matching paths with or without a trailing separator. */
export function statsFor(stats: Record<string, FolderStats>, path: string): FolderStats | undefined {
  return stats[path] ?? stats[path.replace(/[\\/]+$/, "")]
}

/** The library shoot that contains `path` (itself, or the closest one above it). */
export function rootShootOf(shoots: LibraryShoot[], path: string): LibraryShoot | undefined {
  return shoots
    .filter((s) => isWithin(path, s.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
}
