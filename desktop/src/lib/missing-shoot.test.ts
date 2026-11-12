import { beforeEach, describe, expect, it, vi } from "vitest"

const f = vi.hoisted(() => ({ invoke: vi.fn(), pick: vi.fn(), error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: f.invoke, convertFileSrc: vi.fn() }))
vi.mock("@tauri-apps/plugin-store", () => ({ LazyStore: class {
  async get() { return null }
  async set() {}
  async save() {}
} }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: f.error, success: f.success, dismiss: f.dismiss }) }))
vi.mock("./platform", () => ({ pickFolder: f.pick, pickFiles: vi.fn(), preview: vi.fn(), share: vi.fn(), authorizeFolder: async () => true }))
vi.mock("./auth", () => ({ fetchRemoteProfile: vi.fn(), pushRemoteProfile: vi.fn(), useAuth: {} }))
vi.mock("./settings", () => ({
  DEFAULT_COPYRIGHT: "© {year} {name}", getSetting: vi.fn(), setSetting: vi.fn(), setPref: vi.fn(),
  pref: (_key: string, fallback: unknown) => fallback,
}))
vi.stubGlobal("navigator", { userAgent: "Macintosh", maxTouchPoints: 0 })

const { useStore } = await import("../store")
const { useLibrary } = await import("./library")
const { openShoot } = await import("./folders")

const stats = (path: string, exists: boolean) => ({
  path, exists, error: null, photos: 0, viewed: 0, totalPhotos: 0, totalViewed: 0, subfolders: 0, documents: 0, modified: null,
})
/** The folders that exist on the pretend disk right now. */
let onDisk = new Set<string>()
const scanned = () => f.invoke.mock.calls.filter(([command]) => command === "scan_folder").map(([, args]) => args.path)

beforeEach(() => {
  vi.clearAllMocks()
  onDisk = new Set()
  useStore.setState(useStore.getInitialState(), true)
  useLibrary.setState(useLibrary.getInitialState(), true)
  f.invoke.mockImplementation(async (command, args) => {
    if (command === "folder_stats") return args.paths.map((p: string) => stats(p, onDisk.has(p)))
    if (command === "scan_folder") return { folder: args.path, photos: [] }
    if (command === "viewing_load") return { viewed: [], last: null }
    if (command === "folder_contents") return { subfolders: [], documents: [] }
    if (command === "load_details") return []
    return undefined
  })
})

describe("opening a shoot whose folder has gone missing", () => {
  it("stays where you are and offers to locate it, without asking the disk to open it", async () => {
    useLibrary.setState({ stats: { "/shoots/Gone": stats("/shoots/Gone", false) } })
    await openShoot("/shoots/Gone", { kind: "recent" })
    expect(scanned()).toEqual([])
    expect(useStore.getState().workspace).toBe("home")
    expect(f.error).toHaveBeenCalledExactlyOnceWith("Can’t find “Gone”", expect.objectContaining({
      id: "missing:/shoots/Gone",
      description: expect.stringContaining("drive isn’t connected"),
      action: expect.objectContaining({ label: "Locate…" }),
    }))
  })

  it("opens normally once its drive is back, even though the library last saw it missing", async () => {
    useLibrary.setState({ stats: { "/shoots/Back": stats("/shoots/Back", false) } })
    onDisk.add("/shoots/Back")
    await openShoot("/shoots/Back", { kind: "recent" })
    expect(f.error).not.toHaveBeenCalled()
    // A message left from the earlier try doesn't linger over the open shoot.
    expect(f.dismiss).toHaveBeenCalledWith("missing:/shoots/Back")
    expect(scanned()).toEqual(["/shoots/Back"])
    expect(useStore.getState().folder).toBe("/shoots/Back")
  })

  it("opens a shoot the library has no record of yet", async () => {
    await openShoot("/shoots/New")
    expect(f.error).not.toHaveBeenCalled()
    expect(scanned()).toEqual(["/shoots/New"])
  })

  it("Locate… points the library at the new place and then opens it", async () => {
    useLibrary.setState({
      shoots: [{ path: "/shoots/Gone", addedAt: 1, openedAt: 1, favorite: true }],
      stats: { "/shoots/Gone": stats("/shoots/Gone", false) },
    })
    await openShoot("/shoots/Gone", { kind: "favorites" })
    onDisk.add("/archive/Gone")
    f.pick.mockResolvedValue("/archive/Gone")
    await f.error.mock.calls[0][1].action.onClick()
    expect(f.pick).toHaveBeenCalledExactlyOnceWith("Where is “Gone” now?")
    expect(useLibrary.getState().shoots.map((s) => [s.path, s.favorite])).toEqual([["/archive/Gone", true]])
    expect(scanned()).toEqual(["/archive/Gone"])
    expect(useStore.getState()).toMatchObject({ folder: "/archive/Gone", origin: { kind: "favorites" } })
  })

  it("cancelling Locate… changes nothing", async () => {
    useLibrary.setState({ shoots: [{ path: "/shoots/Gone", addedAt: 1, openedAt: 1 }], stats: { "/shoots/Gone": stats("/shoots/Gone", false) } })
    await openShoot("/shoots/Gone")
    f.pick.mockResolvedValue(null)
    await f.error.mock.calls[0][1].action.onClick()
    expect(useLibrary.getState().shoots.map((s) => s.path)).toEqual(["/shoots/Gone"])
    expect(scanned()).toEqual([])
  })
})
