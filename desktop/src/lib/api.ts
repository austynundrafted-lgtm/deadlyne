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
  "title", "bylineTitle", "source", "instructions", "jobId", "captionWriter", "countryCode", "usageTerms",
] as const
export type CaptionField = (typeof CAPTION_FIELDS)[number]

export const FIELD_LABELS: Record<CaptionField, string> = {
  headline: "Headline", caption: "Caption", keywords: "Keywords", event: "Event", location: "Venue",
  city: "City", state: "State", country: "Country", creator: "Photographer", credit: "Credit", copyright: "Copyright",
  title: "Object name", bylineTitle: "Photographer title", source: "Source", instructions: "Special instructions",
  jobId: "Job ID", captionWriter: "Caption writer", countryCode: "Country code", usageTerms: "Usage terms",
}

export type Captions = Omit<Record<CaptionField, string>, "keywords"> & { keywords: string[] }

export const emptyCaptions = (): Captions => ({
  headline: "", caption: "", keywords: [], event: "", location: "", city: "", state: "", country: "", creator: "", credit: "", copyright: "",
  title: "", bylineTitle: "", source: "", instructions: "", jobId: "", captionWriter: "", countryCode: "", usageTerms: "",
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

// MARK: - Files

/** Which half of a RAW+JPEG pair copy/move/trash act on. */
export type FileScope = "both" | "raw" | "jpeg"
export const FILE_SCOPES: { value: FileScope; label: string }[] = [
  { value: "both", label: "RAW + JPG" },
  { value: "raw", label: "RAW only" },
  { value: "jpeg", label: "JPG only" },
]

/** The files an action on `p` touches. The sidecar travels with the RAW; a JPG carries its own captions. */
export function filesFor(p: PhotoEntry, scope: FileScope): string[] {
  if (scope === "raw") return p.raw ? [p.raw, p.sidecar] : []
  if (scope === "jpeg") return p.jpeg ? [p.jpeg] : []
  return [p.raw, p.jpeg, p.sidecar].filter((f): f is string => !!f)
}

export interface FileOutcome {
  completed: string[]
  files: number
  skipped: number
  errors: string[]
}

export function transferPhotos(photos: PhotoEntry[], scope: FileScope, destination: string, moveFiles: boolean) {
  const items = photos.map((p) => ({ id: p.id, files: filesFor(p, scope) })).filter((i) => i.files.length)
  return invoke<FileOutcome>("transfer_photos", { items, destination, moveFiles })
}

export function trashPhotos(photos: PhotoEntry[], scope: FileScope) {
  const items = photos.map((p) => ({ id: p.id, files: filesFor(p, scope) })).filter((i) => i.files.length)
  return invoke<FileOutcome>("trash_photos", { items })
}

export const reveal = (path: string) => invoke("reveal", { path })

// MARK: - Ingest

export interface Card {
  path: string
  name: string
}
export interface SourceInfo {
  camera: string
  photos: number
  bytes: number
}
export interface IngestOptions {
  source: string
  destination: string
  job: string
  folderPattern: string
  renamePattern: string | null
  firstSeq: number
  skipExisting: boolean
  eject: boolean
}
export interface IngestProgress {
  filesDone: number
  filesTotal: number
  bytesDone: number
  bytesTotal: number
  currentFile: string
}
export interface IngestSummary {
  copied: number
  skipped: number
  bytes: number
  errors: string[]
  firstFolder: string | null
  cancelled: boolean
  ejected: boolean
  unlocked: Badge[]
}

export const memoryCards = () => invoke<Card[]>("memory_cards")
export const inspectSource = (path: string) => invoke<SourceInfo>("inspect_source", { path })
export const freeSpace = (path: string) => invoke<number | null>("free_space", { path })
export const startIngest = (options: IngestOptions) => invoke("start_ingest", { options })
export const cancelIngest = () => invoke("cancel_ingest")

// MARK: - Badges

export interface Badge {
  id: string
  track: "photos" | "shoots"
  threshold: number
  name: string
  tier: number
}
export interface AchievementSummary {
  photos: number
  shoots: number
  month: { photos: number; shoots: number }
  badges: Badge[]
  earned: Record<string, number>
}

export const achievements = () => invoke<AchievementSummary>("achievements")
export const recordFolderOpened = (folder: string, photos: number) => invoke<Badge[]>("record_folder_opened", { folder, photos })

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1024
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
