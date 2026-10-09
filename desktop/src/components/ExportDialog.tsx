// Export photos to a folder. The common case is ⇧⌘E and Return: the tagged photos' JPGs, with their
// captions inside, into a folder named after the shoot in the place you exported to last time.
// Resizing and renaming are there for the desk that wants 3000 px or "Fairborn_0001.JPG".
import { useEffect, useMemo, useState } from "react"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { ChevronDown, FolderOpen, FolderOutput } from "lucide-react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { formatBytes, openFiles } from "@/lib/api"
import { cancelExport, EXPORT_FILES, exportItems, exportName, QUALITIES, RENAME_TOKENS, runExport, SIZES, useExport, type ExportFiles } from "@/lib/export"
import { plural } from "@/lib/format"
import { shootName } from "@/lib/shootName"
import { CHOICE, cn } from "@/lib/utils"
import { targetPhotos, useStore } from "@/store"
import { useUI } from "@/ui"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/** The shoot folder's own name, e.g. "Boys_Varsity-Fairborn-vs-Tecumseh_082126". */
const folderName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).pop() ?? folder

export function ExportDialog() {
  const { open, exportWhich } = useUI(useShallow((s) => ({ open: s.export, exportWhich: s.exportWhich })))
  const { prefs, setPrefs, running, progress } = useExport()
  const { photos, selected, focus, loupe, folder } = useStore(
    useShallow((s) => ({ photos: s.photos, selected: s.selected, focus: s.focus, loupe: s.loupe, folder: s.folder })),
  )
  const [which, setWhich] = useState(exportWhich)
  const [subfolder, setSubfolder] = useState("")

  const shoot = folder ? folderName(folder) : "Export"
  useEffect(() => {
    if (open) {
      setWhich(exportWhich)
      setSubfolder(shoot)
    }
  }, [open, exportWhich, shoot])

  const tagged = useMemo(() => photos.filter((p) => p.tagged), [photos])
  const selection = useMemo(() => targetPhotos({ photos, selected, focus, loupe }), [photos, selected, focus, loupe])
  const chosen = which === "tagged" ? tagged : selection
  const { files, missing } = useMemo(() => exportItems(chosen, prefs.files, null), [chosen, prefs.files])
  const kind = EXPORT_FILES.find((f) => f.value === prefs.files)!.label
  const example = chosen[0] ? exportName(prefs.renamePattern, chosen[0], shoot, 1) : "Fairborn_0001"
  const sub = prefs.subfolderOn ? subfolder.trim() : ""
  const destinationName = prefs.destination ? folderName(prefs.destination) : null
  const sameFolder = !!folder && !!prefs.destination && !sub && prefs.destination.replace(/[\\/]+$/, "") === folder.replace(/[\\/]+$/, "")
  const close = () => !running && useUI.getState().open("export", false)

  const pickDestination = async () => {
    const picked = await openDialog({ directory: true, title: "Export to…" })
    if (typeof picked === "string") setPrefs({ destination: picked })
  }

  const start = async () => {
    if (!files || running || sameFolder) return
    if (!prefs.destination) return pickDestination()
    useStore.setState({ busy: `Exporting ${plural(chosen.length, "photo")}…` })
    try {
      const s = await runExport({ photos: chosen, shoot, subfolder: sub || null }, prefs)
      const where = folderName(s.folder)
      const extras = [
        s.resized ? `${s.resized} resized` : "",
        s.renamed.length ? `${s.renamed.length} got a number added (${s.renamed[0][1]}${s.renamed.length > 1 ? "…" : ""})` : "",
        formatBytes(s.bytes),
      ].filter(Boolean)
      if (s.errors.length) {
        toast.error(s.files ? `Exported ${plural(s.files, "file")} to ${where}, with problems` : "Nothing was exported", {
          description: s.errors.slice(0, 4).join("\n"),
          duration: Infinity,
        })
      } else if (s.cancelled) {
        toast(`Stopped · ${plural(s.files, "file")} exported to ${where}`)
      } else {
        toast.success(`Exported ${plural(s.files, "file")} to ${where}`, {
          description: extras.join(" · "),
          action: prefs.openWhenDone ? undefined : { label: "Show", onClick: () => openFiles([s.folder]) },
        })
      }
      if (s.files && prefs.openWhenDone && !s.cancelled) openFiles([s.folder]).catch(() => {})
      useUI.getState().open("export", false)
    } catch (e) {
      toast.error("Couldn’t export", { description: String(e) })
    } finally {
      useStore.setState({ busy: null })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md" onEscapeKeyDown={(e) => running && e.preventDefault()} onInteractOutside={(e) => running && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Export photos</DialogTitle>
          <DialogDescription>Copies for the client or the desk, captions included. The originals stay put.</DialogDescription>
        </DialogHeader>

        {running ? (
          <div className="flex flex-col gap-3 py-2">
            <Progress value={progress?.filesTotal ? (progress.filesDone / progress.filesTotal) * 100 : null} className="h-1.5" />
            <p className="truncate text-sm text-muted-foreground tabular-nums">
              {progress ? `${progress.filesDone.toLocaleString()} of ${progress.filesTotal.toLocaleString()} · ${progress.currentFile}` : "Starting…"}
            </p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              start()
            }}
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel>Photos</FieldLabel>
                <ToggleGroup type="single" variant="outline" value={which} onValueChange={(v) => v && setWhich(v as typeof which)} className="w-full">
                  <ToggleGroupItem value="tagged" className={cn("flex-1", CHOICE)}>
                    Tagged ({tagged.length.toLocaleString()})
                  </ToggleGroupItem>
                  <ToggleGroupItem value="selected" className={cn("flex-1", CHOICE)}>
                    Selected ({selection.length.toLocaleString()})
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>

              <Field>
                <FieldLabel>Files</FieldLabel>
                <ToggleGroup type="single" variant="outline" value={prefs.files} onValueChange={(v) => v && setPrefs({ files: v as ExportFiles })} className="w-full">
                  {EXPORT_FILES.map((f) => (
                    <ToggleGroupItem key={f.value} value={f.value} className={cn("flex-1", CHOICE)}>
                      {f.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {missing > 0 && (
                  <FieldDescription className="text-xs">
                    {plural(missing, "photo")} {missing === 1 ? "has" : "have"} no {kind === "RAW + JPG" ? "files" : kind} and will be left out.
                  </FieldDescription>
                )}
              </Field>

              {prefs.files !== "raw" && (
                <Field orientation="horizontal" className="items-center">
                  <FieldLabel className="w-auto shrink-0">JPG size</FieldLabel>
                  {/* Radix treats "" as "nothing chosen", so original size needs a real value. */}
                  <Select value={String(prefs.longEdge ?? "original")} onValueChange={(v) => setPrefs({ longEdge: v === "original" ? null : Number(v) })}>
                    <SelectTrigger className="min-w-0 flex-1" aria-label="JPG size">
                      {/* The closed control shows only the size; the hints stay in the list. */}
                      <SelectValue>{SIZES.find((s) => s.value === prefs.longEdge)?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {SIZES.map((s) => (
                        <SelectItem key={s.label} value={String(s.value ?? "original")}>
                          {s.label}
                          <span className="text-muted-foreground">{s.value ? " long edge · " : " · "}{s.hint}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {prefs.longEdge && (
                    <Select value={String(prefs.quality)} onValueChange={(v) => setPrefs({ quality: Number(v) })}>
                      <SelectTrigger className="w-36" aria-label="JPG quality">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUALITIES.map((q) => (
                          <SelectItem key={q.value} value={String(q.value)}>
                            {q.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              )}

              <Field>
                <FieldLabel>To</FieldLabel>
                <Button type="button" variant="outline" className="justify-start font-normal" onClick={pickDestination}>
                  <FolderOpen data-icon="inline-start" />
                  <span className="truncate">{prefs.destination ?? "Choose a folder…"}</span>
                </Button>
                <Field orientation="horizontal" className="items-center">
                  <Switch id="export-subfolder" checked={prefs.subfolderOn} onCheckedChange={(v) => setPrefs({ subfolderOn: v })} />
                  <FieldLabel htmlFor="export-subfolder" className="w-auto shrink-0">In a new folder</FieldLabel>
                  <Input
                    value={subfolder}
                    disabled={!prefs.subfolderOn}
                    onChange={(e) => setSubfolder(e.target.value)}
                    className="min-w-0 flex-1"
                    aria-label="New folder name"
                    placeholder={shoot}
                  />
                </Field>
                {sameFolder ? (
                  <FieldDescription className="text-xs text-destructive">That’s the shoot’s own folder. Choose another, or turn on the new folder.</FieldDescription>
                ) : (
                  destinationName && (
                    <FieldDescription className="truncate text-xs">
                      → {destinationName}
                      {sub ? `/${sub}` : ""}
                      {folder && sub && shootName(sub).title !== sub ? ` (${shootName(sub).title})` : ""}
                    </FieldDescription>
                  )
                )}
              </Field>

              <Collapsible defaultOpen={prefs.renameOn} className="flex flex-col gap-3">
                <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                  Naming and options <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-3">
                  <Field orientation="horizontal" className="items-center">
                    <Switch id="export-rename" checked={prefs.renameOn} onCheckedChange={(v) => setPrefs({ renameOn: v })} />
                    <FieldLabel htmlFor="export-rename" className="w-auto shrink-0">Rename files</FieldLabel>
                    <Input
                      disabled={!prefs.renameOn}
                      value={prefs.renamePattern}
                      onChange={(e) => setPrefs({ renamePattern: e.target.value })}
                      className="min-w-0 flex-1"
                      aria-label="Rename pattern"
                    />
                  </Field>
                  <FieldDescription className={cn("text-xs", !prefs.renameOn && "opacity-60")}>
                    <span className="font-mono">→ {prefs.renameOn ? example || "…" : chosen[0]?.name || "MCD_0001"}.JPG</span> · RAW+JPG pairs share a name. Tokens: {RENAME_TOKENS}
                  </FieldDescription>
                  <Field orientation="horizontal">
                    <Switch id="export-open" checked={prefs.openWhenDone} onCheckedChange={(v) => setPrefs({ openWhenDone: v })} />
                    <FieldLabel htmlFor="export-open">Show the folder when done</FieldLabel>
                  </Field>
                  <FieldDescription className="text-xs">Nothing is ever overwritten: a file that’s already there gets a number added.</FieldDescription>
                </CollapsibleContent>
              </Collapsible>
            </FieldGroup>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={!files || sameFolder}>
                <FolderOutput data-icon="inline-start" />
                {!files ? (which === "tagged" ? "No tagged photos" : "Nothing selected") : !prefs.destination ? "Choose a folder…" : `Export ${plural(files, "file")}`}
              </Button>
            </DialogFooter>
          </form>
        )}

        {running && (
          <DialogFooter>
            <Button variant="outline" onClick={() => cancelExport()}>
              Stop
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
