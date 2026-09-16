// Send photos over FTP. The common case is one keystroke and Return: ⇧⌘U picks the tagged photos,
// the last server and JPGs, which already carry their captions.
import { useEffect, useMemo, useState } from "react"
import { Loader2, Send, Settings2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { formatBytes } from "@/lib/api"
import { mod, plural } from "@/lib/format"
import { describeServer, SEND_FILES, sendableFiles, useFtp, type SendFiles, type SendJob } from "@/lib/ftp"
import { cn } from "@/lib/utils"
import { targetPhotos, useStore } from "@/store"
import { useUI } from "@/ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function SendDialog() {
  const { open, sendWhich } = useUI(useShallow((s) => ({ open: s.send, sendWhich: s.sendWhich })))
  const { servers, lastServer, sendFiles, setSendFiles } = useFtp(
    useShallow((s) => ({ servers: s.servers, lastServer: s.lastServer, sendFiles: s.sendFiles, setSendFiles: s.setSendFiles })),
  )
  const { photos, selected, focus, loupe } = useStore(useShallow((s) => ({ photos: s.photos, selected: s.selected, focus: s.focus, loupe: s.loupe })))
  const [which, setWhich] = useState(sendWhich)
  const [serverId, setServerId] = useState<string | null>(null)

  useEffect(() => {
    if (open) setWhich(sendWhich)
  }, [open, sendWhich])

  useEffect(() => {
    if (!serverId || !servers.some((s) => s.id === serverId)) {
      setServerId(servers.find((s) => s.id === lastServer)?.id ?? servers[0]?.id ?? null)
    }
  }, [servers, lastServer, serverId])

  const tagged = useMemo(() => photos.filter((p) => p.tagged), [photos])
  const selection = useMemo(() => targetPhotos({ photos, selected, focus, loupe }), [photos, selected, focus, loupe])
  const chosen = which === "tagged" ? tagged : selection
  const { files, missing } = useMemo(() => sendableFiles(chosen, sendFiles), [chosen, sendFiles])
  const server = servers.find((s) => s.id === serverId) ?? null
  const close = () => useUI.getState().open("send", false)
  const kind = SEND_FILES.find((f) => f.value === sendFiles)!.label

  const send = () => {
    if (!server || !files.length) return
    useFtp.getState().send(server, files, chosen.length - missing)
    close()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send photos</DialogTitle>
          <DialogDescription>Over FTP, with the captions already inside the files.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>Photos</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={which} onValueChange={(v) => v && setWhich(v as typeof which)} className="w-full">
                <ToggleGroupItem value="tagged" className="flex-1">
                  Tagged ({tagged.length.toLocaleString()})
                </ToggleGroupItem>
                <ToggleGroupItem value="selected" className="flex-1">
                  Selected ({selection.length.toLocaleString()})
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field>
              <FieldLabel>Files</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={sendFiles} onValueChange={(v) => v && setSendFiles(v as SendFiles)} className="w-full">
                {SEND_FILES.map((f) => (
                  <ToggleGroupItem key={f.value} value={f.value} className="flex-1">
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

            <Field>
              <FieldLabel>To</FieldLabel>
              <div className="flex gap-2">
                {servers.length ? (
                  <Select value={serverId ?? ""} onValueChange={setServerId}>
                    <SelectTrigger className="min-w-0 flex-1">
                      <SelectValue placeholder="Choose a server" />
                    </SelectTrigger>
                    <SelectContent>
                      {servers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name || s.host}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Button type="button" variant="outline" className="flex-1 justify-start font-normal" onClick={() => useUI.getState().open("ftpServers")}>
                    Add an FTP server…
                  </Button>
                )}
                {servers.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="button" variant="outline" size="icon" aria-label="FTP servers" onClick={() => useUI.getState().open("ftpServers")}>
                        <Settings2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Add or edit servers</TooltipContent>
                  </Tooltip>
                )}
              </div>
              {server && <FieldDescription className="truncate text-xs">{describeServer(server)}</FieldDescription>}
            </Field>
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!server || !files.length}>
              <Send data-icon="inline-start" />
              {files.length ? `Send ${plural(files.length, "file")}` : which === "tagged" ? "No tagged photos" : "Nothing selected"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** In the title bar while anything is queued, sending or just finished. */
export function SendQueue() {
  const jobs = useFtp((s) => s.jobs)
  if (!jobs.length) return null
  const active = jobs.find((j) => j.status === "sending")
  const queued = jobs.filter((j) => j.status === "queued").length
  const failed = jobs.some((j) => j.status === "failed")
  const percent = active?.progress?.bytesTotal ? Math.round((active.progress.bytesDone / active.progress.bytesTotal) * 100) : null

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className={cn("tabular-nums", failed && !active && "text-destructive")} aria-label="Sends">
              {active ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}
              {active ? `${percent ?? 0}%${queued ? ` +${queued}` : ""}` : failed ? "Send failed" : "Sent"}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          FTP sends <Kbd>⇧{mod}U</Kbd>
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex max-h-96 flex-col divide-y overflow-y-auto">
          {[...jobs].reverse().map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </div>
        {jobs.some((j) => j.status !== "queued" && j.status !== "sending") && (
          <div className="border-t p-1.5">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => useFtp.getState().clearFinished()}>
              Clear finished
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function JobRow({ job }: { job: SendJob }) {
  const p = job.progress
  const to = job.server.name || job.server.host
  const fraction = p?.bytesTotal ? p.bytesDone / p.bytesTotal : 0
  const elapsed = job.started ? (Date.now() - job.started) / 1000 : 0
  const rate = elapsed > 2 && p ? p.bytesDone / elapsed : 0
  const detail = (() => {
    switch (job.status) {
      case "queued":
        return `Waiting · ${plural(job.files.length, "file")}`
      case "sending":
        if (!p || p.state === "connecting") return "Connecting…"
        if (p.state === "retrying") return `Connection dropped, retrying… ${p.message ?? ""}`
        return `${p.filesDone + 1} of ${p.filesTotal} · ${p.currentFile}${rate ? ` · ${formatBytes(rate)}/s` : ""}`
      case "stopped":
        return `Stopped · ${plural(job.summary?.sent ?? 0, "file")} sent`
      case "failed":
        return job.summary?.errors[0] ?? "Didn’t finish"
      default: {
        const s = job.summary
        return `${plural(s?.sent ?? 0, "file")} · ${formatBytes(s?.bytes ?? 0)}${s?.skipped ? ` · ${s.skipped} skipped` : ""}${s?.renamed.length ? ` · ${s.renamed.length} renamed` : ""}`
      }
    }
  })()

  return (
    <div className="flex flex-col gap-1.5 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {plural(job.photos, "photo")} → {to}
        </span>
        {(job.status === "sending" || job.status === "queued") && (
          <Button variant="ghost" size="xs" onClick={() => useFtp.getState().cancel(job.id)}>
            Stop
          </Button>
        )}
      </div>
      {job.status === "sending" && <Progress value={fraction * 100} className="h-1" />}
      <p className={cn("text-xs break-words", job.status === "failed" ? "text-destructive" : "text-muted-foreground")} title={job.summary?.errors.join("\n")}>
        {detail}
      </p>
    </div>
  )
}
