import { beforeEach, describe, expect, it, vi } from "vitest"

const f = vi.hoisted(() => ({
  auth: { status: "signedIn", access: "active", account: { id: "owner" }, bypassed: false, accountOperation: false, offline: false },
  stores: new Map<string, Map<string, unknown>>(),
  reply: vi.fn(), beforeSet: vi.fn(),
  calls: [] as { operation: string; payload?: Record<string, unknown>; filters: Record<string, unknown> }[],
}))
vi.mock("@/lib/auth", () => ({
  useAuth: { getState: () => f.auth },
  supabase: { from: () => {
    const request = { operation: "list", payload: undefined as Record<string, unknown> | undefined, filters: {} as Record<string, unknown> }
    const run = () => { f.calls.push(request); return f.reply(request) }
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { request.filters[key] = value; return builder },
      insert: (payload: Record<string, unknown>) => { request.operation = "insert"; request.payload = payload; return builder },
      update: (payload: Record<string, unknown>) => { request.operation = "update"; request.payload = payload; return builder },
      delete: () => { request.operation = "delete"; return builder },
      maybeSingle: run,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    }
    return builder
  } },
}))
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    data: Map<string, unknown>
    constructor(path: string) { if (!f.stores.has(path)) f.stores.set(path, new Map()); this.data = f.stores.get(path)! }
    async get(key: string) { return this.data.get(key) ?? null }
    async set(key: string, value: unknown) { await f.beforeSet(); this.data.set(key, value) }
    async delete(key: string) { this.data.delete(key) }
    async save() {}
  },
}))

const options = { folderPattern: "{date}_{job}", renameOn: true, renamePattern: "{job}_{seq}", skipExisting: true, eject: false }
const row = { id: "one", user_id: "owner", kind: "ingest" as const, name: "Game night", settings: options, version: 1 }
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); f.stores.clear(); f.calls.length = 0
  Object.assign(f.auth, { status: "signedIn", access: "active", account: { id: "owner" }, bypassed: false, accountOperation: false, offline: false })
  f.reply.mockImplementation(async (request) => ({ data: request.operation === "list" ? [] : { ...row, ...request.payload }, error: null }))
})
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }

describe("account preset synchronization", () => {
  it("sends only portable settings and uses the authenticated account as owner", async () => {
    const m = await import("./workflow-presets")
    await m.savePreset("ingest", "Game night", { ...options, destination: "/private/shoot", job: "Private job", firstSeq: 42 })
    expect(f.calls.find((c) => c.operation === "insert")?.payload).toEqual({ user_id: "owner", kind: "ingest", name: "Game night", settings: options })
    expect(m.usePresets.getState().items).toEqual([row])
  })

  it("uses an account's cached presets offline but never claims an offline change was saved", async () => {
    const m = await import("./workflow-presets")
    f.stores.get("account-presets.json")!.set("cache", { ownerId: "owner", items: [row] })
    f.auth.offline = true
    await m.refreshPresets()
    expect(m.usePresets.getState().items).toEqual([row])
    await expect(m.savePreset("ingest", "Offline", options)).rejects.toThrow(/Connect to the internet/)
    expect(f.calls).toEqual([])
  })

  it("never loads the previous account's cache for a different sign-in", async () => {
    const m = await import("./workflow-presets")
    f.stores.get("account-presets.json")!.set("cache", { ownerId: "someone-else", items: [{ ...row, user_id: "someone-else" }] })
    await m.refreshPresets()
    expect(m.usePresets.getState().items).toEqual([])
    expect(f.calls[0].filters.user_id).toBe("owner")
  })

  it("resumes synchronization after a loaded account goes offline and reconnects", async () => {
    const m = await import("./workflow-presets")
    f.reply.mockResolvedValue({ data: [row], error: null })
    await m.refreshPresets()
    f.auth.offline = true
    await m.refreshPresets()
    f.auth.offline = false
    f.reply.mockResolvedValue({ data: [{ ...row, version: 2, name: "Updated elsewhere" }], error: null })
    await m.refreshPresets()
    expect(m.usePresets.getState().items[0].name).toBe("Updated elsewhere")
    expect(f.calls).toHaveLength(2)
  })

  it("rejects stale update and delete revisions without changing the cached preset", async () => {
    const m = await import("./workflow-presets")
    f.reply.mockResolvedValueOnce({ data: [row], error: null })
    await m.refreshPresets()
    f.reply.mockResolvedValue({ data: null, error: null })
    await expect(m.savePreset("ingest", "New name", options, row)).rejects.toThrow(/changed on another device/)
    await expect(m.deletePreset(row)).rejects.toThrow(/changed on another device/)
    expect(f.calls.slice(1).every((call) => call.filters.version === 1 && call.filters.user_id === "owner")).toBe(true)
    expect(m.usePresets.getState().items).toEqual([row])
  })

  it("discards a network response that arrives after account cleanup", async () => {
    const m = await import("./workflow-presets")
    const response = deferred<object>()
    const started = deferred<void>()
    f.reply.mockImplementation(() => { started.resolve(); return response.promise })
    const refreshing = m.refreshPresets()
    await started.promise
    await m.clearPresetCache()
    response.resolve({ data: [row], error: null })
    await refreshing
    expect(m.usePresets.getState().items).toEqual([])
    expect(f.stores.get("account-presets.json")!.has("cache")).toBe(false)
  })

  it("drains an in-flight cache write before deleting account-owned cached data", async () => {
    const m = await import("./workflow-presets")
    const writing = deferred<void>(), release = deferred<void>()
    f.beforeSet.mockImplementation(async () => { writing.resolve(); await release.promise })
    f.reply.mockResolvedValue({ data: [row], error: null })
    const syncing = m.refreshPresets()
    await writing.promise
    const clearing = m.clearPresetCache()
    release.resolve()
    await Promise.all([syncing, clearing])
    expect(f.stores.get("account-presets.json")!.has("cache")).toBe(false)
    expect(m.usePresets.getState().ownerId).toBeNull()
  })

  it("deduplicates refreshes and blocks repeated saves even during the first cache load", async () => {
    const m = await import("./workflow-presets")
    const response = deferred<object>(), started = deferred<void>()
    f.reply.mockImplementationOnce(() => { started.resolve(); return response.promise })
    const first = m.savePreset("ingest", "Game night", options)
    await expect(m.savePreset("ingest", "Duplicate", options)).rejects.toThrow(/Wait for the current/)
    await started.promise
    response.resolve({ data: [], error: null })
    await first
    expect(f.calls.filter((c) => c.operation === "insert")).toHaveLength(1)
  })

  it("keeps cached presets and reports a server failure instead of erasing them", async () => {
    const m = await import("./workflow-presets")
    f.stores.get("account-presets.json")!.set("cache", { ownerId: "owner", items: [row] })
    f.reply.mockResolvedValue({ data: null, error: { code: "PGRST205" } })
    await m.refreshPresets()
    expect(m.usePresets.getState().items).toEqual([row])
    expect(m.usePresets.getState().error).toMatch(/haven’t been set up/)
    f.auth.accountOperation = true
    await expect(m.savePreset("ingest", "During deletion", options)).rejects.toThrow(/Sign in/)
  })
})
