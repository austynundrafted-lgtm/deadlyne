import { beforeEach, describe, expect, it, vi } from "vitest"

const f = vi.hoisted(() => {
  const values = new Map<string, unknown>()
  const auth = { account: { id: "owner", email: "owner@example.invalid" } as { id: string; email: string } | null, bypassed: false, accountOperation: false, status: "signedIn", notice: null as string | null }
  return { values, auth, clear: vi.fn(), signIn: vi.fn(), save: vi.fn(), signOut: vi.fn(), getSession: vi.fn(), fetch: vi.fn() }
})
vi.mock("@/lib/auth", () => ({
  accountPublicKey: "public-test-key", accountServerURL: "https://account.example.invalid",
  authStore: {
    get: async (key: string) => f.values.get(key), set: async (key: string, value: unknown) => { f.values.set(key, value) },
    delete: async (key: string) => { f.values.delete(key) }, save: f.save,
  },
  useAuth: { getState: () => f.auth, setState: (value: object) => Object.assign(f.auth, value) },
  clearAccountLocal: f.clear, signIn: f.signIn,
  supabase: { auth: { getSession: f.getSession, signOut: f.signOut } },
}))

const key = "deadlyne-deletion-request"
const respond = (body: object, status = 200) => Promise.resolve(Response.json(body, { status }))
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  f.values.clear()
  Object.assign(f.auth, { account: { id: "owner", email: "owner@example.invalid" }, bypassed: false, accountOperation: false, status: "signedIn", notice: null })
  f.clear.mockImplementation(async () => { f.auth.account = null; f.auth.status = "signedOut" })
  f.save.mockResolvedValue(undefined)
  f.getSession.mockResolvedValue({ data: { session: { access_token: "valid" } }, error: null })
  f.signOut.mockResolvedValue({ error: null })
  f.signIn.mockResolvedValue({ data: { user: { id: "owner" }, session: { access_token: "renewed" } }, error: null })
  vi.stubGlobal("navigator", { onLine: true })
  vi.stubGlobal("fetch", f.fetch)
})

describe("account-deletion client recovery", () => {
  it("requires online access and never sends or reports deletion while offline", async () => {
    vi.stubGlobal("navigator", { onLine: false })
    const m = await import("./account-deletion")
    await m.deleteAccount("password")
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.clear).not.toHaveBeenCalled()
    expect(m.useAccountDeletion.getState().phase).toBe("idle")
    expect(m.useAccountDeletion.getState().error).toMatch(/internet/)
  })

  it("persists a random receipt before sending, then clears account data only on confirmed success", async () => {
    f.fetch.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body)
      expect(f.values.get(key)).toMatchObject({ userId: "owner", requestToken: body.requestToken })
      expect(body.requestToken).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(f.values.get(key))).not.toContain("password")
      expect(f.clear).not.toHaveBeenCalled()
      return Response.json({ status: "completed" })
    })
    const m = await import("./account-deletion")
    await m.deleteAccount("password")
    expect(m.useAccountDeletion.getState().phase).toBe("completed")
    expect(f.clear).toHaveBeenCalledOnce()
    expect(f.values.has(key)).toBe(false)
    expect(f.auth.account).toBeNull()
  })

  it("keeps the account signed in after an incorrect password", async () => {
    f.fetch.mockImplementation(() => respond({ code: "incorrect_password", message: "Wrong password" }, 403))
    const m = await import("./account-deletion")
    await m.deleteAccount("wrong")
    expect(m.useAccountDeletion.getState().phase).toBe("idle")
    expect(f.values.has(key)).toBe(false)
    expect(f.clear).not.toHaveBeenCalled()
    expect(f.auth.account?.id).toBe("owner")
  })

  it("doesn't send deletion if durable receipt storage fails", async () => {
    f.save.mockRejectedValueOnce(new Error("disk full"))
    const m = await import("./account-deletion")
    await m.deleteAccount("password")
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.clear).not.toHaveBeenCalled()
  })

  it("recovers a lost response through the same receipt without sending a second deletion", async () => {
    f.fetch.mockRejectedValueOnce(new TypeError("connection lost"))
    const m = await import("./account-deletion")
    await m.deleteAccount("password")
    expect(m.useAccountDeletion.getState().phase).toBe("unconfirmed")
    expect(f.clear).not.toHaveBeenCalled()
    const receipt = f.values.get(key)
    f.fetch.mockImplementation(() => respond({ status: "completed" }))
    await m.checkDeletionStatus()
    const bodies = f.fetch.mock.calls.map((args) => JSON.parse(args[1].body))
    expect(bodies.map((body) => body.action)).toEqual(["delete", "status"])
    expect(bodies[1].requestToken).toBe((receipt as { requestToken: string }).requestToken)
    expect(bodies[1].password).toBeUndefined()
    expect(m.useAccountDeletion.getState().phase).toBe("completed")
  })

  it("never treats pending or missing status as completed", async () => {
    f.values.set(key, { userId: "owner", requestToken: "b".repeat(64), confirmed: false })
    f.fetch.mockImplementation(() => respond({ status: "not_found" }))
    const m = await import("./account-deletion")
    await m.initAccountDeletion()
    expect(m.useAccountDeletion.getState().phase).toBe("unconfirmed")
    expect(f.clear).not.toHaveBeenCalled()
  })

  it("finishes confirmed local cleanup after restart without a network connection", async () => {
    f.values.set(key, { userId: "owner", requestToken: "b".repeat(64), confirmed: true })
    vi.stubGlobal("navigator", { onLine: false })
    const m = await import("./account-deletion")
    await m.initAccountDeletion()
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.clear).toHaveBeenCalledOnce()
    expect(m.useAccountDeletion.getState().phase).toBe("completed")
  })

  it("does not mistake a corrupt confirmation marker for proof of deletion", async () => {
    f.values.set(key, { userId: "owner", requestToken: "b".repeat(64), confirmed: "false" })
    const m = await import("./account-deletion")
    await m.initAccountDeletion()
    expect(m.useAccountDeletion.getState().phase).toBe("unconfirmed")
    expect(f.clear).not.toHaveBeenCalled()
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it("suppresses accidental duplicate submissions", async () => {
    let release!: (value: Response) => void
    f.fetch.mockImplementation(() => new Promise<Response>((resolve) => { release = resolve }))
    const m = await import("./account-deletion")
    const first = m.deleteAccount("password")
    const second = m.deleteAccount("password")
    await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledOnce())
    release(Response.json({ status: "completed" }))
    await Promise.all([first, second])
    expect(f.clear).toHaveBeenCalledOnce()
  })

  it("reauthenticates an expired session and reuses its receipt", async () => {
    f.fetch.mockImplementationOnce(() => respond({ code: "session_expired", message: "Sign in again" }, 401))
      .mockImplementationOnce(() => respond({ status: "completed" }))
    const m = await import("./account-deletion")
    await m.deleteAccount("password")
    expect(f.signIn).toHaveBeenCalledWith("owner@example.invalid", "password")
    const bodies = f.fetch.mock.calls.map((args) => JSON.parse(args[1].body))
    expect(bodies[0].requestToken).toBe(bodies[1].requestToken)
    expect(f.clear).toHaveBeenCalledOnce()
  })

  it("retains confirmed proof when local cleanup fails, then retries cleanup safely", async () => {
    f.fetch.mockImplementation(() => respond({ status: "completed" }))
    f.clear.mockRejectedValueOnce(new Error("local disk unavailable"))
    const m = await import("./account-deletion")
    await m.deleteAccount("password")
    expect(f.values.get(key)).toMatchObject({ confirmed: true })
    expect(m.useAccountDeletion.getState().phase).toBe("unconfirmed")
    await m.checkDeletionStatus()
    expect(f.fetch).toHaveBeenCalledOnce()
    expect(m.useAccountDeletion.getState().phase).toBe("completed")
  })
})
