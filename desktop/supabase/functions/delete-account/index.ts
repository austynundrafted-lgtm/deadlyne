import { createClient } from "npm:@supabase/supabase-js@2.116.0"
import { createDeletionHandler, type DeletionBackend } from "./handler.ts"

declare const EdgeRuntime: { waitUntil: (work: Promise<unknown>) => void }

const url = Deno.env.get("SUPABASE_URL")!
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const anon = Deno.env.get("SUPABASE_ANON_KEY")!
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const admin = createClient(url, secret, options)

const backend: DeletionBackend = {
  async user(jwt) {
    const { data, error } = await admin.auth.getUser(jwt)
    if (error) {
      if ([401, 403, 404].includes(error.status ?? 0)) return null
      throw error
    }
    return data.user ? {
      id: data.user.id, email: data.user.email,
      providers: data.user.identities?.map((identity) => identity.provider) ?? [],
    } : null
  },
  async verifyPassword(email, password) {
    // Isolated client: never replace the admin client's authorization with a user session.
    const verifier = createClient(url, anon, options)
    const { data, error } = await verifier.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.code === "invalid_credentials") return null
      throw error
    }
    if (!data.user || !data.session) throw new Error("Reauthentication failed")
    return {
      userId: data.user.id,
      dispose: async () => { await admin.auth.admin.signOut(data.session!.access_token, "local") },
    }
  },
  async receipt(hash) {
    const { data, error } = await admin.from("account_deletion_requests")
      .select("user_id, completed_at").eq("request_hash", hash).maybeSingle()
    if (error) throw error
    return data ? { userId: data.user_id, completedAt: data.completed_at } : null
  },
  async prepare(hash, userId) {
    const { error } = await admin.from("account_deletion_requests").insert({ request_hash: hash, user_id: userId })
    if (error && error.code !== "23505") throw error
    if (error) {
      const receipt = await backend.receipt(hash)
      if (!receipt?.completedAt && receipt?.userId !== userId) throw new Error("Receipt collision")
    }
  },
  async deleteUser(userId) {
    const { error } = await admin.auth.admin.deleteUser(userId, false)
    if (error) throw error
  },
}

Deno.serve(async (request) => {
  if (!url || !secret || !anon) return Response.json({ code: "unavailable", message: "Account deletion is temporarily unavailable." }, { status: 503 })
  // Completed receipts have no user link. Retain status proof for 30 days only.
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString()
  EdgeRuntime.waitUntil(Promise.resolve(admin.from("account_deletion_requests").delete().lt("completed_at", cutoff)).then(() => {}))
  return createDeletionHandler(backend)(request)
})
