// Export: copies of the tagged photos (or the selection) into a folder, named and sized for the
// client or the desk. The Rust side (src-tauri/src/export.rs) copies, renames and resizes; JPGs
// keep their captions, credits and legacy IPTC on the way out. The originals are never touched.
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { create } from "zustand"
import type { Photo } from "@/lib/api"
import { SEND_FILES, type SendFiles } from "@/lib/ftp"
import { getSetting, setSetting } from "@/lib/settings"

/** Which half of each RAW+JPEG pair goes out. Clients and wire desks want the JPG. */
export type ExportFiles = SendFiles
export const EXPORT_FILES = SEND_FILES

/** Long edges photographers actually ask for: web/social, a wire desk, print and full size. */
export const SIZES: { value: number | null; label: string; hint: string }[] = [
  { value: null, label: "Original size", hint: "The JPG as the camera wrote it" },
  { value: 1200, label: "1200 px", hint: "Social media, email" },
  { value: 2048, label: "2048 px", hint: "Web, team sites" },
  { value: 3000, label: "3000 px", hint: "Most wire desks" },
  { value: 4000, label: "4000 px", hint: "Print, large screens" },
]

export const QUALITIES: { value: number; label: string }[] = [
  { value: 95, label: "Best" },
  { value: 88, label: "High" },
  { value: 78, label: "Smaller files" },
]

export interface ExportPrefs {
  destination: string | null
  files: ExportFiles
  /** Export into a new folder inside the destination, named after the shoot by default. */
  subfolderOn: boolean
  /** Long edge in pixels for JPGs, or null to copy them as they are. */
  longEdge: number | null
  quality: number
  renameOn: boolean
  renamePattern: string
  openWhenDone: boolean
}

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  destination: null,
  files: "jpeg",
  subfolderOn: true,
  longEdge: null,
  quality: 88,
  renameOn: false,
  renamePattern: "{shoot}_{seq}",
  openWhenDone: true,
}

export interface ExportProgress {
  filesDone: number
  filesTotal: number
  currentFile: string
}

export interface ExportSummary {
  folder: string
  files: number
  resized: number
  bytes: number
  renamed: [string, string][]
  errors: string[]
  cancelled: boolean
}

interface ExportFile {
  src: string
  name: string
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p
const extension = (p: string) => {
  const n = fileName(p)
  const i = n.lastIndexOf(".")
  return i > 0 ? n.slice(i) : ""
}

/** Tokens for renaming: `{shoot}` is the shoot folder's name, `{seq}` counts up in capture order. */
export const RENAME_TOKENS = "{shoot} {seq} {original} {date} {time} {camera}"

export function exportName(pattern: string, p: Photo, shoot: string, seq: number): string {
  const [date = "", time = ""] = (p.meta?.captured ?? "").split("T")
  const tokens: Record<string, string> = {
    "{shoot}": shoot,
    "{seq}": String(seq).padStart(4, "0"),
    "{original}": p.name,
    "{date}": date || "0000-00-00",
    "{time}": time.slice(0, 8).replace(/:/g, "") || "000000",
    "{camera}": (p.meta?.camera ?? "").replace(/\s+/g, ""),
  }
  return pattern
    .replace(/\{[a-z]+\}/g, (t) => tokens[t] ?? t)
    .replace(/[:/\\]/g, "-")
    .trim()
}

/** The files to write for each photo, with their names. A missing photo has none of the chosen files. */
export function exportItems(photos: Photo[], files: ExportFiles, rename: ((p: Photo, seq: number) => string) | null) {
  const items: { files: ExportFile[] }[] = []
  let missing = 0
  photos.forEach((p, i) => {
    const base = rename ? rename(p, i + 1) : null
    const picked: (string | null)[] = files === "jpeg" ? [p.jpeg] : files === "raw" ? [p.raw, p.raw && p.sidecar] : [p.raw, p.jpeg, p.raw && p.sidecar]
    const real = picked.filter((f): f is string => !!f)
    if (!real.length) {
      missing++
      return
    }
    items.push({ files: real.map((src) => ({ src, name: base ? base + extension(src) : fileName(src) })) })
  })
  return { items, missing, files: items.reduce((n, i) => n + i.files.length, 0) }
}

interface ExportState {
  prefs: ExportPrefs
  running: boolean
  progress: ExportProgress | null
  setPrefs: (p: Partial<ExportPrefs>) => void
  load: () => Promise<void>
}

export const useExport = create<ExportState>((set, get) => ({
  prefs: DEFAULT_EXPORT_PREFS,
  running: false,
  progress: null,
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p }
    set({ prefs })
    setSetting("export", prefs)
  },
  load: async () => {
    set({ prefs: { ...DEFAULT_EXPORT_PREFS, ...(await getSetting<Partial<ExportPrefs>>("export", {})) } })
  },
}))

export interface ExportRequest {
  photos: Photo[]
  shoot: string
  subfolder: string | null
}

/** Writes the files and resolves to what happened. Progress shows up in `useExport`. */
export async function runExport({ photos, shoot, subfolder }: ExportRequest, prefs: ExportPrefs): Promise<ExportSummary> {
  if (!prefs.destination) throw new Error("Choose a folder to export to.")
  const rename = prefs.renameOn && prefs.renamePattern.trim() ? (p: Photo, seq: number) => exportName(prefs.renamePattern, p, shoot, seq) : null
  const { items } = exportItems(photos, prefs.files, rename)
  useExport.setState({ running: true, progress: null })
  try {
    return await invoke<ExportSummary>("export_photos", {
      items,
      options: { destination: prefs.destination, subfolder, longEdge: prefs.files === "raw" ? null : prefs.longEdge, quality: prefs.quality },
    })
  } finally {
    useExport.setState({ running: false, progress: null })
  }
}

export const cancelExport = () => invoke("export_cancel")

let wired = false

/** Loads the remembered options and wires progress events once at launch. */
export async function initExport() {
  if (wired) return
  wired = true
  await useExport.getState().load()
  await listen<ExportProgress>("export-progress", (e) => useExport.setState({ progress: e.payload }))
}
