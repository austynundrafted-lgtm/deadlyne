// App state. One store, plain actions; components select only what they render.
import { useMemo } from "react"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { toast } from "sonner"
import {
  CAPTION_FIELDS,
  captionValue,
  emptyCaptions,
  filesFor,
  loadDetails,
  recordFolderOpened,
  saveCaptions,
  saveCulling,
  scanFolder,
  splitKeywords,
  transferPhotos,
  trashPhotos,
  type Badge,
  type CaptionField,
  type Captions,
  type Culling,
  type FileScope,
  type JpegMode,
  type Label,
  type Photo,
} from "@/lib/api"
import { fetchRemoteProfile, pushRemoteProfile } from "@/lib/auth"
import { expandCodes } from "@/lib/codes"
import { noteRecentShoot } from "@/lib/recents"
import { DEFAULT_COPYRIGHT, getSetting, pref, setPref, setSetting, type Profile } from "@/lib/settings"
import { expandVariables } from "@/lib/variables"

export type Workspace = "home" | "photos" | "codes"
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
  search: string
  fileScope: FileScope

  selected: Set<string>
  anchor: string | null
  focus: string | null
  loupe: boolean
  /** The loupe at 100%: the point of the photo at the center of the view (0–1 each way), or null to fit. */
  zoom: { x: number; y: number } | null
  /** In the loupe, go to the next photo after tagging, rating or labeling (⇧⌘A, like the Mac app). */
  autoAdvance: boolean
  /** True until the user picks or moves to a photo after opening a shoot. */
  pristine: boolean
  thumbSize: number
  /** Columns in the grid right now, for ↑ ↓ navigation. */
  columns: number

  captionPanel: boolean
  jpegMode: JpegMode
  profile: Profile | null
  captionClipboard: Captions | null
  /** Shown while a copy/move/trash runs. */
  busy: string | null
  /** Bumped to ask the caption panel to focus the Caption field. */
  captionFocusRequest: number

  setWorkspace: (w: Workspace) => void
  openFolder: (path: string) => Promise<void>
  setFilter: (f: Partial<Pick<State, "tagFilter" | "minRating" | "labelFilter" | "search" | "fileScope">>) => void
  clearFilters: () => void
  click: (id: string, opts: { shift?: boolean; toggle?: boolean }) => void
  selectAll: () => void
  deselectAll: () => void
  selectTagged: () => void
  move: (delta: number, extend?: boolean) => void
  setLoupe: (open: boolean) => void
  setZoom: (zoom: { x: number; y: number } | null) => void
  setAutoAdvance: (on: boolean) => void
  setThumbSize: (n: number) => void
  setColumns: (n: number) => void
  /** Applies culling to the targets (the loupe photo, else the selection) and saves sidecars. */
  cull: (change: (targets: Photo[]) => Partial<Culling>) => void

  setCaptionPanel: (open: boolean) => void
  focusCaption: () => void
  setJpegMode: (m: JpegMode) => void
  setProfile: (p: Profile | null) => void
  /** Saves one edited caption field to `ids`, expanding codes and per-photo variables. */
  commitCaption: (field: CaptionField, value: string, removedKeywords: string[], ids: string[]) => void
  copyCaptions: () => void
  pasteCaptions: () => void
  /** Photographer, Credit and Copyright from the profile. False when there's no profile yet. */
  fillCredits: () => boolean
  transfer: (photos: Photo[], destination: string, moveFiles: boolean) => Promise<void>
  trash: (photos: Photo[]) => Promise<void>
}

export const THUMB_MIN = 140
export const THUMB_MAX = 420

type FilterState = Pick<State, "photos" | "tagFilter" | "minRating" | "labelFilter" | "search" | "fileScope">

export function visiblePhotos(s: FilterState): Photo[] {
  const q = s.search.trim().toLowerCase()
  if (s.tagFilter === "all" && s.minRating === 0 && !s.labelFilter && !q && s.fileScope === "both") return s.photos
  return s.photos.filter(
    (p) =>
      (s.tagFilter === "all" || p.tagged === (s.tagFilter === "tagged")) &&
      p.rating >= s.minRating &&
      (!s.labelFilter || p.label === s.labelFilter) &&
      (s.fileScope === "both" || (s.fileScope === "raw" ? !!p.raw : !!p.jpeg)) &&
      (!q || matchesSearch(p, q)),
  )
}

/** The photos the grid shows right now (filters, search and file type applied). */
export function useVisiblePhotos(): Photo[] {
  const f = useStore(
    useShallow((s) => ({ photos: s.photos, tagFilter: s.tagFilter, minRating: s.minRating, labelFilter: s.labelFilter, search: s.search, fileScope: s.fileScope })),
  )
  return useMemo(() => visiblePhotos(f), [f.photos, f.tagFilter, f.minRating, f.labelFilter, f.search, f.fileScope]) // eslint-disable-line react-hooks/exhaustive-deps
}

function matchesSearch(p: Photo, q: string) {
  if (p.name.toLowerCase().includes(q)) return true
  return CAPTION_FIELDS.some((f) => captionValue(p.captions, f).toLowerCase().includes(q))
}

export function targetPhotos(s: Pick<State, "loupe" | "focus" | "photos" | "selected">): Photo[] {
  if (s.loupe && s.focus) return s.photos.filter((p) => p.id === s.focus)
  return s.photos.filter((p) => s.selected.has(p.id))
}

export function notifyBadges(badges: Badge[]) {
  if (!badges.length) return
  const names = badges.map((b) => b.name).join(", ")
  toast.success(badges.length === 1 ? `Badge unlocked: ${names}` : `Badges unlocked: ${names}`, {
    description: "See all your badges on Home.",
  })
}

function reportFailures(failed: string[], what: string) {
  if (failed.length) toast.error(`Some ${what} couldn’t be saved`, { description: failed.slice(0, 4).join("\n") })
}

/** Replaces the photos in `ids` with `change(photo)` and returns the changed ones. */
function updatePhotos(get: () => State, set: (p: Partial<State>) => void, ids: Set<string>, change: (p: Photo) => Photo) {
  const changed: Photo[] = []
  const photos = get().photos.map((p) => {
    if (!ids.has(p.id)) return p
    const next = change(p)
    changed.push(next)
    return next
  })
  if (changed.length) set({ photos })
  return changed
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
  search: "",
  fileScope: pref<FileScope>("fileScope", "both"),
  selected: new Set(),
  anchor: null,
  focus: null,
  loupe: false,
  zoom: null,
  autoAdvance: pref("autoAdvance", false),
  pristine: true,
  thumbSize: pref("thumbSize", 220),
  columns: 1,
  captionPanel: pref("captionPanel", true),
  jpegMode: "xmpAndIim",
  profile: null,
  captionClipboard: null,
  busy: null,
  captionFocusRequest: 0,

  setWorkspace: (workspace) => set({ workspace, loupe: workspace === "photos" ? get().loupe : false }),

  openFolder: async (path) => {
    const gen = ++openGeneration
    set({ loading: true, workspace: "photos", loupe: false })
    try {
      const { folder, photos: entries } = await scanFolder(path)
      if (gen !== openGeneration) return
      const photos: Photo[] = entries.map((e) => ({ ...e, rating: 0, label: null, tagged: false, captions: emptyCaptions() }))
      const first = photos[0]?.id ?? null
      set({
        folder, photos, loading: false, detailsReady: false,
        selected: new Set(first ? [first] : []), anchor: first, focus: first, pristine: true,
        tagFilter: "all", minRating: 0, labelFilter: null, search: "",
      })
      noteRecentShoot(folder, photos.length)
      recordFolderOpened(folder, photos.length).then(notifyBadges)

      // Capture times, camera info, existing ratings and captions arrive a moment later.
      const details = await loadDetails(entries)
      if (gen !== openGeneration) return
      // Keep anything the user already changed in the meantime; otherwise take what's on disk.
      const untouched = (p: Photo) => p.rating === 0 && !p.label && !p.tagged
      const loaded = get().photos.map((p, i) => ({
        ...p,
        meta: details[i]?.meta,
        ...(untouched(p) ? details[i]?.culling : {}),
        captions: details[i]?.captions ?? p.captions,
      }))
      loaded.sort((a, b) => (a.meta?.captured ?? "").localeCompare(b.meta?.captured ?? ""))
      set({ photos: loaded, detailsReady: true })
      // Sorting by capture time can move the first-named file (e.g. MCD_0001 after a counter
      // rollover) to the end. Start on the first frame shot, unless the user has already moved.
      const s = get()
      if (s.pristine && !s.loupe && loaded[0]) {
        const id = loaded[0].id
        set({ selected: new Set([id]), anchor: id, focus: id })
      }
    } catch (e) {
      if (gen !== openGeneration) return
      set({ loading: false })
      toast.error("Couldn’t open that folder", { description: String(e) })
    }
  },

  setFilter: (f) => {
    if (f.fileScope) setPref("fileScope", f.fileScope)
    set(f)
  },
  clearFilters: () => set({ tagFilter: "all", minRating: 0, labelFilter: null, search: "" }),

  click: (id, { shift, toggle }) => {
    const s = get()
    set({ pristine: false })
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

  selectAll: () => set((s) => ({ selected: new Set(visiblePhotos(s).map((p) => p.id)), pristine: false })),
  deselectAll: () => set({ selected: new Set(), pristine: false }),
  selectTagged: () =>
    set((s) => ({ selected: new Set(visiblePhotos(s).filter((p) => p.tagged).map((p) => p.id)), pristine: false })),

  move: (delta, extend) => {
    const s = get()
    set({ pristine: false })
    const list = visiblePhotos(s)
    if (!list.length) return
    const i = Math.max(0, list.findIndex((p) => p.id === s.focus))
    const next = list[Math.min(list.length - 1, Math.max(0, i + delta))].id
    if (extend && s.anchor) {
      get().click(next, { shift: true })
    } else {
      set({ selected: new Set([next]), anchor: next, focus: next, zoom: next === s.focus ? s.zoom : null })
    }
  },

  setLoupe: (loupe) => set((s) => ({ loupe: loupe && !!s.focus, zoom: null })),
  setZoom: (zoom) => set((s) => ({ zoom: s.loupe ? zoom : null })),
  setAutoAdvance: (autoAdvance) => {
    setPref("autoAdvance", autoAdvance)
    set({ autoAdvance })
  },

  setThumbSize: (n) => {
    const thumbSize = Math.round(Math.min(THUMB_MAX, Math.max(THUMB_MIN, n)))
    setPref("thumbSize", thumbSize)
    set({ thumbSize })
  },

  setColumns: (columns) => set({ columns }),

  cull: (change) => {
    const before = get()
    const targets = targetPhotos(before)
    if (!targets.length) return
    const patch = change(targets)
    const changed = updatePhotos(get, set, new Set(targets.map((t) => t.id)), (p) => ({ ...p, ...patch }))
    saveCulling(changed).then((failed) => reportFailures(failed, "ratings"))

    // In the loupe, step on when auto-advance is on, or when the photo just left the filter
    // (tagging while showing Untagged) so the loupe never goes blank.
    if (!before.loupe || !before.focus) return
    const list = visiblePhotos(before)
    const i = list.findIndex((p) => p.id === before.focus)
    const shown = new Set(visiblePhotos(get()).map((p) => p.id))
    const gone = !shown.has(before.focus)
    if (i < 0 || (!gone && !get().autoAdvance)) return
    const next = list.slice(i + 1).find((p) => shown.has(p.id)) ?? (gone ? list.slice(0, i).reverse().find((p) => shown.has(p.id)) : undefined)
    if (next) set({ selected: new Set([next.id]), anchor: next.id, focus: next.id, zoom: null })
    else if (gone) set({ loupe: false, zoom: null })
  },

  // MARK: Captions

  setCaptionPanel: (captionPanel) => {
    setPref("captionPanel", captionPanel)
    set({ captionPanel })
  },
  focusCaption: () => set((s) => ({ captionPanel: true, captionFocusRequest: s.captionFocusRequest + 1 })),
  setJpegMode: (jpegMode) => {
    set({ jpegMode })
    setSetting("jpegCaptionMode", jpegMode)
  },
  setProfile: (profile) => {
    set({ profile })
    setSetting("profile", profile)
    pushRemoteProfile(profile).catch(() => {}) // offline: it syncs the next time it's saved
  },

  commitCaption: (field, value, removedKeywords, ids) => {
    const removed = new Set(removedKeywords.map((k) => k.toLowerCase()))
    const changed = updatePhotos(get, set, new Set(ids), (p) => {
      const expanded = expandVariables(expandCodes(value), p)
      const captions = { ...p.captions }
      if (field === "keywords") {
        // Keywords merge across a selection: keep each photo's others, drop only the removed ones.
        const keep = p.captions.keywords.filter((k) => !removed.has(k.toLowerCase()))
        const add = splitKeywords(expanded).filter((k) => !keep.some((x) => x.toLowerCase() === k.toLowerCase()))
        captions.keywords = [...keep, ...add]
      } else {
        captions[field] = field === "countryCode" ? expanded.trim().toUpperCase() : expanded.trim()
      }
      return { ...p, captions }
    })
    if (changed.length) saveCaptions(changed, [field], get().jpegMode).then((failed) => reportFailures(failed, "captions"))
  },

  copyCaptions: () => {
    const p = targetPhotos(get())[0]
    if (!p) return
    set({ captionClipboard: p.captions })
    toast(`Copied caption info from ${p.name}`)
  },

  pasteCaptions: () => {
    const clip = get().captionClipboard
    const ids = new Set(targetPhotos(get()).map((p) => p.id))
    if (!clip || !ids.size) return
    const changed = updatePhotos(get, set, ids, (p) => ({ ...p, captions: { ...clip, keywords: [...clip.keywords] } }))
    saveCaptions(changed, [...CAPTION_FIELDS], get().jpegMode).then((failed) => reportFailures(failed, "captions"))
    toast(`Pasted caption info onto ${changed.length} photo${changed.length === 1 ? "" : "s"}`)
  },

  fillCredits: () => {
    const profile = get().profile
    if (!profile?.name.trim()) return false
    const ids = new Set(targetPhotos(get()).map((p) => p.id))
    if (!ids.size) return true
    const changed = updatePhotos(get, set, ids, (p) => {
      const year = p.meta?.captured?.slice(0, 4) ?? String(new Date().getFullYear())
      const copyright = (profile.copyright || DEFAULT_COPYRIGHT).replace(/\{year\}/gi, year).replace(/\{name\}/gi, profile.name.trim()).trim()
      return {
        ...p,
        captions: { ...p.captions, creator: profile.name.trim(), credit: profile.credit.trim() || p.captions.credit, copyright },
      }
    })
    saveCaptions(changed, ["creator", "credit", "copyright"], get().jpegMode).then((failed) => reportFailures(failed, "captions"))
    toast(`Filled credits on ${changed.length} photo${changed.length === 1 ? "" : "s"}`)
    return true
  },

  // MARK: Files

  transfer: async (photos, destination, moveFiles) => {
    const { fileScope, folder } = get()
    if (!photos.length) return
    if (folder && destination.replace(/[\\/]+$/, "") === folder.replace(/[\\/]+$/, "")) {
      toast.error("Choose a different folder", { description: "The photos are already in this folder." })
      return
    }
    set({ busy: `${moveFiles ? "Moving" : "Copying"} ${photos.length} photo${photos.length === 1 ? "" : "s"}…` })
    try {
      const r = await transferPhotos(photos, fileScope, destination, moveFiles)
      if (moveFiles && fileScope !== "both") {
        await get().openFolder(folder!) // one half of each pair stays: re-read the folder
      } else if (moveFiles && r.completed.length) {
        const gone = new Set(r.completed)
        set((s) => ({
          photos: s.photos.filter((p) => !gone.has(p.id)),
          selected: new Set([...s.selected].filter((id) => !gone.has(id))),
          loupe: false,
        }))
      }
      const done = `${moveFiles ? "Moved" : "Copied"} ${r.files} file${r.files === 1 ? "" : "s"}`
      const extra = r.skipped ? ` · ${r.skipped} already there, skipped` : ""
      if (r.errors.length) toast.error(`${done}, with problems`, { description: r.errors.slice(0, 4).join("\n") })
      else toast.success(done + extra)
    } finally {
      set({ busy: null })
    }
  },

  trash: async (photos) => {
    const { fileScope, folder } = get()
    if (!photos.length) return
    set({ busy: "Moving to the Trash…", loupe: false })
    try {
      const r = await trashPhotos(photos, fileScope)
      if (fileScope !== "both") {
        await get().openFolder(folder!) // one half of each pair stays: re-read the folder
      } else {
        const gone = new Set(r.completed)
        // Keep culling: land on the photo that followed the first trashed one.
        const before = visiblePhotos(get())
        const firstGone = before.findIndex((p) => gone.has(p.id))
        const next = before.slice(firstGone).find((p) => !gone.has(p.id)) ?? before.slice(0, firstGone).reverse().find((p) => !gone.has(p.id))
        set((s) => ({
          photos: s.photos.filter((p) => !gone.has(p.id)),
          selected: new Set(next ? [next.id] : []),
          anchor: next?.id ?? null,
          focus: next?.id ?? null,
        }))
      }
      if (r.errors.length) toast.error("Some files couldn’t be moved to the Trash", { description: r.errors.slice(0, 4).join("\n") })
      else toast.success(`Moved ${r.files} file${r.files === 1 ? "" : "s"} to the Trash`)
    } finally {
      set({ busy: null })
    }
  },
}))

/** Loads settings kept in the store file (called once at launch). */
export async function loadSettings() {
  const [jpegMode, profile] = await Promise.all([
    getSetting<JpegMode>("jpegCaptionMode", "xmpAndIim"),
    getSetting<Profile | null>("profile", null),
  ])
  useStore.setState({ jpegMode, profile })
  // The account keeps the profile too, so a new computer starts with it filled in.
  fetchRemoteProfile()
    .then((remote) => {
      if (remote && !useStore.getState().profile) {
        useStore.setState({ profile: remote })
        setSetting("profile", remote)
      } else if (!remote && profile) {
        pushRemoteProfile(profile)
      }
    })
    .catch(() => {})
}

/** The value every photo shares for `field`; when they differ the field is "mixed". */
export function commonCaption(photos: Photo[], field: CaptionField): { value: string; mixed: boolean } {
  if (!photos.length) return { value: "", mixed: false }
  if (field === "keywords") {
    const sets = photos.map((p) => new Set(p.captions.keywords.map((k) => k.toLowerCase())))
    const common = photos[0].captions.keywords.filter((k) => sets.every((s) => s.has(k.toLowerCase())))
    return { value: common.join(", "), mixed: sets.some((s) => s.size !== common.length) }
  }
  const first = captionValue(photos[0].captions, field)
  const mixed = photos.some((p) => captionValue(p.captions, field) !== first)
  return { value: mixed ? "" : first, mixed }
}

export { filesFor }
