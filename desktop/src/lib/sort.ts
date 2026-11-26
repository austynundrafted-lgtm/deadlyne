// The contact sheet's order. Capture time is the default; each shoot remembers its own choice.
import { LABELS, type Photo } from "@/lib/api"
import { pref, setPref } from "@/lib/settings"

export type SortKey = "captured" | "name" | "rating" | "label" | "tagged"

export interface SortOrder {
  key: SortKey
  /** The other direction from the key's natural one (newest first, Z to A, lowest first…). */
  reverse: boolean
}

export const DEFAULT_SORT: SortOrder = { key: "captured", reverse: false }

export const SORT_KEYS: { value: SortKey; label: string; directions: [string, string] }[] = [
  { value: "captured", label: "Capture time", directions: ["Oldest first", "Newest first"] },
  { value: "name", label: "File name", directions: ["A to Z", "Z to A"] },
  { value: "rating", label: "Rating", directions: ["Highest first", "Lowest first"] },
  { value: "label", label: "Color label", directions: ["Red to purple", "Purple to red"] },
  { value: "tagged", label: "Tagged first", directions: ["Tagged first", "Untagged first"] },
]

export const sortLabel = (key: SortKey) => SORT_KEYS.find((k) => k.value === key)?.label ?? "Capture time"

const byName = (a: Photo, b: Photo) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
const byTime = (a: Photo, b: Photo) => (a.meta?.captured ?? "").localeCompare(b.meta?.captured ?? "") || byName(a, b)
const labelRank = (p: Photo) => (p.label ? LABELS.indexOf(p.label) : LABELS.length)

const KEYS: Record<SortKey, (a: Photo, b: Photo) => number> = {
  captured: () => 0,
  name: byName,
  rating: (a, b) => b.rating - a.rating,
  label: (a, b) => labelRank(a) - labelRank(b),
  tagged: (a, b) => Number(b.tagged) - Number(a.tagged),
}

/** Photos in `order`. Ties keep capture order, so a RAW+JPG pair (one photo) never splits and
 *  equal ratings stay in the order they were shot. Capture time ascending is how photos are
 *  stored once their details load, so that case returns the same array. */
export function sortPhotos(photos: Photo[], order: SortOrder): Photo[] {
  if (order.key === "captured" && !order.reverse) return photos
  const key = KEYS[order.key]
  const sign = order.reverse ? -1 : 1
  return [...photos].sort((a, b) => sign * (key(a, b) || (order.key === "captured" ? byTime(a, b) : 0)) || byTime(a, b))
}

const STORE = "photoSort"

/** The order a shoot was last viewed in. */
export function savedSort(folder: string): SortOrder {
  const saved = pref<Record<string, SortOrder>>(STORE, {})[folder]
  return saved && SORT_KEYS.some((k) => k.value === saved.key) ? { key: saved.key, reverse: !!saved.reverse } : DEFAULT_SORT
}

export function saveSort(folder: string, order: SortOrder) {
  const all = pref<Record<string, SortOrder>>(STORE, {})
  if (order.key === DEFAULT_SORT.key && order.reverse === DEFAULT_SORT.reverse) delete all[folder]
  else all[folder] = order
  setPref(STORE, all)
}
