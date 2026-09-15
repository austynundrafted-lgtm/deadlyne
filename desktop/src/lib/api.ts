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

export const CAPTION_FIELDS = [
  "headline", "caption", "keywords", "event", "location", "city", "state", "country", "creator", "credit", "copyright",
] as const
export type CaptionField = (typeof CAPTION_FIELDS)[number]

export const FIELD_LABELS: Record<CaptionField, string> = {
  headline: "Headline", caption: "Caption", keywords: "Keywords", event: "Event", location: "Venue",
  city: "City", state: "State", country: "Country", creator: "Photographer", credit: "Credit", copyright: "Copyright",
}

export type Captions = Omit<Record<CaptionField, string>, "keywords"> & { keywords: string[] }

export const emptyCaptions = (): Captions => ({
  headline: "", caption: "", keywords: [], event: "", location: "", city: "", state: "", country: "", creator: "", credit: "", copyright: "",
})

export const captionValue = (c: Captions, f: CaptionField) => (f === "keywords" ? c.keywords.join(", ") : c[f])

/** "Tecumseh, football; Ohio" → ["Tecumseh", "football", "Ohio"], without duplicates. */
export function splitKeywords(s: string): string[] {
  const seen = new Set<string>()
  return s
    .split(/[,;\n]/)
    .map((k) => k.trim())
    .filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
}

/** How captions go into JPG files. RAW files always use the XMP sidecar. */
export type JpegMode = "xmpAndIim" | "xmp" | "off"
export const JPEG_MODES: { value: JpegMode; label: string }[] = [
  { value: "xmpAndIim", label: "XMP + legacy IPTC" },
  { value: "xmp", label: "XMP only (modern)" },
  { value: "off", label: "Don’t write into JPGs" },
]

export type Photo = PhotoEntry & Culling & { meta?: Meta; captions: Captions }

export function scanFolder(path: string) {
  return invoke<{ folder: string; photos: PhotoEntry[] }>("scan_folder", { path })
}

export function loadDetails(photos: PhotoEntry[]) {
  return invoke<{ meta: Meta; culling: Culling; captions: Captions }[]>("load_details", {
    photos: photos.map((p) => ({ id: p.id, sidecar: p.sidecar, raw: p.raw, jpeg: p.jpeg })),
  })
}

/** Writes caption `fields` for each photo (sidecar and/or inside the JPG). Resolves to failures. */
export function saveCaptions(photos: Photo[], fields: CaptionField[], jpegMode: JpegMode) {
  return invoke<string[]>("save_captions", {
    items: photos.map((p) => ({
      sidecar: p.sidecar,
      ext: p.id.split(".").pop()?.toUpperCase() ?? "",
      hasRaw: !!p.raw,
      jpeg: p.jpeg,
      captions: p.captions,
    })),
    fields,
    jpegMode,
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
