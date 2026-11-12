import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const f = vi.hoisted(() => ({ invoke: vi.fn(), set: vi.fn(), save: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: f.invoke, convertFileSrc: vi.fn() }))
vi.mock("@tauri-apps/plugin-store", () => ({ LazyStore: class {
  async get() { return null }
  async set(...args: unknown[]) { f.set(...args) }
  async save() { f.save() }
} }))
vi.mock("./auth", () => ({ fetchRemoteProfile: vi.fn(), pushRemoteProfile: vi.fn(), useAuth: {} }))
vi.mock("./settings", () => ({
  DEFAULT_COPYRIGHT: "© {year} {name}", getSetting: vi.fn(), setSetting: vi.fn(), setPref: vi.fn(),
  pref: (_key: string, fallback: unknown) => fallback,
}))
vi.stubGlobal("navigator", { userAgent: "Macintosh", maxTouchPoints: 0 })

const { useStore } = await import("../store")
const { emptyCaptions } = await import("./api")
const { useLibrary } = await import("./library")
const { useFtp, newServer } = await import("./ftp")
const folders = await import("./folders")
const { answerConfirmation, cancelPrompts, usePrompts } = await import("./prompts")
const photo = (n: number) => ({
  id: `/scratch/IMG_${n}.CR3`, name: `IMG_${n}.CR3`, raw: `/scratch/IMG_${n}.CR3`, jpeg: `/scratch/IMG_${n}.JPG`,
  sidecar: `/scratch/IMG_${n}.xmp`, kind: "CR3+JPG", tagged: false, rating: 0, label: null, captions: emptyCaptions(),
})
const answer = (ok: boolean) => answerConfirmation(usePrompts.getState().confirm!, ok)

beforeEach(() => {
  cancelPrompts(); vi.clearAllMocks()
  useStore.setState(useStore.getInitialState(), true)
  useLibrary.setState(useLibrary.getInitialState(), true)
  useFtp.setState(useFtp.getInitialState(), true)
  const photos = [photo(1), photo(2)]
  useStore.setState({ folder: "/scratch", photos, selected: new Set([photos[0].id]), focus: photos[0].id, fileScope: "both", busy: null })
  f.invoke.mockImplementation(async (command, args) => command === "trash_photos" ? {
    completed: args.items.map((p: { id: string }) => p.id), files: args.items.length, errors: [], skipped: 0,
  } : undefined)
})
afterEach(cancelPrompts)

describe("photo deletion", () => {
  it("does not touch files until approved; cancelling preserves the photo and loupe", async () => {
    useStore.setState({ loupe: true })
    const pending = useStore.getState().trash([photo(1)])
    expect(usePrompts.getState().confirm?.title).toBe("Are you sure you want to delete this photo?")
    expect(usePrompts.getState().confirm?.description).toContain("IMG_1.CR3")
    expect(f.invoke).not.toHaveBeenCalled()
    answer(false); await pending
    expect(f.invoke).not.toHaveBeenCalled()
    expect(useStore.getState().photos).toHaveLength(2)
    expect(useStore.getState().loupe).toBe(true)
  })

  it("deletes exactly the approved selection and file scope, once", async () => {
    const pending = useStore.getState().trash([photo(1)])
    const request = usePrompts.getState().confirm!
    await useStore.getState().trash([photo(2)]) // repeated shortcut cannot redirect the first request
    useStore.setState({ selected: new Set([photo(2).id]), focus: photo(2).id, fileScope: "jpeg" })
    answerConfirmation(request, true); answerConfirmation(request, true)
    await pending
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith("trash_photos", { items: [{ id: photo(1).id, files: [photo(1).raw, photo(1).jpeg, photo(1).sidecar] }] })
    expect(useStore.getState().photos.map((p) => p.id)).toEqual([photo(2).id])
  })

  it("abandons a stale request if the open folder changes", async () => {
    const pending = useStore.getState().trash([photo(1)])
    useStore.setState({ folder: "/another-shoot" })
    answer(true); await pending
    expect(f.invoke).not.toHaveBeenCalled()
  })

  it("bulk confirmation states the photo count", async () => {
    const pending = useStore.getState().trash([photo(1), photo(2)])
    expect(usePrompts.getState().confirm?.title).toContain("2 photos")
    answer(false); await pending
    expect(f.invoke).not.toHaveBeenCalled()
  })
})

describe("other deletion and removal entry points", () => {
  it("keeps collections and their children until confirmation", async () => {
    const parent = { id: "parent", name: "Game", parent: null, shoots: ["/scratch"], createdAt: 0 }
    const child = { ...parent, id: "child", parent: "parent" }
    useLibrary.setState({ collections: [parent, child] })
    const canceled = folders.deleteCollection("parent")
    expect(useLibrary.getState().collections).toHaveLength(2)
    answer(false); await canceled
    expect(useLibrary.getState().collections).toHaveLength(2)
    const approved = folders.deleteCollection("parent")
    answer(true); await approved
    expect(useLibrary.getState().collections).toEqual([])
    expect(f.invoke).not.toHaveBeenCalled()
  })

  it("keeps a linked document on Cancel and never trashes its external file", async () => {
    const doc = { path: "/outside/Brief.pdf", name: "Brief.pdf", ext: "pdf", size: 1, modified: null, exists: true, linkId: "link" }
    useLibrary.setState({ links: [{ id: "link", folder: "/scratch", path: doc.path, addedAt: 0 }] })
    useStore.setState({ refreshContents: vi.fn().mockResolvedValue(undefined) })
    const canceled = folders.removeDoc(doc)
    answer(false); await canceled
    expect(useLibrary.getState().links).toHaveLength(1)
    const approved = folders.removeDoc(doc)
    answer(true); await approved
    expect(useLibrary.getState().links).toEqual([])
    expect(f.invoke).not.toHaveBeenCalled()
  })

  it.each(["folder", "document", "library", "recents", "collection membership"])("Cancel preserves %s", async (kind) => {
    useLibrary.setState({ collections: [{ id: "game", name: "Game", parent: null, shoots: ["/scratch"], createdAt: 0 }] })
    const pending = kind === "folder" ? folders.trashFolder("/scratch")
      : kind === "document" ? folders.removeDoc({ path: "/scratch/Brief.pdf", name: "Brief.pdf", ext: "pdf", size: 1, modified: null, exists: true })
      : kind === "library" ? folders.removeFromLibrary("/scratch")
      : kind === "recents" ? folders.removeRecentShoot("/scratch") : folders.removeFromCollection("game", "/scratch")
    expect(usePrompts.getState().confirm).not.toBeNull()
    answer(false); await pending
    expect(f.invoke).not.toHaveBeenCalled()
    expect(f.set).not.toHaveBeenCalled()
    expect(useLibrary.getState().collections[0].shoots).toEqual(["/scratch"])
  })

  it("does not remove FTP settings or its password without confirmation", async () => {
    const server = { ...newServer(), id: "desk", name: "Desk" }
    useFtp.setState({ servers: [server] })
    const pending = useFtp.getState().removeServer("desk")
    expect(f.invoke).not.toHaveBeenCalled()
    answer(false)
    expect(await pending).toBe(false)
    expect(useFtp.getState().servers).toEqual([server])
    const approved = useFtp.getState().removeServer("desk")
    answer(true)
    expect(await approved).toBe(true)
    expect(useFtp.getState().servers).toEqual([])
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith("ftp_set_password", { id: "desk", password: "" })
  })

  it("only clears the finished send records the user approved", async () => {
    const job = { id: "old", server: newServer(), files: [], photos: 1, status: "done" as const, progress: null, summary: null, started: 0 }
    useFtp.setState({ jobs: [job] })
    const canceled = useFtp.getState().clearFinished()
    answer(false); await canceled
    expect(useFtp.getState().jobs).toEqual([job])
    const approved = useFtp.getState().clearFinished()
    const newlyFinished = { ...job, id: "new" }
    useFtp.setState({ jobs: [job, newlyFinished] })
    answer(true); await approved
    expect(useFtp.getState().jobs).toEqual([newlyFinished])
    expect(f.invoke).not.toHaveBeenCalled()
  })
})
