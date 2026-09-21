// The sign-in gate: Deadlyne opens only for a signed-in, approved account.
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import logo from "@/assets/logo.png"
import { confirmSignUp, recover, resendSignUp, sendRecovery, setNewPassword, signIn, signUp, useAuth } from "@/lib/auth"
import { isMac } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"

type Screen =
  | { name: "signIn" }
  | { name: "signUp" }
  | { name: "confirm"; email: string }
  | { name: "forgot" }
  | { name: "recover"; email: string }

const MIN_PASSWORD = 8

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, access, mustSetPassword } = useAuth(useShallow((s) => ({ status: s.status, access: s.access, mustSetPassword: s.mustSetPassword })))

  useEffect(() => {
    useAuth.getState().init()
  }, [])

  if (status === "signedIn" && access === "active" && !mustSetPassword) return <>{children}</>

  return (
    <div className="flex h-full flex-col">
      {/* The window has no visible title bar; this strip keeps it draggable. */}
      <div data-tauri-drag-region className="h-12 shrink-0" style={{ paddingLeft: isMac ? 92 : 12 }} />
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-12">
        <div className="w-full max-w-sm">
          {status === "loading" || (status === "signedIn" && access === "checking" && !mustSetPassword) ? (
            <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-label="Signing in" />
          ) : status === "unconfigured" ? (
            <Unconfigured />
          ) : mustSetPassword && status === "signedIn" ? (
            <NewPassword />
          ) : status === "signedIn" ? (
            <Waiting disabled={access === "disabled"} />
          ) : (
            <SignedOut />
          )}
        </div>
      </main>
    </div>
  )
}

function Header({ title, subtitle }: { title: string; subtitle: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col items-center gap-3 text-center">
      <img src={logo} alt="" className="size-14" draggable={false} />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

/** Wraps a form action: shows a spinner while it runs and the error if it fails. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, act }
}

function SignedOut() {
  const [screen, setScreen] = useState<Screen>({ name: "signIn" })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const { busy, error, setError, act } = useAction()

  const go = (s: Screen) => {
    setScreen(s)
    setError(null)
    setNotice(null)
    setCode("")
    setPassword("")
  }
  const cleanEmail = email.trim().toLowerCase()

  if (screen.name === "confirm" || screen.name === "recover") {
    const confirming = screen.name === "confirm"
    const submit = () =>
      act(async () => {
        if (confirming) await confirmSignUp(screen.email, code)
        else await recover(screen.email, code)
      })
    return (
      <>
        <Header title="Check your email" subtitle={<>We sent a code to <span className="text-foreground">{screen.email}</span>.</>} />
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (code.length === 6) submit()
          }}
        >
          <FieldGroup>
            <Field className="items-center">
              <FieldLabel className="sr-only">Code</FieldLabel>
              <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus onComplete={submit} disabled={busy}>
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {error && <FieldError className="text-center">{error}</FieldError>}
              {notice && <FieldDescription className="text-center">{notice}</FieldDescription>}
            </Field>
            <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
              {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {confirming ? "Confirm email" : "Continue"}
            </Button>
            <div className="flex justify-between text-sm">
              <Button type="button" variant="link" className="h-auto p-0 text-muted-foreground" onClick={() => go({ name: "signIn" })}>
                Back to sign in
              </Button>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-muted-foreground"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    if (confirming) await resendSignUp(screen.email)
                    else await sendRecovery(screen.email)
                    setNotice("A new code is on its way.")
                  })
                }
              >
                Send a new code
              </Button>
            </div>
          </FieldGroup>
        </form>
      </>
    )
  }

  const forgot = screen.name === "forgot"
  const creating = screen.name === "signUp"
  const title = forgot ? "Reset your password" : creating ? "Create your account" : "Sign in to Deadlyne"
  const subtitle = forgot ? "We’ll email you a code." : creating ? "Your account works on your Mac and PC." : "From card to captioned, before the deadline."

  return (
    <>
      <Header title={title} subtitle={subtitle} />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          act(async () => {
            if (forgot) {
              await sendRecovery(cleanEmail)
              go({ name: "recover", email: cleanEmail })
            } else if (creating) {
              if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters for your password.`)
              if (await signUp(cleanEmail, password)) go({ name: "confirm", email: cleanEmail })
            } else {
              try {
                await signIn(cleanEmail, password)
              } catch (err) {
                if (err instanceof Error && err.message.startsWith("Confirm your email")) {
                  await resendSignUp(cleanEmail).catch(() => {})
                  go({ name: "confirm", email: cleanEmail })
                  return
                }
                throw err
              }
            }
          })
        }}
      >
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="auth-email">Email</FieldLabel>
            <Input id="auth-email" type="email" autoFocus autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {!forgot && (
            <Field>
              <div className="flex items-center">
                <FieldLabel htmlFor="auth-password">Password</FieldLabel>
                {!creating && (
                  <Button type="button" variant="link" className="ml-auto h-auto p-0 text-xs text-muted-foreground" onClick={() => go({ name: "forgot" })}>
                    Forgot password?
                  </Button>
                )}
              </div>
              <Input
                id="auth-password"
                type="password"
                autoComplete={creating ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {creating && <FieldDescription className="text-xs">At least {MIN_PASSWORD} characters.</FieldDescription>}
            </Field>
          )}
          {error && <FieldError>{error}</FieldError>}
          <Button type="submit" size="lg" disabled={busy}>
            {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {forgot ? "Email me a code" : creating ? "Create account" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {creating || forgot ? (
          <>
            {creating ? "Already have an account? " : ""}
            <Button variant="link" className="h-auto p-0" onClick={() => go({ name: "signIn" })}>
              {creating ? "Sign in" : "Back to sign in"}
            </Button>
          </>
        ) : (
          <>
            New to Deadlyne?{" "}
            <Button variant="link" className="h-auto p-0" onClick={() => go({ name: "signUp" })}>
              Create an account
            </Button>
          </>
        )}
      </p>
    </>
  )
}

function NewPassword() {
  const [password, setPassword] = useState("")
  const { busy, error, act } = useAction()
  return (
    <>
      <Header title="Choose a new password" subtitle="You’ll use it to sign in from now on." />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          act(async () => {
            if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`)
            await setNewPassword(password)
          })
        }}
      >
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="auth-new-password">New password</FieldLabel>
            <Input id="auth-new-password" type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <Button type="submit" size="lg" disabled={busy}>
            {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
            Save and open Deadlyne
          </Button>
        </FieldGroup>
      </form>
    </>
  )
}

function Waiting({ disabled }: { disabled: boolean }) {
  const email = useAuth((s) => s.account?.email)
  const { busy, act } = useAction()
  return (
    <>
      <Header
        title={disabled ? "This account is turned off" : "Almost there"}
        subtitle={
          disabled
            ? "Contact the Deadlyne team if you think this is a mistake."
            : <>Your account (<span className="text-foreground">{email}</span>) is waiting for approval. You’ll be able to open Deadlyne as soon as it’s approved.</>
        }
      />
      <div className="flex flex-col gap-2">
        {!disabled && (
          <Button size="lg" disabled={busy} onClick={() => act(() => useAuth.getState().refreshAccess())}>
            {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
            Check again
          </Button>
        )}
        <Button variant="ghost" onClick={() => useAuth.getState().signOut()}>
          Sign out
        </Button>
      </div>
    </>
  )
}

function Unconfigured() {
  return (
    <>
      <Header
        title="Sign-in isn’t set up"
        subtitle={
          import.meta.env.DEV
            ? "Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to desktop/.env.local, then restart. See desktop/supabase/README.md."
            : "This copy of Deadlyne can’t reach its account server. Download the latest version."
        }
      />
      {import.meta.env.DEV && (
        <Button variant="outline" className="w-full" onClick={() => useAuth.getState().bypass()}>
          Continue without signing in (development only)
        </Button>
      )}
    </>
  )
}
