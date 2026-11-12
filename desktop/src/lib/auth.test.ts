import { beforeEach, describe, expect, it, vi } from "vitest"

const f = vi.hoisted(() => ({
  stores: new Map<string, Map<string, unknown>>(), getUser: vi.fn(), from: vi.fn(), setPhotoState: vi.fn(), signOut: vi.fn(), beforeSet: vi.fn(),
}))
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    data: Map<string, unknown>
    constructor(path: string) {
      if (!f.stores.has(path)) f.stores.set(path, new Map())
      this.data = f.stores.get(path)!
    }
    async get(key: string) { return this.data.get(key) ?? null }
    async set(key: string, value: unknown) { await f.beforeSet(key); this.data.set(key, value) }
    async delete(key: string) { this.data.delete(key) }
    async keys() { return [...this.data.keys()] }
    async save() {}
  },
}))
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: f.getUser, signOut: f.signOut }, from: f.from }),
  isAuthApiError: (error: { auth?: boolean }) => error.auth === true,
  isAuthRetryableFetchError: () => false,
}))
vi.mock("@/store", () => ({ useStore: { setState: f.setPhotoState } }))

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); f.stores.clear()
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.invalid")
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-test-key")
  f.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null })
  f.signOut.mockResolvedValue({ error: null })
})

async function fixture() {
  const m = await import("./auth")
  m.useAuth.setState({ status: "signedIn", access: "active", account: { id: "owner", email: "owner@example.invalid" } })
  const auth = f.stores.get("auth.json")!
  const settings = f.stores.get("settings.json")!
  auth.set("deadlyne-auth", { access_token: "private-token" })
  auth.set("deadlyne-auth-user", { id: "owner" })
  auth.set("deadlyne-verified", { userId: "owner", at: Date.now(), access: "active" })
  auth.set("deadlyne-deletion-request", { requestToken: "receipt-proof" })
  settings.set("profile", { name: "Private name", credit: "Private credit" })
  settings.set("recentShoots", [{ path: "/user-owned/shoot" }])
  settings.set("ftpServers", [{ id: "independent-server" }])
  settings.set("jpegCaptionMode", "xmpAndIim")
  await import("./workflow-presets")
  f.stores.get("account-presets.json")!.set("cache", { ownerId: "owner", items: [] })
  return { m, auth, settings }
}

describe("account credential cleanup and other devices", () => {
  it("removes tokens and personal profile while preserving workflow settings and recovery proof", async () => {
    const { m, auth, settings } = await fixture()
    await m.clearAccountLocal("Account deleted")
    expect([...auth.keys()]).toEqual(["deadlyne-deletion-request"])
    expect(settings.has("profile")).toBe(false)
    expect(settings.get("recentShoots")).toEqual([{ path: "/user-owned/shoot" }])
    expect(settings.get("ftpServers")).toEqual([{ id: "independent-server" }])
    expect(settings.get("jpegCaptionMode")).toBe("xmpAndIim")
    expect(f.stores.get("account-presets.json")!.has("cache")).toBe(false)
    expect(f.setPhotoState).toHaveBeenCalledWith({ profile: null, captionClipboard: null })
    expect(m.useAuth.getState().status).toBe("signedOut")
  })

  it("clears a cached login and profile when another device has deleted the account", async () => {
    const { m, auth, settings } = await fixture()
    f.getUser.mockResolvedValue({ data: { user: null }, error: { auth: true, status: 403, code: "user_not_found" } })
    await m.useAuth.getState().refreshAccess()
    expect(m.useAuth.getState().account).toBeNull()
    expect(auth.has("deadlyne-verified")).toBe(false)
    expect(settings.has("profile")).toBe(false)
    expect(f.from).not.toHaveBeenCalled()
  })

  it("preserves the existing offline grace without extending its last verification", async () => {
    const { m, auth } = await fixture()
    const verified = auth.get("deadlyne-verified")
    f.getUser.mockResolvedValue({ data: { user: null }, error: new TypeError("fetch failed") })
    await m.useAuth.getState().refreshAccess()
    expect(m.useAuth.getState()).toMatchObject({ status: "signedIn", offline: true, access: "active" })
    expect(auth.get("deadlyne-verified")).toEqual(verified)
  })

  it("expires offline access rather than silently granting a fresh grace period", async () => {
    const { m, auth } = await fixture()
    auth.set("deadlyne-verified", { userId: "owner", at: Date.now() - 31 * 864e5, access: "active" })
    f.getUser.mockResolvedValue({ data: { user: null }, error: new TypeError("offline") })
    await m.useAuth.getState().refreshAccess()
    expect(m.useAuth.getState().status).toBe("signedOut")
  })

  it("doesn't let an in-flight profile response repopulate a cleared account", async () => {
    const { m } = await fixture()
    let resolve!: (value: object) => void
    f.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise((done) => { resolve = done }) }) }) })
    const pending = m.fetchRemoteProfile()
    await m.clearAccountLocal()
    resolve({ data: { name: "Old account", credit: "Old credit", copyright: "" } })
    expect(await pending).toBeNull()
  })

  it("suppresses profile synchronization during deletion", async () => {
    const { m } = await fixture()
    m.useAuth.setState({ accountOperation: true })
    await m.pushRemoteProfile({ name: "Old account", credit: "", copyright: "" })
    expect(f.from).not.toHaveBeenCalled()
  })

  it("drains an in-flight verification write before clearing cached authorization", async () => {
    const { m, auth } = await fixture()
    let release!: () => void
    let started!: () => void
    const writing = new Promise<void>((resolve) => { started = resolve })
    const blocked = new Promise<void>((resolve) => { release = resolve })
    f.beforeSet.mockImplementation(async (key) => { if (key === "deadlyne-verified") { started(); await blocked } })
    f.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: "active" }, error: null }) }) }) })
    const refresh = m.useAuth.getState().refreshAccess()
    await writing
    const cleanup = m.clearAccountLocal()
    release()
    await Promise.all([refresh, cleanup])
    expect(auth.has("deadlyne-verified")).toBe(false)
    expect(m.useAuth.getState().status).toBe("signedOut")
  })
})
