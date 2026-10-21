// Review progress: which photos in the open shoot have actually been looked at.
//
// A photo counts as viewed when its thumbnail was at least half on screen for a second while
// Deadlyne was the active app, or when it was opened in the loupe. Scrolling quickly past
// photos doesn't count. Viewed status is remembered per folder by file stem (see library.rs),
// so sorting, filtering and re-reading the folder keep it; it's separate from tags, ratings and
// captions. Marks are batched and written by Rust a moment later.
import { useEffect, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import type { PhotoEntry } from "@/lib/api"
import { isWithin, useLibrary } from "@/lib/library"
import { useStore, visiblePhotos } from "@/store"

/** The key a photo's viewed status is kept under: its file stem, lowercased (pairs share it). */
export const photoKey = (p: Pick<PhotoEntry, "name">) => p.name.replace(/\.[^.]+$/, "").toLowerCase()

/** How long a thumbnail must stay on screen to count, and how much of it. */
export const DWELL_MS = 1000
const VISIBLE_RATIO = 0.5
const FLUSH_MS = 1200

interface ViewingState {
  folder: string | null
  viewed: Set<string>
  /** Where the review stopped: the photo most recently viewed for the first time (a key).
   *  Looking back at photos already seen never moves it, so jumping to the top doesn't lose your place. */
  last: string | null
  ready: boolean
  /** Bumped on every change, for cheap memo keys. */
  version: number
  load: (folder: string) => Promise<void>
  mark: (keys: string[], last?: string | null) => void
  /** Clears a folder's progress (and every folder below it with `recursive`). */
  reset: (folder: string, recursive: boolean) => Promise<void>
}

let pending: { folder: string; keys: Set<string>; last: string | null } | null = null
let flushTimer: ReturnType<typeof setTimeout> | undefined

export async function flushViewing() {
  clearTimeout(flushTimer)
  const batch = pending
  pending = null
  if (!batch || (!batch.keys.size && !batch.last)) return
  try {
    await invoke("viewing_mark", { folder: batch.folder, keys: [...batch.keys], last: batch.last })
  } catch (e) {
    toast.error("Couldn’t save review progress", { description: String(e) })
    return
  }
  // Library cards and the sidebar show progress for this folder and the shoots above it.
  const lib = useLibrary.getState()
  const affected = lib.shoots.map((s) => s.path).filter((p) => isWithin(batch.folder, p))
  lib.refreshStats([...new Set([batch.folder, ...affected])])
}

function queue(folder: string, keys: Iterable<string>, last: string | null) {
  if (pending && pending.folder !== folder) void flushViewing()
  pending ??= { folder, keys: new Set(), last: null }
  for (const k of keys) pending.keys.add(k)
  if (last) pending.last = last
  clearTimeout(flushTimer)
  flushTimer = setTimeout(flushViewing, FLUSH_MS)
}

export const useViewing = create<ViewingState>((set, get) => ({
  folder: null,
  viewed: new Set(),
  last: null,
  ready: false,
  version: 0,

  load: async (folder) => {
    await flushViewing()
    set({ folder, viewed: new Set(), last: null, ready: false, version: get().version + 1 })
    try {
      const r = await invoke<{ viewed: string[]; last: string | null }>("viewing_load", { folder })
      if (get().folder !== folder) return
      // Keep anything marked while the record was loading.
      const viewed = new Set([...r.viewed, ...get().viewed])
      set({ viewed, last: get().last ?? r.last, ready: true, version: get().version + 1 })
    } catch {
      set({ ready: true })
    }
  },

  mark: (keys, last) => {
    const { folder, viewed } = get()
    if (!folder) return
    const fresh = keys.filter((k) => !viewed.has(k))
    if (!fresh.length && (!last || last === get().last)) return
    const next = fresh.length ? new Set(viewed) : viewed
    for (const k of fresh) next.add(k)
    set({ viewed: next, last: last ?? get().last, version: get().version + 1 })
    queue(folder, fresh, last ?? null)
  },

  reset: async (folder, recursive) => {
    if (pending && isWithin(pending.folder, folder)) pending = null
    await invoke("viewing_reset", { folder, recursive })
    const open = get().folder
    if (open && (open === folder || (recursive && isWithin(open, folder)))) {
      set({ viewed: new Set(), last: null, version: get().version + 1 })
      useStore.setState({ unviewedSnapshot: useStore.getState().unviewedOnly ? new Set() : null })
    }
    const lib = useLibrary.getState()
    lib.refreshStats([...new Set([folder, ...lib.shoots.map((s) => s.path)])])
  },
}))

/** Viewed and total photos in the open folder, updated as marks come in. */
export function useOpenFolderProgress() {
  const photos = useStore((s) => s.photos)
  const { viewed, version, ready } = useViewing(useShallow((s) => ({ viewed: s.viewed, version: s.version, ready: s.ready })))
  return useMemo(() => {
    let n = 0
    for (const p of photos) if (viewed.has(photoKey(p))) n++
    return { viewed: n, total: photos.length, ready }
  }, [photos, version, ready]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** True while the photographer can actually be looking at the contact sheet. */
function gridIsActive() {
  const s = useStore.getState()
  return (
    document.visibilityState === "visible" &&
    document.hasFocus() &&
    s.workspace === "photos" &&
    !!s.folder &&
    s.librarySection === null &&
    s.folderTab === "photos" &&
    !s.loupe
  )
}

/**
 * Watches the contact sheet's thumbnails (`[data-view-key]` inside `root`) and marks each one that
 * stays at least half visible for DWELL_MS while the app is active. Call `scan()` after rendering
 * so newly mounted (virtualized) cards are observed.
 */
export function useViewTracker(root: React.RefObject<HTMLElement | null>) {
  const tracker = useMemo(() => {
    const since = new Map<string, number>()
    let io: IntersectionObserver | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    const observed = new WeakSet<Element>()
    return {
      start(el: HTMLElement) {
        io = new IntersectionObserver(
          (entries) => {
            const now = performance.now()
            for (const e of entries) {
              const key = (e.target as HTMLElement).dataset.viewKey
              if (!key) continue
              if (!e.target.isConnected) {
                io?.unobserve(e.target)
                observed.delete(e.target)
              }
              if (e.isIntersecting && e.intersectionRatio >= VISIBLE_RATIO && e.target.isConnected) {
                if (!since.has(key)) since.set(key, now)
              } else {
                since.delete(key)
              }
            }
          },
          { root: el, threshold: [0, VISIBLE_RATIO, 1] },
        )
        timer = setInterval(() => {
          const now = performance.now()
          if (!gridIsActive()) {
            // Time away from the grid doesn't count toward the dwell.
            for (const k of since.keys()) since.set(k, now)
            return
          }
          const v = useViewing.getState()
          const due: string[] = []
          for (const [k, t] of since) {
            if (now - t < DWELL_MS) continue
            since.delete(k)
            if (!v.viewed.has(k)) due.push(k)
          }
          if (!due.length) return
          // The furthest of them in the current order becomes the review position.
          const order = visiblePhotos(useStore.getState())
          const dueSet = new Set(due)
          let last: string | null = null
          for (const p of order) if (dueSet.has(photoKey(p))) last = photoKey(p)
          v.mark(due, last)
        }, 250)
        this.scan(el)
      },
      scan(el: HTMLElement) {
        if (!io) return
        for (const card of el.querySelectorAll<HTMLElement>("[data-view-key]")) {
          if (observed.has(card)) continue
          observed.add(card)
          io.observe(card)
        }
      },
      stop() {
        io?.disconnect()
        io = null
        clearInterval(timer)
        since.clear()
      },
    }
  }, [])

  useEffect(() => {
    const el = root.current
    if (!el) return
    tracker.start(el)
    return () => tracker.stop()
  }, [root, tracker])

  return tracker
}

/** Wires review tracking to the rest of the app. Called once at launch. */
export function initViewing() {
  // Opening a photo in the loupe counts right away; a first look also moves the review position.
  useStore.subscribe((s, prev) => {
    if (!s.loupe || !s.folder || s.folder !== useViewing.getState().folder) return
    if (s.focus === prev.focus && s.loupe === prev.loupe) return
    const photo = s.focus ? s.photos.find((p) => p.id === s.focus) : undefined
    if (!photo) return
    const v = useViewing.getState()
    const key = photoKey(photo)
    v.mark([key], v.viewed.has(key) ? null : key)
  })
  window.addEventListener("blur", () => void flushViewing())
  window.addEventListener("beforeunload", () => void flushViewing())
}

/**
 * Continue reviewing: back to the photo last reviewed, or, if it's gone, the first photo not
 * viewed yet in the current order. Briefly marks it so the eye finds it.
 */
export function continueReviewing() {
  const s = useStore.getState()
  const v = useViewing.getState()
  if (!s.folder || !s.photos.length) return
  const byKey = (k: string | null) => (k ? s.photos.find((p) => photoKey(p) === k) : undefined)
  let target = byKey(v.last)
  if (!target) {
    const order = visiblePhotos(s).length ? visiblePhotos(s) : s.photos
    target = order.find((p) => !v.viewed.has(photoKey(p))) ?? s.photos.find((p) => !v.viewed.has(photoKey(p)))
  }
  if (!target) {
    toast("Every photo in this shoot has been viewed")
    target = s.photos[0]
  }
  // A filter that hides the photo would leave nothing to land on.
  if (!visiblePhotos(s).some((p) => p.id === target.id)) s.clearFilters()
  s.showResume(target.id)
}
