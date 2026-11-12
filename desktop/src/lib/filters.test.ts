import { describe, expect, it, vi } from "vitest"

vi.mock("./auth", () => ({ fetchRemoteProfile: vi.fn(), pushRemoteProfile: vi.fn(), useAuth: {} }))
vi.mock("./settings", () => ({
  DEFAULT_COPYRIGHT: "© {year} {name}",
  getSetting: vi.fn(), setSetting: vi.fn(), setPref: vi.fn(),
  pref: (_key: string, fallback: unknown) => fallback,
}))
vi.stubGlobal("navigator", { userAgent: "Macintosh", maxTouchPoints: 0 })

const { useStore, visiblePhotos } = await import("../store")
const { emptyCaptions } = await import("./api")
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
