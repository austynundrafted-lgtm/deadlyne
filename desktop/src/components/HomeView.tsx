// Home: one job — get to the photos. Open a shoot, or pick up a recent one.
import { useEffect, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { ChevronRight, FolderOpen, Images, X } from "lucide-react"
import logo from "@/assets/logo.png"
import { openFolderDialog } from "@/lib/actions"
import { mod, plural, relativeTime } from "@/lib/format"
import { forgetRecentShoot, onRecentShoots, recentShoots, type RecentShoot } from "@/lib/recents"
import { checkForUpdates } from "@/lib/updates"
import { useStore } from "@/store"
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

        <Button size="lg" className="mt-10 h-12 justify-between px-4 text-base" onClick={openFolderDialog}>
          <span className="flex items-center gap-2">
            <FolderOpen className="size-5" />
            Open a shoot
          </span>
          <Kbd className="bg-black/20 text-primary-foreground">{mod}O</Kbd>
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">or drop a folder anywhere on this window</p>

        {recents.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Recent shoots</h2>
            <ItemGroup className="gap-1">
              {recents.map((s) => (
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
                    <ItemTitle>{s.name}</ItemTitle>
                    <ItemDescription>
                      {plural(s.photos, "photo")} · {relativeTime(s.openedAt)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="opacity-0 group-hover:opacity-100"
                      aria-label={`Remove ${s.name} from recent shoots`}
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
              ))}
            </ItemGroup>
          </section>
        )}

        <footer className="mt-auto flex items-center justify-center gap-2 pt-12 text-xs text-muted-foreground">
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
