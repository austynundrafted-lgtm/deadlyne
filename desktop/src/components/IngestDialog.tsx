// Ingest: copy a memory card into a named, dated folder, then open it. The common case is two
// clicks: the card is picked automatically and the last destination and naming are remembered.
import { useEffect, useMemo, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { ChevronDown, FolderOpen, HardDrive } from "lucide-react"
import { toast } from "sonner"
import { create } from "zustand"
import {
  cancelIngest,
  formatBytes,
  freeSpace,
  inspectSource,
  memoryCards,
  startIngest,
  type Card,
  type IngestOptions,
  type IngestProgress,
  type IngestSummary,
  type SourceInfo,
} from "@/lib/api"
import { plural } from "@/lib/format"
import { getSetting, setSetting } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { notifyBadges, useStore } from "@/store"
import { useUI } from "@/ui"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

export interface IngestPrefs {
  destination: string | null
  job: string
  folderPattern: string
  renameOn: boolean
  renamePattern: string
  skipExisting: boolean
  eject: boolean
}

const DEFAULT_PREFS: IngestPrefs = {
  destination: null,
  job: "",
  folderPattern: "{date}_{job}",
  renameOn: false,
  renamePattern: "{job}_{seq}",
  skipExisting: true,
  eject: false,
}

/** The ingest running now, shared by the dialog and Home. */
interface IngestState {
  running: boolean
  progress: IngestProgress | null
  started: number | null
  source: string | null
  cards: Card[]
  prefs: IngestPrefs
  setPrefs: (p: Partial<IngestPrefs>) => void
  refreshCards: () => Promise<void>
}

export const useIngest = create<IngestState>((set, get) => ({
  running: false,
  progress: null,
  started: null,
  source: null,
  cards: [],
  prefs: DEFAULT_PREFS,
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p }
    set({ prefs })
    setSetting("ingest", prefs)
  },
  refreshCards: async () => {
    const cards = await memoryCards()
    if (JSON.stringify(cards) !== JSON.stringify(get().cards)) set({ cards })
  },
}))

/** Wires ingest events once at launch. */
let ingestWired = false

export async function initIngest() {
  if (ingestWired) return
  ingestWired = true
  useIngest.setState({ prefs: { ...DEFAULT_PREFS, ...(await getSetting<Partial<IngestPrefs>>("ingest", {})) } })
  await listen<IngestProgress>("ingest-progress", (e) => useIngest.setState({ progress: e.payload, started: useIngest.getState().started ?? Date.now() }))
  await listen<IngestSummary>("ingest-done", (e) => {
    const s = e.payload
    useIngest.setState({ running: false, progress: null, started: null, source: null })
    useUI.getState().open("ingest", false)
    const size = formatBytes(s.bytes)
    const message = `${s.cancelled ? "Stopped" : "Ingest done"}: copied ${plural(s.copied, "file")} (${size})${s.skipped ? `, skipped ${s.skipped} already ingested` : ""}${s.ejected ? ". Card ejected." : "."}`
    if (s.errors.length) toast.error("Ingest finished with problems", { description: s.errors.slice(0, 5).join("\n"), duration: Infinity })
    else toast.success(message)
    notifyBadges(s.unlocked)
    if (s.firstFolder && !s.cancelled) useStore.getState().openFolder(s.firstFolder)
  })
  useIngest.getState().refreshCards()
  window.setInterval(() => useIngest.getState().refreshCards(), 4000)
}

export function names(prefs: IngestPrefs, seq: number) {
  const now = new Date()
  const two = (n: number) => String(n).padStart(2, "0")
  const job = prefs.job.trim().replace(/[\\/]/g, "-")
  const tokens: Record<string, string> = {
    "{job}": job || "Untitled",
    "{date}": `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`,
    "{year}": String(now.getFullYear()),
    "{month}": two(now.getMonth() + 1),
    "{day}": two(now.getDate()),
    "{time}": `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`,
    "{seq}": String(seq).padStart(4, "0"),
    "{original}": "MCD_0001",
    "{camera}": "CanonEOSR3",
  }
  const expand = (p: string) => p.replace(/\{[a-z]+\}/g, (t) => tokens[t] ?? t).replace(/[:/\\]/g, "-").trim()
  let folder = expand(prefs.folderPattern)
  if (!job) folder = folder.replace(/[_-]Untitled/g, "")
  return { folder: folder || "Ingest", file: (prefs.renameOn && expand(prefs.renamePattern)) || "MCD_0001" }
}

export function IngestDialog() {
  const open = useUI((s) => s.ingest)
  const { cards, prefs, setPrefs, running, progress } = useIngest()
  const [source, setSource] = useState<string | null>(null)
  const [customSources, setCustomSources] = useState<string[]>([])
  const [info, setInfo] = useState<SourceInfo | null>(null)
  const [space, setSpace] = useState<number | null>(null)
  const [firstSeq, setFirstSeq] = useState(1)

  const sources = useMemo(() => [...cards.map((c) => c.path), ...customSources.filter((s) => !cards.some((c) => c.path === s))], [cards, customSources])

  useEffect(() => {
    if (!open) return
    useIngest.getState().refreshCards()
  }, [open])

  useEffect(() => {
    if (!source || !sources.includes(source)) setSource(sources[0] ?? null)
  }, [sources, source])

  useEffect(() => {
    setInfo(null)
    if (source) inspectSource(source).then(setInfo)
  }, [source])

  useEffect(() => {
    setSpace(null)
    if (prefs.destination) freeSpace(prefs.destination).then(setSpace)
  }, [prefs.destination, open])

  const close = () => useUI.getState().open("ingest", false)
  const example = names(prefs, firstSeq)
  const tooBig = info && space !== null && info.bytes > space
  const sourceLabel = (p: string) => cards.find((c) => c.path === p)?.name ?? p

  const start = async () => {
    if (!source || !prefs.destination) return
    const options: IngestOptions = {
      source,
      destination: prefs.destination,
      job: prefs.job,
      folderPattern: prefs.folderPattern,
      renamePattern: prefs.renameOn ? prefs.renamePattern : null,
      firstSeq,
      skipExisting: prefs.skipExisting,
      eject: prefs.eject,
    }
    // Mark it running first: a small card can finish before the start call even returns.
    useIngest.setState({ running: true, source, started: null, progress: null })
    try {
      await startIngest(options)
    } catch (e) {
      useIngest.setState({ running: false, source: null })
      toast.error("Couldn’t start the ingest", { description: String(e) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ingest photos</DialogTitle>
          <DialogDescription>Copies a card into a named folder, never overwrites, then opens it for culling.</DialogDescription>
        </DialogHeader>

        {running ? (
          <IngestProgressView />
        ) : (
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>From</FieldLabel>
              <Select
                value={source ?? ""}
                onValueChange={async (v) => {
                  if (v !== "__choose") return setSource(v)
                  const picked = await openDialog({ directory: true, title: "Choose a card or folder to ingest from" })
                  if (typeof picked === "string") {
                    setCustomSources((c) => [...new Set([...c, picked])])
                    setSource(picked)
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="No memory card found" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s} value={s}>
                      <HardDrive /> {sourceLabel(s)}
                    </SelectItem>
                  ))}
                  {sources.length > 0 && <SelectSeparator />}
                  <SelectItem value="__choose">Choose a folder…</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                {!source ? "Insert a card, or choose a folder." : info ? `${info.camera || "Photos"} · ${plural(info.photos, "photo")} · ${formatBytes(info.bytes)}` : "Counting photos…"}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>To</FieldLabel>
              <Button
                variant="outline"
                className="justify-start font-normal"
                onClick={async () => {
                  const picked = await openDialog({ directory: true, title: "Where should ingested photos go?" })
                  if (typeof picked === "string") setPrefs({ destination: picked })
                }}
              >
                <FolderOpen data-icon="inline-start" />
                <span className="truncate">{prefs.destination ?? "Choose a destination…"}</span>
              </Button>
              {space !== null && (
                <FieldDescription className={cn(tooBig && "text-destructive")}>
                  {tooBig ? `Not enough room: ${formatBytes(space)} free, ${formatBytes(info!.bytes)} needed.` : `${formatBytes(space)} free`}
                </FieldDescription>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="ingest-job">Job name</FieldLabel>
              <Input id="ingest-job" value={prefs.job} onChange={(e) => setPrefs({ job: e.target.value })} placeholder="e.g. Fairborn-vs-Tecumseh" />
              <FieldDescription className="text-xs">
                <span className="font-mono">→ {example.folder}/{example.file}.CR3</span>
                {prefs.folderPattern.includes("{date}") && " · dated by each photo’s capture day"}
              </FieldDescription>
            </Field>

            <Collapsible className="flex flex-col gap-3">
              <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                Naming and options <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-3">
                <Field>
                  <FieldLabel htmlFor="ingest-folder">Folder name</FieldLabel>
                  <Input id="ingest-folder" value={prefs.folderPattern} onChange={(e) => setPrefs({ folderPattern: e.target.value })} />
                </Field>
                <Field orientation="horizontal" className="items-center">
                  <Switch id="ingest-rename" checked={prefs.renameOn} onCheckedChange={(v) => setPrefs({ renameOn: v })} />
                  <FieldLabel htmlFor="ingest-rename" className="w-auto">Rename files</FieldLabel>
                  <Input disabled={!prefs.renameOn} value={prefs.renamePattern} onChange={(e) => setPrefs({ renamePattern: e.target.value })} className="flex-1" />
                  <Input
                    disabled={!prefs.renameOn}
                    type="number"
                    min={0}
                    value={firstSeq}
                    onChange={(e) => setFirstSeq(Math.max(0, Number(e.target.value) || 0))}
                    className="w-20"
                    aria-label="First sequence number"
                  />
                </Field>
                <FieldDescription className="text-xs">
                  Tokens: {"{job} {date} {year} {month} {day} {time} {seq} {original} {camera}"}
                </FieldDescription>
                <Field orientation="horizontal">
                  <Switch id="ingest-skip" checked={prefs.skipExisting} onCheckedChange={(v) => setPrefs({ skipExisting: v })} />
                  <FieldLabel htmlFor="ingest-skip">Skip photos already ingested</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Switch id="ingest-eject" checked={prefs.eject} onCheckedChange={(v) => setPrefs({ eject: v })} />
                  <FieldLabel htmlFor="ingest-eject">Eject the card when done</FieldLabel>
                </Field>
              </CollapsibleContent>
            </Collapsible>
          </FieldGroup>
        )}

        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={() => cancelIngest()}>
              Stop
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button disabled={!source || !prefs.destination || !!tooBig} onClick={start}>
                Ingest{info ? ` ${plural(info.photos, "photo")}` : ""}
              </Button>
            </>
          )}
        </DialogFooter>
        {running && !progress && <p className="text-xs text-muted-foreground">Scanning the card…</p>}
      </DialogContent>
    </Dialog>
  )
}

export function IngestProgressView({ compact }: { compact?: boolean }) {
  const { progress, started } = useIngest()
  if (!progress) return <Progress value={null} />
  const fraction = progress.bytesTotal ? progress.bytesDone / progress.bytesTotal : 0
  const elapsed = started ? (Date.now() - started) / 1000 : 0
  const remaining = fraction > 0.02 && elapsed > 2 ? Math.round((elapsed / fraction) * (1 - fraction)) : null
  const eta = remaining === null ? "" : remaining < 60 ? ` · about ${remaining}s left` : ` · about ${Math.round(remaining / 60)} min left`
  return (
    <div className="flex flex-col gap-2">
      <Progress value={fraction * 100} />
      <p className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>
        {progress.filesDone.toLocaleString()} of {plural(progress.filesTotal, "file")} · {formatBytes(progress.bytesTotal - progress.bytesDone)} to go{eta}
      </p>
    </div>
  )
}
