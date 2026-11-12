// The optional photographer profile, used to fill Photographer, Credit and Copyright in one step.
// Cached on this device and synced with the signed-in account.
import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { DEFAULT_COPYRIGHT, type Profile } from "@/lib/settings"
import { useAuth } from "@/lib/auth"
import { isIPad } from "@/lib/format"
import { isMacAppStore } from "@/lib/distribution"
import { LocalDataImport } from "@/components/LocalDataImport"
import { confirm } from "@/lib/prompts"
import { useStore } from "@/store"
import { useLibrary } from "@/lib/library"
import { useUI } from "@/ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function ProfileDialog() {
  const open = useUI((s) => s.profile)
  const tab = useUI((s) => s.profileTab)
  const { profile, setProfile } = useStore(useShallow((s) => ({ profile: s.profile, setProfile: s.setProfile })))
  const [draft, setDraft] = useState<Profile>({ name: "", credit: "", copyright: DEFAULT_COPYRIGHT })

  useEffect(() => {
    if (open) setDraft(profile ?? { name: "", credit: "", copyright: DEFAULT_COPYRIGHT })
  }, [open, profile])

  const close = () => useUI.getState().open("profile", false)
  const year = new Date().getFullYear()
  const preview = (draft.copyright || DEFAULT_COPYRIGHT).replace(/\{year\}/gi, String(year)).replace(/\{name\}/gi, draft.name || "Your Name")

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className={`account-controls max-h-dialog overflow-y-auto sm:max-w-md ${isIPad ? "account-dynamic-type" : ""}`}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>{tab === "profile" ? "Your photographer profile fills credits on your photos and syncs with your account." : tab === "account" ? "Manage your Deadlyne sign-in and account." : tab === "catalog" ? "Manage folder rules for a future catalog." : "Import your setup from the previous Mac version."}</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value) => useUI.setState({ profileTab: value as "profile" | "account" | "data" | "catalog" })}>
          <TabsList className={isIPad ? "w-full min-h-11" : "w-full"} aria-label="Settings sections">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="catalog">Catalog</TabsTrigger>
            {isMacAppStore && <TabsTrigger value="data">Local data</TabsTrigger>}
          </TabsList>
          <TabsContent value="profile" className="pt-3">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setProfile(draft.name.trim() ? draft : null)
                close()
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="profile-name">Name</FieldLabel>
                  <Input id="profile-name" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Your name" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-credit">Credit line</FieldLabel>
                  <Input id="profile-credit" value={draft.credit} onChange={(e) => setDraft({ ...draft, credit: e.target.value })} placeholder="Your business or publication" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-copyright">Copyright</FieldLabel>
                  <Input id="profile-copyright" value={draft.copyright} onChange={(e) => setDraft({ ...draft, copyright: e.target.value })} />
                  <FieldDescription>
                    {"{year}"} becomes each photo’s capture year. Preview: {preview}
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <DialogFooter className="mt-6">
                {profile && (
                  <Button type="button" variant="ghost" className="mr-auto" onClick={async () => {
                    if (!await confirm({
                      title: "Are you sure you want to remove your photographer profile?",
                      description: "Your saved name, credit and copyright profile will be cleared. Credits already written into photos remain.",
                      action: "Remove profile", destructive: true,
                    })) return
                    setProfile(null); close()
                  }}>
                    Remove profile
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!draft.name.trim()}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
          <TabsContent value="catalog" className="pt-3"><CatalogSettings /></TabsContent>
          <TabsContent value="account" className="pt-3"><AccountSettings close={close} /></TabsContent>
          {isMacAppStore && <TabsContent value="data"><LocalDataImport /></TabsContent>}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function AccountSettings({ close }: { close: () => void }) {
  const { account, bypassed, offline } = useAuth(useShallow((s) => ({ account: s.account, bypassed: s.bypassed, offline: s.offline })))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!account || bypassed) return <p className="text-sm text-muted-foreground">There’s no signed-in account in this development session.</p>
  return (
    <div className={isIPad ? "space-y-6 [&_button]:min-h-11" : "space-y-6"}>
      <section className="space-y-3" aria-labelledby="account-heading">
        <div><h2 id="account-heading" className="font-medium">Signed in as</h2><p className="break-all text-sm text-muted-foreground">{account.email}</p></div>
        {offline && <p className="text-sm text-muted-foreground">You’re offline. Deleting an account requires an internet connection.</p>}
        <Button variant="outline" disabled={busy} onClick={async () => {
          setBusy(true); setError(null)
          try { await useAuth.getState().signOut(); close() }
          catch { setError("Couldn’t clear all sign-in details. Try signing out again.") }
          finally { setBusy(false) }
        }}>Sign out</Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </section>
      <section className="space-y-3" aria-labelledby="workflow-presets-heading">
        <h2 id="workflow-presets-heading" className="font-medium">Workflow presets</h2>
        <p className="text-sm text-muted-foreground">Save naming and delivery choices to use on your other devices. Folder locations stay on each device.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { close(); useUI.getState().open("ingest") }}>Ingest presets…</Button>
          <Button variant="outline" onClick={() => { close(); useUI.getState().openExport("tagged") }}>Export presets…</Button>
        </div>
      </section>
      <section className="space-y-3 rounded-lg p-4 shadow-edge" aria-labelledby="delete-account-heading">
        <h2 id="delete-account-heading" className="font-medium">Delete account</h2>
        <p className="text-sm text-muted-foreground">Permanently remove your Deadlyne login, synced profile and account presets. Your local photography files and rosters stay.</p>
        <Button variant="destructive" disabled={busy} onClick={() => { close(); useUI.getState().open("deleteAccount") }}>Delete Account…</Button>
      </section>
    </div>
  )
}

function CatalogSettings() {
  const rules = useLibrary((s) => s.catalogRules)
  const entries = Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))
  return <div className="space-y-4 text-sm">
    <p className="text-muted-foreground">Catalog indexing is not available yet. These saved rules are reserved for a future indexer; they do not scan or remove photos. The closest folder rule takes precedence over its ancestors.</p>
    {entries.length === 0 ? <p className="text-muted-foreground">No folder rules. Right-click a folder to add one.</p> : entries.map(([path, rule]) => <div key={path} className="flex items-center gap-2">
      <div className="min-w-0 flex-1"><div className="break-all">{path}</div><div className="text-muted-foreground">{rule === "include" ? "Include" : "Exclude"}</div></div>
      <Button variant="outline" size="sm" onClick={async () => {
        if (await confirm({ title: "Remove this catalog rule?", description: `The rule for “${path}” will be removed. Photos remain untouched.`, action: "Remove rule", destructive: true })) useLibrary.getState().setCatalogRule(path, null)
      }}>Remove</Button>
    </div>)}
  </div>
}
