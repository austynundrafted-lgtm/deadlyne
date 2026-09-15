// The optional photographer profile, used to fill Photographer, Credit and Copyright in one step.
// Stored only on this computer.
import { useEffect, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { DEFAULT_COPYRIGHT, type Profile } from "@/lib/settings"
import { useStore } from "@/store"
import { useUI } from "@/ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function ProfileDialog() {
  const open = useUI((s) => s.profile)
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{profile ? "Your profile" : "Set up your profile"}</DialogTitle>
          <DialogDescription>Fills Photographer, Credit and Copyright on your photos in one step. Stays on this computer.</DialogDescription>
        </DialogHeader>
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
              <Button type="button" variant="ghost" className="mr-auto" onClick={() => { setProfile(null); close() }}>
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
      </DialogContent>
    </Dialog>
  )
}
