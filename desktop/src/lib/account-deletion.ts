// Account deletion never invokes photo/file operations. The opaque receipt survives a lost
// response or restart, so cloud completion is confirmed before local account data is cleared.
import { create } from "zustand"
import { accountPublicKey, accountServerURL, authStore, clearAccountLocal, signIn, supabase, useAuth } from "@/lib/auth"

const KEY = "deadlyne-deletion-request"
const DELETED = "Your Deadlyne account has been deleted. Your local photos, metadata and rosters have been kept."
interface DeletionRequest {
  userId: string
  requestToken: string
  confirmed: boolean
}
type Phase = "idle" | "deleting" | "checking" | "unconfirmed" | "cleanup" | "completed"
interface DeletionState {
  phase: Phase
  request: DeletionRequest | null
  error: string | null
  ready: boolean
}
export const useAccountDeletion = create<DeletionState>(() => ({ phase: "idle", request: null, error: null, ready: false }))
export const deletionBusy = (phase: Phase) => phase === "deleting" || phase === "checking" || phase === "cleanup"

class DeletionError extends Error {
  constructor(message: string, readonly uncertain: boolean, readonly code?: string) { super(message) }
}

async function call(action: "delete" | "status", request: DeletionRequest, password?: string, jwt?: string) {
  if (!accountServerURL || !accountPublicKey) throw new DeletionError("Account deletion isn’t configured in this build.", false)
  if (navigator.onLine === false) throw new DeletionError("Connect to the internet to delete your account or check its status.", action === "status")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(`${accountServerURL}/functions/v1/delete-account`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", apikey: accountPublicKey, ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
      body: JSON.stringify({ action, requestToken: request.requestToken, ...(password !== undefined ? { password } : {}) }),
    })
    const body = await response.json().catch(() => null) as { status?: string; message?: string; code?: string } | null
    if (!response.ok) {
      throw new DeletionError(body?.message || "Account deletion is unavailable. Try again when the account server is available.", response.status >= 500, body?.code)
    }
    if (!["completed", "unconfirmed", "not_found"].includes(body?.status ?? "")) throw new DeletionError("The server returned an unrecognized deletion status. Check again.", true)
    return body!.status!
  } catch (error) {
    if (error instanceof DeletionError) throw error
    throw new DeletionError("Couldn’t confirm deletion. Check your connection, then check its status before retrying.", true)
  } finally { clearTimeout(timeout) }
}

async function saveRequest(request: DeletionRequest) {
  await authStore.set(KEY, request)
  await authStore.save()
  useAccountDeletion.setState({ request })
}

async function complete(request: DeletionRequest) {
  useAccountDeletion.setState({ phase: "cleanup", error: null })
  // Keep confirmed proof until all local cleanup succeeds; a restart can finish it offline.
  await saveRequest({ ...request, confirmed: true })
  try { await supabase?.auth.signOut({ scope: "local" }) } catch { /* Auth user is already gone. */ }
  await clearAccountLocal(DELETED)
  await authStore.delete(KEY)
  await authStore.save()
  useAuth.setState({ status: "signedOut", accountOperation: false, notice: DELETED })
  useAccountDeletion.setState({ phase: "completed", request: null, error: null })
}

let operation: Promise<void> | null = null
function exclusive(work: () => Promise<void>): Promise<void> {
  if (operation) return operation
  operation = work().catch((error) => {
    const request = useAccountDeletion.getState().request
    useAccountDeletion.setState({ phase: request ? "unconfirmed" : "idle", error: error instanceof Error ? error.message : "Couldn’t complete account deletion. Try again." })
  }).finally(() => { useAuth.setState({ accountOperation: false }); operation = null })
  return operation
}

/** Check-only: may confirm an existing request, but never initiates account deletion. */
export function checkDeletionStatus(): Promise<void> {
  return exclusive(async () => {
    const request = useAccountDeletion.getState().request
    if (!request) return
    useAccountDeletion.setState({ phase: "checking", error: null })
    useAuth.setState({ accountOperation: true })
    if (request.confirmed || await call("status", request) === "completed") return complete(request)
    useAccountDeletion.setState({ phase: "unconfirmed", error: "Deletion has not been confirmed. You can retry with your password; retrying won’t create a second deletion." })
  })
}

export function deleteAccount(password: string): Promise<void> {
  return exclusive(async () => {
    const account = useAuth.getState().account
    if (!supabase || !account || useAuth.getState().bypassed) throw new DeletionError("Sign in to the account you want to delete.", false)
    if (!password) throw new DeletionError("Enter your current password.", false)
    if (navigator.onLine === false) throw new DeletionError("Connect to the internet to delete your account.", false)
    useAccountDeletion.setState({ phase: "deleting", error: null })
    useAuth.setState({ accountOperation: true })
    let request = useAccountDeletion.getState().request
    const hadPending = !!request
    if (request && request.userId !== account.id) throw new DeletionError("Check the previous deletion request before signing in to another account.", true)
    if (request && (request.confirmed || await call("status", request) === "completed")) return complete(request)
    request ??= {
      userId: account.id, confirmed: false,
      requestToken: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""),
    }
    // Persist before sending. If this fails, no backend deletion is attempted.
    await saveRequest(request)
    try {
      const session = await supabase.auth.getSession()
      let jwt = session.data.session?.access_token
      if (!jwt || session.error) {
        const fresh = await signIn(account.email, password).catch((error) => { throw new DeletionError(String(error instanceof Error ? error.message : error), false) })
        if (fresh.data.user?.id !== account.id) throw new DeletionError("Sign in to the same account before retrying deletion.", false)
        jwt = fresh.data.session?.access_token
      }
      let status: string
      try { status = await call("delete", request, password, jwt) }
      catch (error) {
        if (!(error instanceof DeletionError) || error.code !== "session_expired") throw error
        const fresh = await signIn(account.email, password).catch((error) => { throw new DeletionError(String(error instanceof Error ? error.message : error), false) })
        if (fresh.data.user?.id !== account.id) throw new DeletionError("Sign in to the same account before retrying deletion.", false)
        status = await call("delete", request, password, fresh.data.session?.access_token)
      }
      if (status !== "completed") throw new DeletionError("Deletion has not been confirmed. Check its status before retrying.", true)
      await complete(request)
    } catch (error) {
      // A definitive pre-deletion rejection leaves the account unchanged. Transport/5xx
      // failures keep the receipt, because the server may have completed the request.
      if (error instanceof DeletionError && !error.uncertain && !hadPending) {
        await authStore.delete(KEY)
        await authStore.save()
        useAccountDeletion.setState({ request: null })
      }
      throw error
    }
  })
}

/** Forget only this device's status after explicitly signing out; never cancels a sent request. */
export function leaveDeletionStatus(): Promise<void> {
  return exclusive(async () => {
    if (useAccountDeletion.getState().request?.confirmed) return complete(useAccountDeletion.getState().request!)
    useAuth.setState({ accountOperation: true })
    try { await supabase?.auth.signOut({ scope: "local" }) } catch { /* Clear explicitly below. */ }
    await clearAccountLocal("You signed out. A deletion request already sent to the server may still complete.")
    await authStore.delete(KEY)
    await authStore.save()
    useAccountDeletion.setState({ request: null, phase: "idle", error: null })
  })
}

let initialization: Promise<void> | null = null
export function initAccountDeletion(): Promise<void> {
  initialization ??= (async () => {
    try {
      const request = await authStore.get<DeletionRequest>(KEY)
      if (request) {
        // No password is ever persisted. A corrupt marker cannot authorize anything.
        if (typeof request.userId !== "string" || typeof request.requestToken !== "string" || !/^[0-9a-f]{64}$/.test(request.requestToken) || typeof request.confirmed !== "boolean") throw new Error("Saved deletion status is invalid. Contact Deadlyne support before retrying.")
        useAccountDeletion.setState({ request, phase: "unconfirmed" })
        await checkDeletionStatus()
      }
    } catch (error) {
      useAccountDeletion.setState({ phase: "unconfirmed", error: String(error) })
    } finally { useAccountDeletion.setState({ ready: true }) }
  })()
  return initialization
}
