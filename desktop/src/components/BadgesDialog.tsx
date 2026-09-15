// Badges: milestones for photos ingested and shoots. Earned badges light up; locked ones show
// progress. Artwork (512px PNG per badge id) can replace the placeholder medallions later.
import { useEffect, useState } from "react"
import { Lock } from "lucide-react"
import { create } from "zustand"
import { achievements, type AchievementSummary, type Badge } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useUI } from "@/ui"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"

export const useAchievements = create<{ summary: AchievementSummary | null; refresh: () => Promise<void> }>((set) => ({
  summary: null,
  refresh: async () => set({ summary: await achievements() }),
}))

const TIERS = [
  "from-amber-700 to-amber-900 text-amber-100", // bronze
  "from-zinc-300 to-zinc-500 text-zinc-900", // silver
  "from-yellow-300 to-amber-500 text-amber-950", // gold
  "from-orange-500 to-red-700 text-white", // elite (brand)
]

export function shortNumber(n: number) {
  if (n >= 1_000_000) return `${n / 1_000_000}M`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function BadgeMedal({ badge, earned, size = 64 }: { badge: Badge; earned: boolean; size?: number }) {
  const [art, setArt] = useState(true)
  const shape = badge.track === "shoots" ? "[clip-path:polygon(25%_4%,75%_4%,100%_50%,75%_96%,25%_96%,0_50%)]" : "rounded-full"
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {art && (
        <img
          src={`/badges/${badge.id}.png`}
          alt=""
          className={cn("absolute inset-0 size-full", !earned && "opacity-40 grayscale")}
          onError={() => setArt(false)}
        />
      )}
      {!art && (
        <div
          className={cn(
            "flex size-full items-center justify-center bg-linear-to-br font-bold shadow-inner",
            shape,
            earned ? TIERS[badge.tier] : "from-zinc-700 to-zinc-800 text-zinc-500",
          )}
          style={{ fontSize: size * 0.24 }}
        >
          {earned ? shortNumber(badge.threshold) : <Lock style={{ width: size * 0.3, height: size * 0.3 }} />}
        </div>
      )}
    </div>
  )
}

export function BadgesDialog() {
  const open = useUI((s) => s.badges)
  const { summary, refresh } = useAchievements()
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && useUI.getState().open("badges", false)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Badges</DialogTitle>
          <DialogDescription>
            {summary ? `${summary.photos.toLocaleString()} photos and ${summary.shoots.toLocaleString()} shoots so far.` : "Loading…"} A RAW+JPG pair counts once, and reopening a shoot never counts twice.
          </DialogDescription>
        </DialogHeader>
        {summary && (
          <ScrollArea className="max-h-[60vh]">
            {(["photos", "shoots"] as const).map((track) => {
              const value = track === "photos" ? summary.photos : summary.shoots
              const list = summary.badges.filter((b) => b.track === track)
              return (
                <section key={track} className="mb-6">
                  <h3 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {track === "photos" ? "Photos ingested" : "Shoots"}
                  </h3>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {list.map((b) => {
                      const earnedAt = summary.earned[b.id]
                      return (
                        <div key={b.id} className="flex flex-col items-center gap-2 rounded-lg border bg-card/50 p-3 text-center">
                          <BadgeMedal badge={b} earned={!!earnedAt} />
                          <div className={cn("text-sm font-medium", !earnedAt && "text-muted-foreground")}>{b.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {earnedAt
                              ? new Date(earnedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                              : `${b.threshold.toLocaleString()} ${track}`}
                          </div>
                          {!earnedAt && <Progress value={Math.min(100, (value / b.threshold) * 100)} className="h-1" />}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The next badge on the photos track and how far away it is. */
export function nextBadge(summary: AchievementSummary) {
  const b = summary.badges.find((x) => x.track === "photos" && !summary.earned[x.id])
  return b ? { badge: b, toGo: b.threshold - summary.photos } : null
}
