import { describe, expect, it, vi } from "vitest"
import type { Photo } from "./api"

vi.mock("./settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }))
vi.stubGlobal("navigator", { userAgent: "Macintosh", maxTouchPoints: 0 })

const { exportName, exportItems } = await import("./export")
const { emptyCaptions } = await import("./api")

const pair: Photo = {
  id: "/scratch/MCD_0001.CR3", name: "MCD_0001.CR3", raw: "/scratch/MCD_0001.CR3",
  jpeg: "/scratch/MCD_0001.JPG", sidecar: "/scratch/MCD_0001.xmp", kind: "CR3+JPG",
  rating: 0, tagged: false, label: null, captions: emptyCaptions(),
}

describe("export naming", () => {
  it("keeps one shared stem and exactly one extension for RAW, JPG and sidecar", () => {
    const rename = (p: Photo, seq: number) => exportName("{original}_{seq}", p, "Game", seq)
    const { items } = exportItems([pair], "both", rename)
    expect(items[0].files.map((f) => f.name)).toEqual(["MCD_0001_0001.CR3", "MCD_0001_0001.JPG", "MCD_0001_0001.xmp"])
  })

  it("keeps the JPG's original name when renaming is off, or uses its stem when on", () => {
    const jpg: Photo = { ...pair, id: pair.jpeg!, name: "MCD_0001.JPG", raw: null, kind: "JPG" }
    expect(exportItems([jpg], "jpeg", null).items[0].files[0].name).toBe("MCD_0001.JPG")
    expect(exportItems([jpg], "jpeg", (p) => exportName("{original}", p, "Game", 1)).items[0].files[0].name).toBe("MCD_0001.JPG")
  })
})
