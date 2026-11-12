import { describe, expect, it, vi } from "vitest"
import { createDeletionHandler, receiptHash, type DeletionBackend, type Receipt } from "./handler.ts"

const token = "a".repeat(64)
function fixture() {
  const receipts = new Map<string, Receipt>()
  let exists = true
  const dispose = vi.fn(async () => {})
  const backend: DeletionBackend = {
    user: vi.fn(async () => exists ? { id: "owner", email: "owner@example.invalid", providers: ["email"] } : null),
    verifyPassword: vi.fn(async (_email, password) => password === "correct" ? { userId: "owner", dispose } : null),
    receipt: vi.fn(async (hash) => receipts.get(hash) ?? null),
    prepare: vi.fn(async (hash, userId) => { if (!receipts.has(hash)) receipts.set(hash, { userId, completedAt: null }) }),
    deleteUser: vi.fn(async (id) => {
      expect(id).toBe("owner")
      exists = false
      for (const [hash, receipt] of receipts) if (receipt.userId === id) receipts.set(hash, { userId: null, completedAt: "2026-10-27T00:00:00Z" })
    }),
  }
  const handle = createDeletionHandler(backend)
  const send = (body: object, auth = "valid") => handle(new Request("https://example.invalid/delete-account", {
    method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  }))
  const remove = (extra = {}) => send({ action: "delete", requestToken: token, password: "correct", ...extra })
  return { backend, receipts, dispose, send, remove, handle }
}

describe("delete-account security and completion", () => {
  it("rejects missing or expired authentication without deleting anything", async () => {
    const f = fixture()
    expect((await f.send({ action: "delete", requestToken: token, password: "correct" }, "")).status).toBe(401)
    vi.mocked(f.backend.user).mockResolvedValue(null)
    expect((await f.remove()).status).toBe(401)
    expect(f.backend.deleteUser).not.toHaveBeenCalled()
    expect(f.backend.prepare).not.toHaveBeenCalled()
  })

  it("requires the current password and leaves a rejected account unchanged", async () => {
    const f = fixture()
    expect((await f.remove({ password: "incorrect" })).status).toBe(403)
    expect(f.backend.prepare).not.toHaveBeenCalled()
    expect(f.backend.deleteUser).not.toHaveBeenCalled()
  })

  it("deletes only the server-authenticated identity, ignoring a supplied target ID", async () => {
    const f = fixture()
    const response = await f.remove({ userId: "someone-else" })
    expect(await response.json()).toEqual({ status: "completed" })
    expect(f.backend.verifyPassword).toHaveBeenCalledWith("owner@example.invalid", "correct")
    expect(f.backend.deleteUser).toHaveBeenCalledExactlyOnceWith("owner")
    expect(f.dispose).toHaveBeenCalledOnce()
    expect(f.receipts.get(await receiptHash(token))).toEqual({ userId: null, completedAt: expect.any(String) })
  })

  it("rejects a reauthenticated identity mismatch and disposes the temporary session", async () => {
    const f = fixture()
    vi.mocked(f.backend.verifyPassword).mockResolvedValue({ userId: "someone-else", dispose: f.dispose })
    expect((await f.remove()).status).toBe(403)
    expect(f.backend.deleteUser).not.toHaveBeenCalled()
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it("does not silently skip revocation for an unimplemented OAuth provider", async () => {
    const f = fixture()
    vi.mocked(f.backend.user).mockResolvedValue({ id: "owner", email: "owner@example.invalid", providers: ["email", "apple"] })
    expect((await f.remove()).status).toBe(409)
    expect(f.backend.deleteUser).not.toHaveBeenCalled()
  })

  it("allows receipt-only confirmation after Auth has deleted the user", async () => {
    const f = fixture()
    await f.remove()
    const response = await f.send({ action: "status", requestToken: token }, "")
    expect(await response.json()).toEqual({ status: "completed" })
    expect(f.backend.deleteUser).toHaveBeenCalledOnce()
    expect(f.backend.user).toHaveBeenCalledOnce()
    expect(JSON.stringify(await (await f.send({ action: "status", requestToken: token }, "")).json())).not.toContain("owner")
  })

  it("keeps pending and missing receipts distinct from completed deletion", async () => {
    const f = fixture()
    expect(await (await f.send({ action: "status", requestToken: token })).json()).toEqual({ status: "not_found" })
    f.receipts.set(await receiptHash(token), { userId: "owner", completedAt: null })
    expect(await (await f.send({ action: "status", requestToken: token })).json()).toEqual({ status: "unconfirmed" })
  })

  it("does not report success after a backend deletion failure", async () => {
    const f = fixture()
    vi.mocked(f.backend.deleteUser).mockRejectedValue(new Error("private backend details"))
    const response = await f.remove()
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("private backend details")
    expect(f.receipts.get(await receiptHash(token))?.completedAt).toBeNull()
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it("supports concurrent confirmed requests without leaving identifying receipts", async () => {
    const f = fixture()
    const responses = await Promise.all([f.remove(), f.remove()])
    for (const response of responses) expect(await response.json()).toEqual({ status: "completed" })
    expect(f.receipts.get(await receiptHash(token))?.userId).toBeNull()
  })

  it("recovers when a concurrent deletion finishes during password verification", async () => {
    const f = fixture()
    vi.mocked(f.backend.verifyPassword).mockImplementationOnce(async () => {
      f.receipts.set(await receiptHash(token), { userId: null, completedAt: "2026-10-27T00:00:00Z" })
      return null
    })
    expect(await (await f.remove()).json()).toEqual({ status: "completed" })
    expect(f.backend.deleteUser).not.toHaveBeenCalled()
  })

  it("recovers a failure reading confirmation after a successful delete", async () => {
    const f = fixture()
    const read = async (hash: string) => f.receipts.get(hash) ?? null
    vi.mocked(f.backend.receipt).mockImplementationOnce(read).mockRejectedValueOnce(new Error("connection lost"))
    expect((await f.remove()).status).toBe(503)
    expect(await (await f.send({ action: "status", requestToken: token }, "")).json()).toEqual({ status: "completed" })
  })

  it("never deletes if the completion receipt could not be persisted", async () => {
    const f = fixture()
    vi.mocked(f.backend.prepare).mockRejectedValue(new Error("database unavailable"))
    expect((await f.remove()).status).toBe(503)
    expect(f.backend.deleteUser).not.toHaveBeenCalled()
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it("rejects invalid input and methods, and supports CORS without executing deletion", async () => {
    const f = fixture()
    expect((await f.handle(new Request("https://example.invalid", { method: "OPTIONS" }))).status).toBe(204)
    expect((await f.handle(new Request("https://example.invalid"))).status).toBe(405)
    expect((await f.remove({ requestToken: "guessable" })).status).toBe(400)
    expect((await f.remove({ password: "" })).status).toBe(400)
    expect(f.backend.deleteUser).not.toHaveBeenCalled()
  })
})
