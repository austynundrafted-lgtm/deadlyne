// Signing in to Deadlyne (Supabase Auth). The app is gated: nothing opens until you're signed in.
//
// Photographers work where the internet is bad, so a sign-in that was confirmed with the server
// keeps working offline on this computer for OFFLINE_GRACE_DAYS. The session is kept in the app's
// own store file, which survives updates.
import { createClient, isAuthApiError, isAuthRetryableFetchError, type Session, type SupabaseClient, type User } from "@supabase/supabase-js"
import { LazyStore } from "@tauri-apps/plugin-store"
import { create } from "zustand"
import type { Profile } from "@/lib/settings"

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined
const SESSION_KEY = "deadlyne-auth"
const VERIFIED_KEY = "deadlyne-verified"
export const OFFLINE_GRACE_DAYS = 30

const file = new LazyStore("auth.json")

/** supabase-js storage backed by the Tauri store file. */
const storage = {
  getItem: async (key: string) => (await file.get<string>(key)) ?? null,
  setItem: async (key: string, value: string) => {
    await file.set(key, value)
    await file.save()
  },
  removeItem: async (key: string) => {
    await file.delete(key)
    await file.save()
  },
}

export const supabase: SupabaseClient | null =
  URL && KEY
    ? createClient(URL, KEY, {
        auth: { storage, storageKey: SESSION_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null

/** Account status from the `profiles` table; see supabase/README.md. */
export type Access = "active" | "pending" | "disabled"

interface Account {
  id: string
  email: string
}

interface AuthState {
  status: "loading" | "unconfigured" | "signedOut" | "signedIn"
  account: Account | null
  /** "checking" until the server (or the last confirmation saved offline) says. */
  access: Access | "checking"
  /** Signed in from what's saved on this computer, because the server couldn't be reached. */
  offline: boolean
  /** Development only: skip the gate when Supabase isn't configured. */
  bypassed: boolean
  /** A recovery code was accepted: ask for a new password before opening the app. */
  mustSetPassword: boolean
  init: () => Promise<void>
  refreshAccess: () => Promise<void>
  signOut: () => Promise<void>
  bypass: () => void
}

interface Verified {
  userId: string
  at: number
  access: Access
}

const toAccount = (u: User): Account => ({ id: u.id, email: u.email ?? "" })

async function remember(userId: string, access: Access) {
  await file.set(VERIFIED_KEY, { userId, at: Date.now(), access } satisfies Verified)
  await file.save()
}

/** Looks up the account's status. A missing `profiles` table means there's no approval step. */
async function fetchAccess(userId: string): Promise<Access | "unreachable"> {
  const { data, error } = await supabase!.from("profiles").select("status").eq("id", userId).maybeSingle()
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return "active"
    return error.message.toLowerCase().includes("fetch") ? "unreachable" : "active"
  }
  return (data?.status as Access | undefined) ?? "pending"
}

let initialized = false

export const useAuth = create<AuthState>((set, get) => ({
  status: supabase ? "loading" : "unconfigured",
  account: null,
  access: "checking",
  offline: false,
  bypassed: false,
  mustSetPassword: false,

  init: async () => {
    if (!supabase || initialized) return
    initialized = true

    supabase.auth.onAuthStateChange((event, session) => {
      // Supabase calls this inside its own lock; don't await other auth calls here.
      if (event === "SIGNED_OUT") {
        set({ status: "signedOut", account: null, offline: false, mustSetPassword: false, access: "checking" })
      } else if (event === "PASSWORD_RECOVERY") {
        set({ mustSetPassword: true })
      } else if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED")) {
        setTimeout(() => signedIn(session), 0)
      }
    })

    const { data, error } = await supabase.auth.getSession()
    if (data.session) return signedIn(data.session)
    if (error && isAuthRetryableFetchError(error)) {
      // Offline with an expired token: supabase-js keeps the session saved but won't hand it back.
      const raw = await storage.getItem(SESSION_KEY)
      const saved = raw ? (JSON.parse(raw) as Session) : null
      const verified = await file.get<Verified>(VERIFIED_KEY)
      const fresh = verified && saved?.user && verified.userId === saved.user.id && Date.now() - verified.at < OFFLINE_GRACE_DAYS * 864e5
      if (saved?.user && fresh) {
        set({ status: "signedIn", account: toAccount(saved.user), access: verified.access, offline: true })
        return
      }
    }
    set({ status: "signedOut" })
  },

  refreshAccess: async () => {
    const account = get().account
    if (!supabase || !account) return
    const access = await fetchAccess(account.id)
    if (access === "unreachable") {
      // Just signed in, so the server was there a moment ago: use what was confirmed last time.
      const verified = await file.get<Verified>(VERIFIED_KEY)
      return set({ offline: true, access: verified?.userId === account.id ? verified.access : "active" })
    }
    set({ access, offline: false })
    await remember(account.id, access)
  },

  signOut: async () => {
    await file.delete(VERIFIED_KEY)
    if (!supabase) return
    // "local" works offline too; the server session simply expires.
    await supabase.auth.signOut({ scope: "local" })
    set({ status: "signedOut", account: null, offline: false, access: "checking" })
  },

  bypass: () => {
    if (import.meta.env.DEV) set({ status: "signedIn", access: "active", bypassed: true, account: { id: "dev", email: "development build" } })
  },
}))

async function signedIn(session: Session) {
  const known = useAuth.getState()
  const sameUser = known.account?.id === session.user.id
  if (sameUser && known.status === "signedIn" && !known.offline && known.access !== "checking") return
  const verified = await file.get<Verified>(VERIFIED_KEY)
  useAuth.setState({
    status: "signedIn",
    account: toAccount(session.user),
    offline: false,
    // Returning users open straight away with their last known status; new ones wait for the check.
    access: sameUser ? known.access : verified?.userId === session.user.id ? verified.access : "checking",
  })

  // Confirm the account still exists and isn't disabled, then save when it was last confirmed.
  const { error } = await supabase!.auth.getUser()
  if (error && isAuthApiError(error) && (error.status === 401 || error.status === 403)) {
    await useAuth.getState().signOut()
    return
  }
  await useAuth.getState().refreshAccess()
}

// MARK: - Screens' actions

const friendly = (e: { message: string; code?: string }) => {
  const m = e.message.toLowerCase()
  if (m.includes("invalid login credentials")) return "That email and password don’t match an account."
  if (m.includes("email not confirmed")) return "Confirm your email first. Enter the code we sent you."
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "New accounts are by invitation only."
  if (m.includes("already registered")) return "There’s already an account with that email. Sign in instead."
  if (m.includes("token has expired") || m.includes("invalid")) return "That code didn’t work. Check it, or send a new one."
  if (m.includes("rate limit") || m.includes("security purposes")) return "Too many tries. Wait a minute and try again."
  if (m.includes("fetch") || m.includes("network")) return "Can’t reach the sign-in server. Check your internet connection."
  return e.message
}

async function run<T extends { error: { message: string } | null }>(p: Promise<T>): Promise<T> {
  try {
    const r = await p
    if (r.error) throw new Error(friendly(r.error))
    return r
  } catch (e) {
    throw e instanceof Error && e.message ? new Error(friendly(e)) : e
  }
}

export const signIn = (email: string, password: string) => run(supabase!.auth.signInWithPassword({ email, password }))

/** Resolves to true when the account needs its email confirmed (a code was sent). */
export async function signUp(email: string, password: string) {
  const { data } = await run(supabase!.auth.signUp({ email, password }))
  // With confirmations on, an existing email comes back as a user with no identities.
  if (data.user && !data.user.identities?.length) throw new Error(friendly({ message: "already registered" }))
  return !data.session
}

export const confirmSignUp = (email: string, token: string) => run(supabase!.auth.verifyOtp({ email, token, type: "signup" }))
export const resendSignUp = (email: string) => run(supabase!.auth.resend({ type: "signup", email }))
export const sendRecovery = (email: string) => run(supabase!.auth.resetPasswordForEmail(email))

export async function recover(email: string, token: string) {
  useAuth.setState({ mustSetPassword: true })
  try {
    await run(supabase!.auth.verifyOtp({ email, token, type: "recovery" }))
  } catch (e) {
    useAuth.setState({ mustSetPassword: false })
    throw e
  }
}

export async function setNewPassword(password: string) {
  await run(supabase!.auth.updateUser({ password }))
  useAuth.setState({ mustSetPassword: false })
}

// MARK: - Profile sync

/** The account's photographer profile, so it follows you to another computer. */
export async function fetchRemoteProfile(): Promise<Profile | null> {
  const account = useAuth.getState().account
  if (!supabase || !account || useAuth.getState().bypassed) return null
  const { data } = await supabase.from("profiles").select("name, credit, copyright").eq("id", account.id).maybeSingle()
  return data?.name ? { name: data.name, credit: data.credit ?? "", copyright: data.copyright ?? "" } : null
}

export async function pushRemoteProfile(profile: Profile | null) {
  const account = useAuth.getState().account
  if (!supabase || !account || useAuth.getState().bypassed) return
  await supabase
    .from("profiles")
    .update({ name: profile?.name ?? "", credit: profile?.credit ?? "", copyright: profile?.copyright ?? "" })
    .eq("id", account.id)
}
