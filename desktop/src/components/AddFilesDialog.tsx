// "Add files": briefs, shot lists and other documents join a shoot either as a copy inside the
// shoot folder (it travels with the shoot) or as a link to where the file already is.
import { useEffect, useState } from "react"
import { Copy, FileText, Link2 } from "lucide-react"
import { addFiles } from "@/lib/folders"
import { plural } from "@/lib/format"
import { baseName, folderTitle } from "@/lib/library"
import { cn } from "@/lib/utils"
import { useUI } from "@/ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Mode = "copy" | "link"

const MODES: { value: Mode; icon: typeof Copy; title: string; body: string }[] = [
  {
    value: "copy",
    icon: Copy,
    title: "Copy into the shoot folder",
    body: "A copy is saved next to the photos and travels with the shoot. The original stays where it is.",
  },
  {
    value: "link",
    icon: Link2,
    title: "Link to where it is",
    body: "Nothing is copied. If the file moves or its drive is unplugged, Deadlyne shows it as missing.",
  },
]

export function AddFilesDialog() {
  const pending = useUI((s) => s.addFiles)
  const [mode, setMode] = useState<Mode>("copy")
  const [busy, setBusy] = useState(false)
  // Every batch starts on the safe choice: a copy that travels with the shoot.
  useEffect(() => {
    if (!pending) return
    setBusy(false)
    setMode("copy")
  }, [pending])
  const close = () => useUI.setState({ addFiles: null })

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && !busy && close()}>
      {pending && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add {plural(pending.paths.length, "file")} to {folderTitle(pending.folder)}</DialogTitle>
            <DialogDescription>They appear under Documents, apart from the photos.</DialogDescription>
          </DialogHeader>

          <ul className="flex max-h-28 flex-col gap-1 overflow-y-auto rounded-lg bg-black/20 p-2 text-xs">
            {pending.paths.map((p) => (
              <li key={p} className="flex items-center gap-2 truncate text-muted-foreground" title={p}>
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate text-foreground/90">{baseName(p)}</span>
              </li>
            ))}
          </ul>

          <div role="radiogroup" aria-label="How to add them" className="flex flex-col gap-2">
            {MODES.map(({ value, icon: Icon, title, body }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "flex items-start gap-3 rounded-lg p-3 text-left shadow-edge outline-none transition-[background-color,box-shadow] duration-100 hover:shadow-edge-hover focus-visible:ring-3 focus-visible:ring-ring/50",
                  mode === value ? "bg-primary/12" : "bg-card/40 hover:bg-card",
                )}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", mode === value ? "text-primary" : "text-muted-foreground")} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{body}</span>
                </span>
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await addFiles(pending.folder, pending.paths, mode)
                } finally {
                  close()
                }
              }}
            >
              {mode === "copy" ? "Copy" : "Link"} {plural(pending.paths.length, "file")}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
