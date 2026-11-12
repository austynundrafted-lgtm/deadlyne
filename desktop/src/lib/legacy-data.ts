// Local setup import is a merge. Existing choices win, and no account/profile cache is imported.
import type { Collection, LibraryShoot, LinkedDoc } from "@/lib/library"
import type { RecentShoot } from "@/lib/recents"
type ObjectValue = Record<string, unknown>
const object = (v: unknown): v is ObjectValue => !!v && typeof v === "object" && !Array.isArray(v)
const path = (v: unknown): v is string => typeof v === "string" && v.startsWith("/") && !v.includes("\0")
const text = (v: unknown): v is string => typeof v === "string" && !v.includes("\0")
const time = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text)
const arrays = (value: unknown, key: string) => object(value) && Array.isArray(value[key]) ? value[key] as unknown[] : []
function merge<T>(current: T[], imported: T[], key: (row: T) => string): T[] {
  const result = [...current], seen = new Set(current.map(key))
  for (const row of imported) { const id = key(row); if (!seen.has(id)) { seen.add(id); result.push(row) } }
  return result
}

export function mergeLibraryData(current: { shoots: LibraryShoot[]; collections: Collection[]; links: LinkedDoc[] }, incoming: unknown) {
  const shoots = arrays(incoming, "shoots").filter((v) => object(v) && path(v.path) && time(v.addedAt) && time(v.openedAt)).map((v) => {
    const row = v as ObjectValue
    return { path: row.path as string, addedAt: row.addedAt as number, openedAt: row.openedAt as number, ...Object.fromEntries(["favorite", "pinned", "archived"].filter((key) => typeof row[key] === "boolean").map((key) => [key, row[key]])) } as LibraryShoot
  })
  const collections = arrays(incoming, "collections").filter((v) => object(v) && text(v.id) && text(v.name) && (v.parent === null || text(v.parent)) && strings(v.shoots) && v.shoots.every(path) && time(v.createdAt)).map((v) => {
    const row = v as unknown as Collection
    return { id: row.id, name: row.name, parent: row.parent, shoots: [...row.shoots], createdAt: row.createdAt }
  })
  const links = arrays(incoming, "links").filter((v) => object(v) && text(v.id) && path(v.folder) && path(v.path) && time(v.addedAt)).map((v) => {
    const row = v as unknown as LinkedDoc
    return { id: row.id, folder: row.folder, path: row.path, addedAt: row.addedAt }
  })
  return { shoots: merge(current.shoots, shoots, (s) => s.path), collections: merge(current.collections, collections, (c) => c.id), links: merge(current.links, links, (l) => l.id) }
}

export function mergeRecentData(current: RecentShoot[], incoming: unknown): RecentShoot[] {
  const rows = Array.isArray(incoming) ? incoming.filter((v) => object(v) && path(v.path) && text(v.name) && time(v.photos) && time(v.openedAt)).map((v) => ({ path: v.path as string, name: v.name as string, photos: v.photos as number, openedAt: v.openedAt as number })) : []
  return merge(current, rows, (s) => s.path).sort((a, b) => b.openedAt - a.openedAt).slice(0, 12)
}

export function importedSetting(key: string, value: unknown): unknown {
  if (key === "jpegCaptionMode") return ["xmpAndIim", "xmp", "off"].includes(value as string) ? value : undefined
  if (key === "codeDelimiter") return ["=", "\\", ";", "~", "`", "|", "^"].includes(value as string) ? value : undefined
  if (key === "codeExpandWhileTyping") return typeof value === "boolean" ? value : undefined
  if (key === "codeListsDisabled") return strings(value) ? value : undefined
  if (key === "codeColumnNames") return object(value) && Object.values(value).every(strings) ? value : undefined
  if (key === "ftpSendFiles") return ["jpeg", "raw", "both"].includes(value as string) ? value : undefined
  if (key === "ftpLastServer") return value === null || text(value) ? value : undefined
  if (key === "ftpServers") {
    if (!Array.isArray(value)) return undefined
    return value.filter((v) => object(v) && ["id", "name", "host", "username", "remoteDir"].every((k) => text(v[k])) && ["ftp", "ftps", "ftpsImplicit"].includes(v.protocol as string) && typeof v.passive === "boolean" && ["rename", "replace", "skip"].includes(v.ifExists as string) && time(v.port) && v.port > 0 && v.port <= 65535).map((v) => Object.fromEntries(["id", "name", "host", "username", "remoteDir", "protocol", "port", "passive", "ifExists"].map((k) => [k, v[k]])))
  }
  if ((key === "ingest" || key === "export") && object(value)) {
    const validators: Record<string, (v: unknown) => boolean> = {
      destination: (v) => v === null || path(v), job: text, folderPattern: text, renamePattern: text,
      renameOn: (v) => typeof v === "boolean", skipExisting: (v) => typeof v === "boolean", eject: (v) => typeof v === "boolean",
      files: (v) => ["jpeg", "raw", "both"].includes(v as string), quality: (v) => [78, 88, 95].includes(v as number), longEdge: (v) => [null, 1200, 2048, 3000, 4000].includes(v as number | null), subfolderOn: (v) => typeof v === "boolean", openWhenDone: (v) => typeof v === "boolean",
    }
    const allowed = key === "ingest" ? ["destination", "job", "folderPattern", "renameOn", "renamePattern", "skipExisting", "eject"] : ["destination", "files", "quality", "longEdge", "subfolderOn", "renameOn", "renamePattern", "openWhenDone"]
    return Object.fromEntries(Object.entries(value).filter(([k, v]) => allowed.includes(k) && validators[k](v)))
  }
  return undefined
}
