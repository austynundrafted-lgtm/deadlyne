import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { checkDeletionStatus, deleteAccount, deletionBusy, useAccountDeletion } from "@/lib/account-deletion"
import { useAuth } from "@/lib/auth"
import { isIPad } from "@/lib/format"
import { useUI } from "@/ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/** Kept outside AuthGate so pending/disabled accounts and interrupted requests can delete too. */
export function AccountDeletionDialog() {
  const open = useUI((s) => s.deleteAccount)
  const account = useAuth((s) => s.account)
  const { phase, request, error } = useAccountDeletion()
  const [password, setPassword] = useState("")
  const cancel = useRef<HTMLButtonElement>(null)
  const busy = deletionBusy(phase)
  const close = () => { if (!busy) useUI.getState().open("deleteAccount", false) }

  useEffect(() => { if (!open || busy) setPassword("") }, [open, busy])
  useEffect(() => { if (phase === "completed") useUI.getState().open("deleteAccount", false) }, [phase])

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent
        className={`account-controls max-h-dialog overflow-y-auto sm:max-w-lg ${isIPad ? "account-dynamic-type" : ""}`}
        showCloseButton={!busy}
        onOpenAutoFocus={(event) => { event.preventDefault(); cancel.current?.focus() }}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        aria-busy={busy}
      >
        <DialogHeader>
          <DialogTitle>Delete your Deadlyne account?</DialogTitle>
          <DialogDescription>
            Permanently deletes your login, email, synced photographer profile and account presets. This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground" id="deletion-details">
          <p>Your photos, sidecars, captions, exports, rosters, library organization and workflow settings stay on this device or your drives. They aren’t deleted by this action.</p>
          <p>Your sign-in credentials, saved photographer profile and cached account presets are cleared from this device. You’ll need an account to open Deadlyne again.</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); if (!busy && password) void deleteAccount(password) }} className="space-y-4">
          <Field>
            <FieldLabel htmlFor="delete-account-password">Current password</FieldLabel>
            <Input
              id="delete-account-password" type="password" autoComplete="current-password"
              value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy}
              aria-describedby="deletion-details deletion-feedback" aria-invalid={!!error}
              className={isIPad ? "min-h-11 text-base" : undefined}
            />
          </Field>
          <div id="deletion-feedback" aria-live="polite" aria-atomic="true">
            {busy ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{phase === "cleanup" ? "Account deleted. Clearing sign-in details…" : phase === "checking" ? "Checking deletion status…" : "Deleting your account…"}</p>
              : error && <FieldError>{error}</FieldError>}
          </div>
          <DialogFooter className={isIPad ? "[&_button]:min-h-11" : undefined}>
            <Button ref={cancel} type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            {request && !busy && <Button type="button" variant="outline" onClick={() => void checkDeletionStatus()}>Check status</Button>}
            <Button type="submit" variant="destructive" disabled={busy || !password || !account}>Permanently Delete Account</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
