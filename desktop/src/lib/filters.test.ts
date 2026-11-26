import { describe, expect, it, vi } from "vitest"

vi.mock("./auth", () => ({ fetchRemoteProfile: vi.fn(), pushRemoteProfile: vi.fn(), useAuth: {} }))
vi.mock("./settings", () => ({
  DEFAULT_COPYRIGHT: "© {year} {name}",
  getSetting: vi.fn(), setSetting: vi.fn(), setPref: vi.fn(),
  pref: (_key: string, fallback: unknown) => fallback,
}))
vi.stubGlobal("navigator", { userAgent: "Macintosh", maxTouchPoints: 0 })

const { useStore, visiblePhotos } = await import("../store")
const { emptyCaptions, photoFileName, primaryFile } = await import("./api")
const { setPref } = await import("./settings")

describe("recovering filtered photos", () => {
  it("Show all restores a JPEG-only shoot hidden by RAW scope and every other filter", () => {
    const photo = {
      id: "/scratch/TEST_0001.JPG", name: "TEST_0001", raw: null,
      jpeg: "/scratch/TEST_0001.JPG", sidecar: "/scratch/TEST_0001.xmp", kind: "JPG",
      rating: 0, tagged: false, label: null, captions: emptyCaptions(),
    }
    useStore.setState({
      photos: [photo], fileScope: "raw", tagFilter: "tagged", minRating: 5,
      labelFilter: "Red", search: "absent", unviewedOnly: true, unviewedSnapshot: new Set(["test_0001"]),
    })
    expect(visiblePhotos(useStore.getState())).toEqual([])
    useStore.getState().clearFilters()
    expect(visiblePhotos(useStore.getState())).toEqual([photo])
    expect(useStore.getState().unviewedOnly).toBe(false)
    expect(setPref).toHaveBeenCalledWith("fileScope", "both")
  })
})

describe("RAW and JPG views", () => {
  it("uses the scoped file in pairs and moves focus off photos the view hides", () => {
    const photo = (name: string, raw: string | null, jpeg: string | null) => ({
      id: (raw ?? jpeg)!, name, raw, jpeg, sidecar: "/scratch/frame.xmp", kind: "CR3+JPG",
      rating: 0, tagged: false, label: null, captions: emptyCaptions(),
    })
    const raw = photo("solo.CR3", "/scratch/solo.CR3", null)
    const pair = photo("pair.CR3", "/scratch/pair.CR3", "/scratch/PAIR.JPG")
    const jpeg = photo("still.JPG", null, "/scratch/still.JPG")
    useStore.setState(useStore.getInitialState(), true)
    useStore.setState({ photos: [raw, pair, jpeg], selected: new Set([raw.id]), focus: raw.id, anchor: raw.id })

    useStore.getState().setFilter({ fileScope: "jpeg" })
    const jpgView = useStore.getState()
    expect(visiblePhotos(jpgView)).toEqual([pair, jpeg])
    expect(jpgView.focus).toBe(pair.id)
    expect(jpgView.selected).toEqual(new Set([pair.id]))
    expect(primaryFile(pair, jpgView.fileScope)).toBe(pair.jpeg)
    expect(photoFileName(pair, jpgView.fileScope)).toBe("PAIR.JPG")
    expect(visiblePhotos({ ...jpgView, search: ".cr3" })).toEqual([])

    jpgView.setFilter({ fileScope: "raw" })
    const rawView = useStore.getState()
    expect(visiblePhotos(rawView)).toEqual([raw, pair])
    expect(rawView.focus).toBe(pair.id)
    expect(primaryFile(pair, rawView.fileScope)).toBe(pair.raw)
    expect(photoFileName(pair, rawView.fileScope)).toBe("pair.CR3")
  })
})
