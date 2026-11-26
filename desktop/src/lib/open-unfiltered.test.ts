import { beforeEach, describe, expect, it, vi } from "vitest"

const f = vi.hoisted(() => ({ invoke: vi.fn(), setPref: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: f.invoke, convertFileSrc: vi.fn() }))
vi.mock("@tauri-apps/plugin-store", () => ({ LazyStore: class {
  async get() { return null }
  async set() {}
  async save() {}
} }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) }))
vi.mock("./platform", () => ({ pickFolder: vi.fn(), pickFiles: vi.fn(), preview: vi.fn(), share: vi.fn(), authorizeFolder: async () => true }))
vi.mock("./auth", () => ({ fetchRemoteProfile: vi.fn(), pushRemoteProfile: vi.fn(), useAuth: {} }))
vi.mock("./settings", () => ({
  DEFAULT_COPYRIGHT: "© {year} {name}", getSetting: vi.fn(), setSetting: vi.fn(), setPref: f.setPref,
  pref: (_key: string, fallback: unknown) => fallback,
}))
vi.stubGlobal("navigator", { userAgent: "Macintosh", maxTouchPoints: 0 })

const { useStore, visiblePhotos } = await import("../store")

/** A card with one RAW + JPG pair and one JPG on its own. */
const entries = (folder: string) => [
  { id: `${folder}/MCD_0001.CR3`, name: "MCD_0001.CR3", raw: `${folder}/MCD_0001.CR3`, jpeg: `${folder}/MCD_0001.JPG`, sidecar: `${folder}/MCD_0001.xmp`, kind: "CR3+JPG" },
  { id: `${folder}/MCD_0002.JPG`, name: "MCD_0002.JPG", raw: null, jpeg: `${folder}/MCD_0002.JPG`, sidecar: `${folder}/MCD_0002.xmp`, kind: "JPG" },
]

beforeEach(() => {
  vi.clearAllMocks()
  useStore.setState(useStore.getInitialState(), true)
  f.invoke.mockImplementation(async (command, args) => {
    if (command === "scan_folder") return { folder: args.path, photos: entries(args.path) }
    if (command === "viewing_load") return { viewed: [], last: null }
    if (command === "folder_contents") return { subfolders: [], documents: [] }
    if (command === "load_details") return []
    return undefined
  })
})

describe("opening a shoot", () => {
  it("shows every photo even after RAW only was chosen in another shoot", async () => {
    await useStore.getState().openFolder("/shoots/Last-Week")
    useStore.getState().setFilter({ fileScope: "raw", tagFilter: "tagged" })

    await useStore.getState().openFolder("/shoots/Fresh-Card")
    const s = useStore.getState()
    expect(s.fileScope).toBe("both")
    expect(s.tagFilter).toBe("all")
    expect(visiblePhotos(s)).toHaveLength(2)
    expect(f.setPref).toHaveBeenLastCalledWith("fileScope", "both")
  })

  it("keeps the RAW/JPG view when the same shoot reloads after a move or rename", async () => {
    await useStore.getState().openFolder("/shoots/Game")
    useStore.getState().setFilter({ fileScope: "jpeg" })
    await useStore.getState().openFolder("/shoots/Game")
    expect(useStore.getState().fileScope).toBe("jpeg")
  })
})
