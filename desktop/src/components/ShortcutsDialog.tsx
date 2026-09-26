// Every keyboard shortcut on one sheet (press ?). The keys match the Mac app.
import { alt, mod, shift } from "@/lib/format"
import { useUI } from "@/ui"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Culling",
    keys: [
      [["T"], "Tag or untag"],
      [["0–5"], "Rate"],
      [["6", "7", "8", "9"], "Red, yellow, green, blue label"],
      [[`${shift}${mod}A`], "Auto-advance in the loupe"],
      [[`${shift}${mod}T`], "Select tagged"],
    ],
  },
  {
    title: "Looking",
    keys: [
      [["Space"], "Loupe"],
      [["Z"], "Zoom to 100%"],
      [["←", "→", "↑", "↓"], "Move (hold ⇧ to extend)"],
      [["Esc"], "Back to the grid"],
      [[`${mod}+`, `${mod}−`], "Bigger or smaller thumbnails"],
      [[`${mod}A`, `${mod}D`], "Select all, deselect"],
    ],
  },
  {
    title: "Captions",
    keys: [
      [[`${mod}I`], "Caption panel"],
      [[`${mod}↩`], "Edit caption"],
      [[`${alt}${mod}C`, `${alt}${mod}V`], "Copy, paste caption info"],
      [[`${alt}${mod}P`], "Fill credits from profile"],
    ],
  },
  {
    title: "Filters",
    keys: [
      [[`${mod}F`], "Search"],
      [[`${alt}${mod}1`, "2", "3"], "All, tagged, untagged"],
      [[`${alt}${mod}4`, "5", "6"], "RAW + JPG, RAW, JPG"],
    ],
  },
  {
    title: "Files",
    keys: [
      [[`${shift}${mod}C`, `${shift}${mod}M`], "Copy, move tagged"],
      [[`${shift}${mod}U`], "Send via FTP"],
      [[`${shift}${mod}R`], `Show in ${navigator.userAgent.includes("Mac") ? "Finder" : "Explorer"}`],
      [[`${mod}E`], "Open in default app"],
      [[`${mod}⌫`], "Move to Trash"],
    ],
  },
  {
    title: "Everywhere",
    keys: [
      [[`${mod}1`, "2", "3"], "Home, Photos, Codes"],
      [[`${mod}O`], "Open a shoot"],
      [[`${shift}${mod}I`], "Ingest a card"],
      [["?"], "This sheet"],
    ],
  },
]

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcuts)
  return (
    <Dialog open={open} onOpenChange={(o) => useUI.getState().open("shortcuts", o)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>The same keys as Deadlyne for Mac. Press ? anywhere to see this again.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{g.title}</h3>
              <dl className="flex flex-col">
                {g.keys.map(([keys, what]) => (
                  <div key={what} className="flex items-center justify-between gap-3 py-1 text-sm">
                    <dt className="text-foreground/90">{what}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
