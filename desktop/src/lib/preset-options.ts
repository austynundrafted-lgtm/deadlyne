// Only portable workflow choices belong to an account. Paths, cards, job names and sequence
// counters always stay on the device. Keep this allowlist in step with the database constraint.
import type { ExportPrefs } from "@/lib/export"

export type PresetKind = "ingest" | "export"
export interface IngestPresetOptions {
  folderPattern: string
  renameOn: boolean
  renamePattern: string
  skipExisting: boolean
  eject: boolean
}
export type ExportPresetOptions = Pick<ExportPrefs, "files" | "subfolderOn" | "longEdge" | "quality" | "renameOn" | "renamePattern" | "openWhenDone">
export interface PresetOptions {
  ingest: IngestPresetOptions
  export: ExportPresetOptions
}
export type WorkflowPreset = {
  [K in PresetKind]: { id: string; user_id: string; kind: K; name: string; settings: PresetOptions[K]; version: number }
}[PresetKind]

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid preset settings.")
  return value as Record<string, unknown>
}
const pattern = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 240 || /[\\/\u0000-\u001f]/.test(value)) throw new Error("Use a naming pattern of 1–240 characters without slashes or control characters.")
  return value
}
const flag = (value: unknown): boolean => {
  if (typeof value !== "boolean") throw new Error("Invalid preset option.")
  return value
}

/** Validate and copy only allowed fields, even when called with the full device preferences. */
export function presetOptions<K extends PresetKind>(kind: K, input: unknown): PresetOptions[K] {
  const p = object(input)
  const naming = { renameOn: flag(p.renameOn), renamePattern: pattern(p.renamePattern) }
  if (kind === "ingest") {
    return { folderPattern: pattern(p.folderPattern), ...naming, skipExisting: flag(p.skipExisting), eject: flag(p.eject) } as PresetOptions[K]
  }
  if (!["jpeg", "raw", "both"].includes(p.files as string) || ![null, 1200, 2048, 3000, 4000].includes(p.longEdge as number | null) || ![78, 88, 95].includes(p.quality as number)) throw new Error("Invalid export preset options.")
  return { files: p.files, longEdge: p.longEdge, quality: p.quality, ...naming, subfolderOn: flag(p.subfolderOn), openWhenDone: flag(p.openWhenDone) } as PresetOptions[K]
}

export function presetName(value: string): string {
  const name = value.trim()
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error("Use a preset name of 1–80 characters.")
  return name
}

export function readPreset(input: unknown, userId: string): WorkflowPreset {
  const p = object(input)
  if (typeof p.id !== "string" || p.user_id !== userId || (p.kind !== "ingest" && p.kind !== "export") || typeof p.name !== "string" || !Number.isSafeInteger(p.version) || (p.version as number) < 1) throw new Error("Invalid account preset.")
  return { id: p.id, user_id: userId, kind: p.kind, name: presetName(p.name), settings: presetOptions(p.kind, p.settings), version: p.version as number } as WorkflowPreset
}
