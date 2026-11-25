import { describe, expect, it, vi } from "vitest"

const prefs = new Map<string, unknown>()
vi.mock("./settings", () => ({
  pref: (key: string, fallback: unknown) => (prefs.has(key) ? structuredClone(prefs.get(key)) : fallback),
  setPref: (key: string, value: unknown) => prefs.set(key, structuredClone(value)),
}))

const { emptyCaptions } = await import("./api")
const { DEFAULT_SORT, saveSort, savedSort, sortPhotos } = await import("./sort")

const photo = (name: string, captured: string, extra: Record<string, unknown> = {}) => ({
  id: `/scratch/${name}.CR3`, name: `${name}.CR3`, raw: `/scratch/${name}.CR3`, jpeg: `/scratch/${name}.JPG`,
  sidecar: `/scratch/${name}.xmp`, kind: "CR3+JPG", rating: 0, tagged: false, label: null,
  captions: emptyCaptions(), meta: { captured }, ...extra,
}) as unknown as Parameters<typeof sortPhotos>[0][number]

const names = (list: { name: string }[]) => list.map((p) => p.name.replace(".CR3", ""))

describe("contact sheet order", () => {
  const a = photo("MCD_0010", "2026:11:20 19:00:03", { rating: 3, label: "Green" })
  const b = photo("MCD_0002", "2026:11:20 19:00:01", { tagged: true, label: "Red" })
  const c = photo("MCD_0100", "2026:11:20 19:00:02", { rating: 3, tagged: true })
  const shot = [b, c, a]

  it("keeps capture order as the same array, so the default costs nothing", () => {
    expect(sortPhotos(shot, DEFAULT_SORT)).toBe(shot)
    expect(names(sortPhotos(shot, { key: "captured", reverse: true }))).toEqual(["MCD_0010", "MCD_0100", "MCD_0002"])
  })

  it("compares file names numerically", () => {
    expect(names(sortPhotos(shot, { key: "name", reverse: false }))).toEqual(["MCD_0002", "MCD_0010", "MCD_0100"])
  })

  it("breaks ties in capture order and never mutates the list", () => {
    const before = [...shot]
    expect(names(sortPhotos(shot, { key: "rating", reverse: false }))).toEqual(["MCD_0100", "MCD_0010", "MCD_0002"])
    expect(names(sortPhotos(shot, { key: "tagged", reverse: false }))).toEqual(["MCD_0002", "MCD_0100", "MCD_0010"])
    expect(names(sortPhotos(shot, { key: "label", reverse: false }))).toEqual(["MCD_0002", "MCD_0010", "MCD_0100"])
    expect(shot).toEqual(before)
  })

  it("remembers each shoot's order and forgets the default", () => {
    saveSort("/scratch/game", { key: "rating", reverse: true })
    expect(savedSort("/scratch/game")).toEqual({ key: "rating", reverse: true })
    expect(savedSort("/scratch/other")).toEqual(DEFAULT_SORT)
    saveSort("/scratch/game", DEFAULT_SORT)
    expect(prefs.get("photoSort")).toEqual({})
  })
})
