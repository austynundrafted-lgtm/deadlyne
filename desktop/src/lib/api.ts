// Typed bridge to the Rust side (src-tauri). Everything that touches files lives there.
import { convertFileSrc, invoke } from "@tauri-apps/api/core"

export const LABELS = ["Red", "Yellow", "Green", "Blue", "Purple"] as const
export type Label = (typeof LABELS)[number]

export interface PhotoEntry {
  /** Primary file path (the RAW when there is one). */
  id: string
  name: string
  raw: string | null
  jpeg: string | null
  sidecar: string
  /** "CR3+JPG", "CR3", "JPG" */
  kind: string
}

export interface Meta {
  orientation: number
  /** Local capture time, "2026-08-22T09:45:27.07" */
  captured: string | null
  camera: string
  lens: string
  exposure: number | null
  fNumber: number | null
  iso: number | null
  focalLength: number | null
}

export interface Culling {
  rating: number
  label: Label | null
  tagged: boolean
}

export type Photo = PhotoEntry & Culling & { meta?: Meta }

export function scanFolder(path: string) {
  return invoke<{ folder: string; photos: PhotoEntry[] }>("scan_folder", { path })
}

export function loadDetails(photos: PhotoEntry[]) {
  return invoke<{ meta: Meta; culling: Culling }[]>("load_details", {
    photos: photos.map((p) => ({ id: p.id, sidecar: p.sidecar })),
  })
}

/** Writes rating, label and tag to each photo's XMP sidecar. Resolves to the files that failed. */
export function saveCulling(photos: Photo[]) {
  return invoke<string[]>("save_culling", {
    items: photos.map((p) => ({
      sidecar: p.sidecar,
      ext: p.id.split(".").pop()?.toUpperCase() ?? "",
      rating: p.rating,
      label: p.label,
      tagged: p.tagged,
    })),
  })
}

/** Small upright JPEG for the contact sheet, served by Rust over the `thumb` scheme. */
export const thumbUrl = (p: PhotoEntry) => convertFileSrc(p.id, "thumb")

/** The largest embedded JPEG, untouched (apply `meta.orientation` when showing it). */
export const previewUrl = (p: PhotoEntry) => convertFileSrc(p.id, "preview")
