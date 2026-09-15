// App state. One store, plain actions; components select only what they render.
import { create } from "zustand"
import { toast } from "sonner"
import { loadDetails, saveCulling, scanFolder, type Culling, type Label, type Photo } from "@/lib/api"
import { noteRecentShoot } from "@/lib/recents"

export type Workspace = "home" | "photos"
export type TagFilter = "all" | "tagged" | "untagged"

interface State {
  workspace: Workspace
  folder: string | null
  photos: Photo[]
  loading: boolean
  detailsReady: boolean

  tagFilter: TagFilter
  minRating: number
  labelFilter: Label | null

  selected: Set<string>
  anchor: string | null
  focus: string | null
  loupe: boolean
  thumbSize: number
  /** Columns in the grid right now, for ↑ ↓ navigation. */
  columns: number

  setWorkspace: (w: Workspace) => void
  openFolder: (path: string) => Promise<void>
  setFilter: (f: Partial<Pick<State, "tagFilter" | "minRating" | "labelFilter">>) => void
  clearFilters: () => void
  click: (id: string, opts: { shift?: boolean; toggle?: boolean }) => void
  selectAll: () => void
  move: (delta: number, extend?: boolean) => void
  setLoupe: (open: boolean) => void
  setThumbSize: (n: number) => void
  setColumns: (n: number) => void
  /** Applies culling to the targets (the loupe photo, else the selection) and saves sidecars. */
  cull: (change: (targets: Photo[]) => Partial<Culling>) => void
}

export const THUMB_MIN = 140
export const THUMB_MAX = 420

export function visiblePhotos(s: Pick<State, "photos" | "tagFilter" | "minRating" | "labelFilter">): Photo[] {
  if (s.tagFilter === "all" && s.minRating === 0 && !s.labelFilter) return s.photos
  return s.photos.filter(
    (p) =>
      (s.tagFilter === "all" || p.tagged === (s.tagFilter === "tagged")) &&
      p.rating >= s.minRating &&
      (!s.labelFilter || p.label === s.labelFilter),
  )
}

export function targetPhotos(s: State): Photo[] {
  if (s.loupe && s.focus) return s.photos.filter((p) => p.id === s.focus)
  return s.photos.filter((p) => s.selected.has(p.id))
}

let openGeneration = 0

export const useStore = create<State>((set, get) => ({
  workspace: "home",
  folder: null,
  photos: [],
  loading: false,
  detailsReady: false,
  tagFilter: "all",
  minRating: 0,
  labelFilter: null,
  selected: new Set(),
  anchor: null,
  focus: null,
  loupe: false,
  thumbSize: Number(localStorage.getItem("thumbSize")) || 220,
  columns: 1,

  setWorkspace: (workspace) => set({ workspace, loupe: workspace === "photos" ? get().loupe : false }),

  openFolder: async (path) => {
    const gen = ++openGeneration
    set({ loading: true, workspace: "photos", loupe: false })
    try {
      const { folder, photos: entries } = await scanFolder(path)
      if (gen !== openGeneration) return
      const photos: Photo[] = entries.map((e) => ({ ...e, rating: 0, label: null, tagged: false }))
      const first = photos[0]?.id ?? null
      set({
        folder, photos, loading: false, detailsReady: false,
        selected: new Set(first ? [first] : []), anchor: first, focus: first,
        tagFilter: "all", minRating: 0, labelFilter: null,
      })
      noteRecentShoot(folder, photos.length)

      // Capture times, camera info and existing ratings arrive a moment later.
      const details = await loadDetails(entries)
      if (gen !== openGeneration) return
      // Keep anything the user already changed in the meantime; otherwise take the sidecar.
      const untouched = (p: Photo) => p.rating === 0 && !p.label && !p.tagged
      const loaded = get().photos.map((p, i) => ({
        ...p,
        meta: details[i]?.meta,
        ...(untouched(p) ? details[i]?.culling : {}),
      }))
      loaded.sort((a, b) => (a.meta?.captured ?? "").localeCompare(b.meta?.captured ?? ""))
      set({ photos: loaded, detailsReady: true })
    } catch (e) {
      if (gen !== openGeneration) return
      set({ loading: false })
      toast.error("Couldn’t open that folder", { description: String(e) })
    }
  },

  setFilter: (f) => set(f),
  clearFilters: () => set({ tagFilter: "all", minRating: 0, labelFilter: null }),

  click: (id, { shift, toggle }) => {
    const s = get()
    if (shift && s.anchor) {
      const list = visiblePhotos(s)
      const a = list.findIndex((p) => p.id === s.anchor)
      const b = list.findIndex((p) => p.id === id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        set({ selected: new Set(list.slice(lo, hi + 1).map((p) => p.id)), focus: id })
        return
      }
    }
    if (toggle) {
      const selected = new Set(s.selected)
      if (selected.has(id)) selected.delete(id)
      else selected.add(id)
      set({ selected, anchor: id, focus: id })
      return
    }
    set({ selected: new Set([id]), anchor: id, focus: id })
  },

  selectAll: () => set((s) => ({ selected: new Set(visiblePhotos(s).map((p) => p.id)) })),

  move: (delta, extend) => {
    const s = get()
    const list = visiblePhotos(s)
    if (!list.length) return
    const i = Math.max(0, list.findIndex((p) => p.id === s.focus))
    const next = list[Math.min(list.length - 1, Math.max(0, i + delta))].id
    if (extend && s.anchor) {
      get().click(next, { shift: true })
    } else {
      set({ selected: new Set([next]), anchor: next, focus: next })
    }
  },

  setLoupe: (loupe) => set((s) => ({ loupe: loupe && !!s.focus })),

  setThumbSize: (n) => {
    const thumbSize = Math.round(Math.min(THUMB_MAX, Math.max(THUMB_MIN, n)))
    localStorage.setItem("thumbSize", String(thumbSize))
    set({ thumbSize })
  },

  setColumns: (columns) => set({ columns }),

  cull: (change) => {
    const s = get()
    const targets = targetPhotos(s)
    if (!targets.length) return
    const patch = change(targets)
    const ids = new Set(targets.map((t) => t.id))
    const changed: Photo[] = []
    const photos = s.photos.map((p) => {
      if (!ids.has(p.id)) return p
      const next = { ...p, ...patch }
      changed.push(next)
      return next
    })
    set({ photos })
    saveCulling(changed).then((failed) => {
      if (failed.length) toast.error("Some ratings couldn’t be saved", { description: failed.slice(0, 3).join("\n") })
    })
  },
}))
