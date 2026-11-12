import { describe, expect, it } from "vitest"
import { presetName, presetOptions, readPreset } from "./preset-options"

const ingest = { destination: "/private/shoots", source: "/Volumes/CARD", job: "Private job", firstSeq: 42, folderPattern: "{date}_{job}", renameOn: true, renamePattern: "{job}_{seq}", skipExisting: true, eject: false }
const exported = { destination: "/private/client", files: "jpeg", subfolderOn: true, longEdge: 3000, quality: 88, renameOn: true, renamePattern: "{shoot}_{seq}", openWhenDone: true }

describe("portable account presets", () => {
  it("excludes device paths, sources, jobs, sequence numbers and unrelated data", () => {
    const options = presetOptions("ingest", { ...ingest, ftpPassword: "secret", photos: ["private"] })
    expect(options).toEqual({ folderPattern: "{date}_{job}", renameOn: true, renamePattern: "{job}_{seq}", skipExisting: true, eject: false })
    expect(presetOptions("export", exported)).not.toHaveProperty("destination")
    expect({ ...ingest, ...options }).toMatchObject({ destination: "/private/shoots", job: "Private job", firstSeq: 42 })
  })

  it("rejects malformed remote settings instead of changing the export behavior", () => {
    for (const patch of [{ quality: 999 }, { files: "replace" }, { longEdge: -1 }, { renameOn: "false" }, { renamePattern: "/Users/private" }, { renamePattern: "bad\\name" }]) {
      expect(() => presetOptions("export", { ...exported, ...patch })).toThrow()
    }
    expect(() => presetOptions("ingest", { ...ingest, folderPattern: "" })).toThrow()
    expect(presetOptions("export", { ...exported, longEdge: null }).longEdge).toBeNull()
  })

  it("validates names and never reads another account's cached preset", () => {
    expect(presetName("  Wire desk  ")).toBe("Wire desk")
    for (const name of [" ", "x".repeat(81), "bad\nname"]) expect(() => presetName(name)).toThrow()
    const row = { id: "preset", user_id: "owner", kind: "export", name: "Wire", version: 1, settings: exported }
    expect(readPreset(row, "owner").settings).not.toHaveProperty("destination")
    expect(() => readPreset(row, "someone-else")).toThrow()
  })
})
