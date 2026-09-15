// Home: one job — get to the photos. Ingest a card, open a shoot, or pick up a recent one.
import { useEffect, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { ChevronRight, FolderOpen, HardDriveDownload, Images, X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import logo from "@/assets/logo.png"
import { openFolderDialog } from "@/lib/actions"
import { mod, plural, relativeTime } from "@/lib/format"
import { forgetRecentShoot, onRecentShoots, recentShoots, type RecentShoot } from "@/lib/recents"
import { shootName, shootSubtitle } from "@/lib/shootName"
import { checkForUpdates } from "@/lib/updates"
import { useStore } from "@/store"
import { useUI } from "@/ui"
import { BadgeMedal, nextBadge, useAchievements } from "@/components/BadgesDialog"
import { IngestProgressView, useIngest } from "@/components/IngestDialog"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Kbd } from "@/components/ui/kbd"

export function HomeView() {
  const openFolder = useStore((s) => s.openFolder)
  const profile = useStore((s) => s.profile)
  const workspace = useStore((s) => s.workspace)
  const { cards, running } = useIngest(useShallow((s) => ({ cards: s.cards, running: s.running })))
  const { summary, refresh } = useAchievements()
  const next = summary ? nextBadge(summary) : null

  useEffect(() => {
    if (workspace === "home") refresh()
  }, [workspace, running, refresh])
  const [recents, setRecents] = useState<RecentShoot[]>([])
  const [version, setVersion] = useState("")

  useEffect(() => {
    recentShoots().then(setRecents)
    getVersion().then(setVersion)
    return onRecentShoots(setRecents)
  }, [])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-xl flex-col px-6 py-14">
        <div className="flex items-center gap-3">
          <img src={logo} alt="" className="size-11" draggable={false} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Deadlyne</h1>
            <p className="text-sm text-muted-foreground">From card to captioned, before the deadline.</p>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3">
          <Button size="lg" className="h-auto flex-col items-start gap-1 px-4 py-3 text-left" onClick={() => useUI.getState().open("ingest")}>
            <span className="flex w-full items-center gap-2 text-base">
              <HardDriveDownload className="size-5" /> Ingest
              <Kbd className="ml-auto bg-black/20 text-primary-foreground">⇧{mod}I</Kbd>
            </span>
            <span className="text-xs font-normal opacity-85">{cards[0] ? `${cards[0].name} is ready` : "Copy a card into a named folder"}</span>
          </Button>
          <Button size="lg" variant="secondary" className="h-auto flex-col items-start gap-1 px-4 py-3 text-left" onClick={openFolderDialog}>
            <span className="flex w-full items-center gap-2 text-base">
              <FolderOpen className="size-5" /> Open a shoot
              <Kbd className="ml-auto">{mod}O</Kbd>
            </span>
            <span className="text-xs font-normal text-muted-foreground">or drop a folder on this window</span>
          </Button>
        </div>

        {running && (
          <Item variant="outline" className="mt-3 bg-card/60">
            <ItemContent>
              <ItemTitle>Ingesting…</ItemTitle>
              <IngestProgressView compact />
            </ItemContent>
            <ItemActions>
              <Button variant="outline" size="sm" onClick={() => useUI.getState().open("ingest")}>
                Show
              </Button>
            </ItemActions>
          </Item>
        )}

        {recents.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Recent shoots</h2>
            <ItemGroup className="gap-1">
              {recents.map((s) => {
                const name = shootName(s.name)
                return (
                <Item
                  key={s.path}
                  variant="outline"
                  size="sm"
                  className="group cursor-pointer bg-card/40 hover:bg-card"
                  onClick={() => openFolder(s.path)}
                  title={s.path}
                >
                  <ItemMedia variant="icon">
                    <Images />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{name.title}</ItemTitle>
                    <ItemDescription>
                      {[shootSubtitle(name), plural(s.photos, "photo"), relativeTime(s.openedAt)].filter(Boolean).join(" · ")}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 group-hover:opacity-100"
                      aria-label={`Remove ${name.title} from recent shoots`}
                      onClick={(e) => {
                        e.stopPropagation()
                        forgetRecentShoot(s.path)
                      }}
                    >
                      <X />
                    </Button>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </ItemActions>
                </Item>
                )
              })}
            </ItemGroup>
          </section>
        )}

        {summary && (
          <button
            className="mt-8 flex items-center gap-3 rounded-lg border bg-card/40 px-3 py-2.5 text-left text-sm hover:bg-card"
            onClick={() => useUI.getState().open("badges")}
          >
            {next && <BadgeMedal badge={next.badge} earned={false} size={32} />}
            <span className="min-w-0 flex-1">
              <span className="font-medium">This month</span>
              <span className="text-muted-foreground">
                {" "}· {plural(summary.month.photos, "photo")} · {plural(summary.month.shoots, "shoot")}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {next ? `Next badge: ${next.badge.name} · ${next.toGo.toLocaleString()} to go` : "Every photo badge earned"}
              </span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        )}

        <footer className="mt-auto flex items-center justify-center gap-2 pt-12 text-xs text-muted-foreground">
          <Button variant="link" size="xs" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => useUI.getState().open("profile")}>
            {profile?.name || "Set up profile"}
          </Button>
          <span>·</span>
          <span>Version {version}</span>
          <span>·</span>
          <Button variant="link" size="xs" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => checkForUpdates({ quiet: false })}>
            Check for updates
          </Button>
        </footer>
      </div>
    </div>
  )
}
