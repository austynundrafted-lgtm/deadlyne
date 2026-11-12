/** HTTP policy, separated from Supabase transport so failure/concurrency paths are testable. */
export interface DeletionUser {
  id: string
  email?: string
  providers: string[]
}
export interface Receipt {
  userId: string | null
  completedAt: string | null
}
export interface DeletionBackend {
  user: (jwt: string) => Promise<DeletionUser | null>
  verifyPassword: (email: string, password: string) => Promise<{ userId: string; dispose: () => Promise<void> } | null>
  receipt: (hash: string) => Promise<Receipt | null>
  prepare: (hash: string, userId: string) => Promise<void>
  deleteUser: (userId: string) => Promise<void>
}

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
}
const reply = (body: object, status = 200) => Response.json(body, { status, headers })
const failure = (code: string, message: string, status: number) => reply({ code, message }, status)

export async function receiptHash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")
}

export function createDeletionHandler(backend: DeletionBackend) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers })
    if (request.method !== "POST") return failure("method_not_allowed", "Use POST.", 405)
    let input: { action?: unknown; requestToken?: unknown; password?: unknown }
    try {
      if (Number(request.headers.get("content-length")) > 8192) throw new Error("size")
      const text = await request.text()
      if (text.length > 8192) throw new Error("size")
      input = JSON.parse(text)
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("shape")
    } catch {
      return failure("invalid_request", "The deletion request is invalid.", 400)
    }
    if ((input.action !== "delete" && input.action !== "status") || typeof input.requestToken !== "string" || !/^[0-9a-f]{64}$/.test(input.requestToken)) {
      return failure("invalid_request", "The deletion request is invalid.", 400)
    }
    const hash = await receiptHash(input.requestToken)
    try {
      const previous = await backend.receipt(hash)
      if (input.action === "status") {
        // Possession of the opaque receipt allows only this non-identifying status lookup.
        return reply({ status: previous?.completedAt ? "completed" : previous ? "unconfirmed" : "not_found" })
      }
      // Repeating a completed request only returns its receipt; it performs no new deletion.
      if (previous?.completedAt) return reply({ status: "completed" })
      const jwt = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
      if (!jwt) return failure("session_expired", "Sign in again before deleting your account.", 401)
      const user = await backend.user(jwt)
      if (!user) {
        if ((await backend.receipt(hash))?.completedAt) return reply({ status: "completed" })
        return failure("session_expired", "Sign in again before deleting your account.", 401)
      }
      // Only email/password is shipped today. Future OAuth providers require their own
      // reauthentication and revocation implementation before being enabled in the app.
      if (!user.email || !user.providers.length || user.providers.some((provider) => provider !== "email")) {
        return failure("unsupported_provider", "This sign-in method needs an account-deletion update. Contact Deadlyne support.", 409)
      }
      if (typeof input.password !== "string" || !input.password || input.password.length > 1024) {
        return failure("password_required", "Enter your current password to confirm your identity.", 400)
      }
      const identity = await backend.verifyPassword(user.email, input.password)
      if (!identity) {
        // A concurrent request may have removed Auth after getUser succeeded.
        if ((await backend.receipt(hash))?.completedAt) return reply({ status: "completed" })
        return failure("incorrect_password", "That password doesn’t match your account.", 403)
      }
      try {
        if (identity.userId !== user.id) return failure("identity_mismatch", "Sign in again before deleting your account.", 403)
        if (previous && previous.userId !== user.id) return failure("invalid_receipt", "Start a new deletion request.", 409)
        await backend.prepare(hash, user.id)
        let deletionFailed = false
        try { await backend.deleteUser(user.id) } catch { deletionFailed = true }
        // The DB trigger confirms completion inside the same transaction as Auth deletion.
        // Also handles simultaneous requests where the other request deleted the user first.
        const completed = await backend.receipt(hash)
        if (completed?.completedAt) return reply({ status: "completed" })
        return failure("completion_unconfirmed", deletionFailed
          ? "Deletion could not be confirmed. Check its status before retrying."
          : "The server has not confirmed deletion. Check its status before retrying.", 503)
      } finally {
        // Reauthentication's temporary server-side session must not survive a failed deletion.
        await identity.dispose().catch(() => {})
      }
    } catch {
      // Do not log credentials or leak database/provider errors or other account identities.
      return failure("completion_unconfirmed", "Can’t confirm deletion right now. Check your connection and try checking its status.", 503)
    }
  }
}
