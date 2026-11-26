// Rename photos where they are, from a pattern like Export's ("{shoot}_{seq}"). RAW + JPG pairs
// and their XMP sidecars get the same new name; Rust never overwrites (a taken name gets -1,
// -2…), review progress follows the new names, and the notice afterwards offers Undo.
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, PencilLine, ShieldCheck } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { exportName } from "@/lib/export"
import { plural } from "@/lib/format"
import { pref, setPref } from "@/lib/settings"
import { sortPhotos } from "@/lib/sort"
import { CHOICE, cn, focusDefaultAction } from "@/lib/utils"
import { targetPhotos, useStore } from "@/store"
import { useUI, type RenameWhich } from "@/ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const TOKENS = ["{shoot}", "{seq}", "{original}", "{date}", "{time}", "{camera}"]
const PREVIEW_ROWS = 5

const folderName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).pop() ?? folder

export function RenameDialog() {
  const { open, renameWhich } = useUI(useShallow((s) => ({ open: s.rename, renameWhich: s.renameWhich })))
  const { photos, selected, focus, loupe, folder, sort, busy } = useStore(
    useShallow((s) => ({ photos: s.photos, selected: s.selected, focus: s.focus, loupe: s.loupe, folder: s.folder, sort: s.sort, busy: s.busy })),
  )
  const [which, setWhich] = useState<RenameWhich>(renameWhich)
  const [pattern, setPattern] = useState(() => pref("renamePhotosPattern", "{shoot}_{seq}"))
  const [start, setStart] = useState("1")
  const patternRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setWhich(renameWhich)
  }, [open, renameWhich])

  const shoot = folder ? folderName(folder) : "Shoot"
  const tagged = useMemo(() => photos.filter((p) => p.tagged), [photos])
  const selection = useMemo(() => targetPhotos({ photos, selected, focus, loupe }), [photos, selected, focus, loupe])
  // Numbered in the order the contact sheet shows them.
  const chosen = useMemo(() => sortPhotos(which === "tagged" ? tagged : which === "selected" ? selection : photos, sort), [which, tagged, selection, photos, sort])
  const first = Math.max(0, Number.parseInt(start, 10) || 0)
  const stems = useMemo(() => chosen.map((p, i) => exportName(pattern, p, shoot, first + i)), [chosen, pattern, shoot, first])
  const empty = !pattern.trim() || stems.some((s) => !s.trim())
  const extension = (name: string) => name.match(/\.[^.]+$/)?.[0] ?? ""
  const close = () => useUI.getState().open("rename", false)

  const insert = (token: string) => {
    const el = patternRef.current
    const at = el?.selectionStart ?? pattern.length
    const end = el?.selectionEnd ?? at
    const next = pattern.slice(0, at) + token + pattern.slice(end)
    setPattern(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + token.length, at + token.length)
    })
  }

  const submit = async () => {
    if (!chosen.length || empty || busy) return
    setPref("renamePhotosPattern", pattern)
    close()
    await useStore.getState().rename(chosen, stems)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-dialog overflow-y-auto sm:max-w-lg" onOpenAutoFocus={focusDefaultAction}>
        <DialogHeader>
          <DialogTitle>Rename photos</DialogTitle>
          <DialogDescription>Renames the files where they are. RAW + JPG pairs and their XMP sidecars change together.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel id="rename-photos-label">Photos</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={which} onValueChange={(v) => v && setWhich(v as RenameWhich)} className="w-full" aria-labelledby="rename-photos-label">
                <ToggleGroupItem value="tagged" className={cn("flex-1", CHOICE)}>
                  Tagged ({tagged.length.toLocaleString()})
                </ToggleGroupItem>
                <ToggleGroupItem value="selected" className={cn("flex-1", CHOICE)}>
                  Selected ({selection.length.toLocaleString()})
                </ToggleGroupItem>
                <ToggleGroupItem value="all" className={cn("flex-1", CHOICE)}>
                  All ({photos.length.toLocaleString()})
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field>
              <FieldLabel htmlFor="rename-pattern">New name</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  ref={patternRef}
                  id="rename-pattern"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  className="min-w-0 flex-1 font-mono"
                  spellCheck={false}
                  autoCorrect="off"
                />
                <Input
                  value={start}
                  onChange={(e) => setStart(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  className="w-20 shrink-0 text-right tabular-nums"
                  aria-label="First number"
                  title="{seq} starts at this number"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TOKENS.map((t) => (
                  <Button key={t} type="button" variant="secondary" size="xs" className="font-mono text-muted-foreground" onClick={() => insert(t)}>
                    {t}
                  </Button>
                ))}
              </div>
            </Field>

            {chosen.length > 0 && (
              <div className="flex flex-col rounded-md bg-well py-1 shadow-well" role="table" aria-label="New names">
                <div role="row" className="flex px-3 py-1 text-caption font-semibold tracking-wide text-muted-foreground uppercase">
                  <span role="columnheader" className="flex-1">Now</span>
                  <span role="columnheader" className="flex-1 pl-6">Becomes</span>
                </div>
                {chosen.slice(0, PREVIEW_ROWS).map((p, i) => (
                  <div role="row" key={p.id} className="flex items-center px-3 py-1 font-mono text-xs">
                    <span role="cell" className="min-w-0 flex-1 truncate text-muted-foreground">{p.name}</span>
                    <ArrowRight className="mx-1.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span role="cell" className="min-w-0 flex-1 truncate">{stems[i] ? `${stems[i]}${extension(p.name)}` : "—"}</span>
                  </div>
                ))}
                {(chosen.length > PREVIEW_ROWS || chosen.some((p) => p.raw && p.jpeg)) && (
                  <span className="px-3 pt-1 pb-1.5 text-xs text-muted-foreground">
                    {[chosen.length > PREVIEW_ROWS ? `and ${(chosen.length - PREVIEW_ROWS).toLocaleString()} more` : "", chosen.some((p) => p.raw && p.jpeg) ? "RAW + JPG pairs and sidecars follow" : ""].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
            )}

            <FieldDescription className="flex items-start gap-2 text-xs">
              <ShieldCheck className="mt-px size-3.5 shrink-0 text-(--label-green)" aria-hidden />
              <span>No file is overwritten: a name that’s taken gets -1, -2. Captions, ratings and review progress keep up with the new names, and the notice afterwards can undo it.</span>
            </FieldDescription>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!chosen.length || empty || !!busy}>
              <PencilLine data-icon="inline-start" />
              {!chosen.length ? (which === "tagged" ? "No tagged photos" : "Nothing selected") : `Rename ${plural(chosen.length, "photo")}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
