// Shoots and collections as folders: a grid of folder cards or a dense list with a progress
// column. Used for the library lists (All shoots, a collection…) and for an open folder's
// subfolders. Click selects, double-click or Return opens, arrows move, right-click for more.
import { useEffect, useMemo, useState } from "react"
import { ArrowDownUp, FolderOpen, HardDriveDownload, LayoutGrid, List, Plus, TriangleAlert } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { openFolderDialog } from "@/lib/actions"
import { dragSource, useDnd, useDropTarget, type DragItem } from "@/lib/dnd"
import { newCollection, openShoot } from "@/lib/folders"
import { isIPad, mod, plural, relativeTime } from "@/lib/format"
import {
  baseName,
  descendantIds,
  samePath,
  SECTION_TITLES,
  statsFor,
  useLibrary,
  type FolderStats,
  type LibrarySection,
} from "@/lib/library"
import { pref, setPref } from "@/lib/settings"
import { shootName, shootSubtitle } from "@/lib/shootName"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"
import { useUI } from "@/ui"
import { FolderIcon } from "@/components/FolderIcon"
import { collectionMenu, ContextEntries, folderMenu } from "@/components/LibraryMenus"
import { byTitle, topLevelShoots } from "@/components/Sidebar"
import { ViewProgress } from "@/components/ViewProgress"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type ViewMode = "grid" | "list"
type Sort = "name" | "opened" | "progress"

export type CardItem =
  | { kind: "folder"; path: string; title: string; subtitle?: string; openedAt?: number }
  | { kind: "collection"; id: string; title: string; count: number }

const itemKey = (i: CardItem) => (i.kind === "folder" ? i.path : `c:${i.id}`)

// MARK: - View mode (shared by every folder list)

let viewMode: ViewMode = pref("folderView", "grid")
export function useViewMode() {
  const [mode, setMode] = useState(viewMode)
  useEffect(() => {
    const sync = () => setMode(viewMode)
    window.addEventListener("deadlyne-folder-view", sync)
    return () => window.removeEventListener("deadlyne-folder-view", sync)
  }, [])
  const set = (m: ViewMode) => {
    viewMode = m
    setPref("folderView", m)
    window.dispatchEvent(new Event("deadlyne-folder-view"))
  }
  return [mode, set] as const
}

export function ViewModeToggle() {
  const [mode, setMode] = useViewMode()
  return (
    <ToggleGroup type="single" size="sm" value={mode} onValueChange={(v) => v && setMode(v as ViewMode)} aria-label="View as">
      <ToggleGroupItem value="grid" aria-label="Grid" className="text-muted-foreground data-[state=on]:text-foreground">
        <LayoutGrid />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List" className="text-muted-foreground data-[state=on]:text-foreground">
        <List />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

// MARK: - Library section

export function LibraryView({ section }: { section: LibrarySection }) {
  const { shoots, collections, stats, loaded } = useLibrary(
    useShallow((s) => ({ shoots: s.shoots, collections: s.collections, stats: s.stats, loaded: s.loaded })),
  )
  const [mode] = useViewMode()
  const [sort, setSort] = useState<Sort>(() => pref("librarySort", section.kind === "recent" ? "opened" : "name"))
  const collection = section.kind === "collection" ? collections.find((c) => c.id === section.id) : undefined

  const { title, items } = useMemo(() => {
    const asFolder = (path: string, openedAt?: number): CardItem => {
      const name = shootName(baseName(path))
      return { kind: "folder", path, title: name.title, subtitle: shootSubtitle(name), openedAt }
    }
    const pick = (list: typeof shoots) => list.map((s) => asFolder(s.path, s.openedAt))
    switch (section.kind) {
      case "all":
        return { title: SECTION_TITLES.all, items: pick(topLevelShoots(shoots.filter((s) => !s.archived))) }
      case "recent":
        return {
          title: SECTION_TITLES.recent,
          items: pick(shoots.filter((s) => s.openedAt > 0).sort((a, b) => b.openedAt - a.openedAt).slice(0, 24)),
        }
      case "favorites":
        return { title: SECTION_TITLES.favorites, items: pick(shoots.filter((s) => s.favorite)) }
      case "archive":
        return { title: SECTION_TITLES.archive, items: pick(shoots.filter((s) => s.archived)) }
      case "collection": {
        if (!collection) return { title: "Collection", items: [] }
        const subs: CardItem[] = collections
          .filter((c) => c.parent === collection.id)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({ kind: "collection", id: c.id, title: c.name, count: c.shoots.length }))
        const opened = new Map(shoots.map((s) => [s.path, s.openedAt]))
        return { title: collection.name, items: [...subs, ...collection.shoots.map((p) => asFolder(p, opened.get(p)))] }
      }
    }
  }, [section, shoots, collections, collection])

  const sorted = useMemo(() => {
    if (section.kind === "recent") return items
    const progress = (i: CardItem) => {
      const s = i.kind === "folder" ? statsFor(stats, i.path) : undefined
      return s?.totalPhotos ? s.totalViewed / s.totalPhotos : 2
    }
    return [...items].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "collection" ? -1 : 1
      if (sort === "opened") return ((b as { openedAt?: number }).openedAt ?? 0) - ((a as { openedAt?: number }).openedAt ?? 0)
      if (sort === "progress") return progress(a) - progress(b)
      return a.kind === "folder" && b.kind === "folder" ? byTitle(a, b) : a.title.localeCompare(b.title)
    })
  }, [items, sort, stats, section.kind])

  const shootCount = items.filter((i) => i.kind === "folder").length
  const origin = section

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
        <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{plural(shootCount, "shoot")}</span>
        <div className="flex-1" />
        {section.kind === "collection" && collection && (
          <Button variant="ghost" size="sm" onClick={() => newCollection(collection.id)}>
            <Plus data-icon="inline-start" />
            Collection
          </Button>
        )}
        {section.kind !== "recent" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Sort">
                <ArrowDownUp />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(v) => {
                  setSort(v as Sort)
                  setPref("librarySort", v)
                }}
              >
                <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="opened">Last opened</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="progress">Least reviewed first</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <ViewModeToggle />
      </header>

      {!loaded ? null : sorted.length === 0 ? (
        <SectionEmpty section={section} />
      ) : (
        <FolderItems items={sorted} mode={mode} origin={origin} collectionId={collection?.id} />
      )}
    </div>
  )
}

function SectionEmpty({ section }: { section: LibrarySection }) {
  const copy: Record<LibrarySection["kind"], [string, string]> = {
    all: ["No shoots yet", "Ingest a card or open a shoot folder. Every shoot you open is listed here."],
    recent: ["Nothing opened yet", "Shoots you open show up here, newest first."],
    favorites: ["No favorites", "Right-click a shoot and choose Add to Favorites, or drag it onto Favorites."],
    archive: ["Nothing archived", "Archive finished shoots to keep the Folders list short. Their files stay put."],
    collection: ["This collection is empty", "Drag shoots from the sidebar onto it, or right-click a shoot → Add to collection."],
  }
  const [title, body] = copy[section.kind]
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia>
          <FolderIcon size={72} kind={section.kind === "collection" ? "collection" : "folder"} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      {section.kind === "all" && (
        <EmptyContent className="flex-row justify-center">
          <Button onClick={() => useUI.getState().open("ingest")}>
            <HardDriveDownload data-icon="inline-start" />
            Ingest
          </Button>
          <Button variant="secondary" onClick={openFolderDialog}>
            <FolderOpen data-icon="inline-start" />
            Open a shoot <Kbd className="ml-1">{mod}O</Kbd>
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

// MARK: - Cards and rows

/** Arrow keys move between cards (grid: by position; list: up and down). */
function onItemsKey(e: React.KeyboardEvent<HTMLElement>, open: (key: string) => void) {
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-card]")]
  const i = cards.indexOf(document.activeElement as HTMLElement)
  if (i < 0) return
  if (e.key === "Enter") {
    e.preventDefault()
    return open(cards[i].dataset.card!)
  }
  const r = cards[i].getBoundingClientRect()
  let next: HTMLElement | undefined
  if (e.key === "ArrowRight") next = cards[i + 1]
  else if (e.key === "ArrowLeft") next = cards[i - 1]
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const down = e.key === "ArrowDown"
    const row = cards.filter((c) => {
      const b = c.getBoundingClientRect()
      return down ? b.top > r.top + 4 : b.top < r.top - 4
    })
    const targetTop = down ? Math.min(...row.map((c) => c.getBoundingClientRect().top)) : Math.max(...row.map((c) => c.getBoundingClientRect().top))
    next = row
      .filter((c) => Math.abs(c.getBoundingClientRect().top - targetTop) < 4)
      .sort((a, b) => Math.abs(a.getBoundingClientRect().left - r.left) - Math.abs(b.getBoundingClientRect().left - r.left))[0]
  } else return
  e.preventDefault()
  next?.focus()
  next?.scrollIntoView({ block: "nearest" })
}

export function FolderItems({
  items,
  mode,
  origin,
  collectionId,
}: {
  items: CardItem[]
  mode: ViewMode
  origin?: LibrarySection
  collectionId?: string
}) {
  const stats = useLibrary((s) => s.stats)
  const openFolder = useStore((s) => s.folder)
  const [selected, setSelected] = useState<string | null>(null)
  const openItem = (i: CardItem) =>
    i.kind === "folder" ? openShoot(i.path, origin) : useStore.getState().showSection({ kind: "collection", id: i.id })
  const byKey = new Map(items.map((i) => [itemKey(i), i]))
  const keyNav = (e: React.KeyboardEvent<HTMLElement>) => onItemsKey(e, (k) => byKey.get(k) && openItem(byKey.get(k)!))

  const props = (i: CardItem) => ({
    item: i,
    stats: i.kind === "folder" ? statsFor(stats, i.path) : undefined,
    selected: selected === itemKey(i),
    current: i.kind === "folder" && !!openFolder && samePath(openFolder, i.path),
    origin,
    collectionId,
    onSelect: () => setSelected(itemKey(i)),
    onOpen: () => openItem(i),
  })

  if (mode === "list") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={keyNav}>
        <div role="table" aria-label="Folders" className="min-w-[560px] px-2 pb-4">
          <div role="row" className="sticky top-0 z-10 grid h-8 items-center gap-3 bg-background px-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide" style={{ gridTemplateColumns: LIST_COLUMNS }}>
            <span role="columnheader" className="col-span-2">Name</span>
            <span role="columnheader" className="text-right">Photos</span>
            <span role="columnheader" className="text-right">Docs</span>
            <span role="columnheader">Opened</span>
            <span role="columnheader">Viewed</span>
          </div>
          {items.map((i) => (
            <ItemMenu key={itemKey(i)} item={i} origin={origin} collectionId={collectionId}>
              <ListRow {...props(i)} />
            </ItemMenu>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={keyNav}>
      <div role="list" aria-label="Folders" className="grid gap-1 p-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(164px, 1fr))" }}>
        {items.map((i) => (
          <ItemMenu key={itemKey(i)} item={i} origin={origin} collectionId={collectionId}>
            <GridCard {...props(i)} />
          </ItemMenu>
        ))}
      </div>
    </div>
  )
}

function ItemMenu({ item, origin, collectionId, children }: { item: CardItem; origin?: LibrarySection; collectionId?: string; children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextEntries entries={item.kind === "folder" ? folderMenu(item.path, { origin, collectionId }) : collectionMenu(item.id)} />
    </ContextMenu>
  )
}

interface ItemProps extends React.HTMLAttributes<HTMLButtonElement> {
  ref?: React.Ref<HTMLButtonElement>
  item: CardItem
  stats?: FolderStats
  selected: boolean
  /** The folder open in the Photos view right now. */
  current: boolean
  origin?: LibrarySection
  collectionId?: string
  onSelect: () => void
  onOpen: () => void
}

/** Drag and drop for one card: shoots drag; collections drag and accept shoots and collections. */
function useCardDnd(item: CardItem, collectionId?: string) {
  const dropId = item.kind === "collection" ? `card:${item.id}` : ""
  const state = useDropTarget(dropId, {
    accepts: (d: DragItem) =>
      item.kind === "collection" &&
      (d.kind === "shoot"
        ? !useLibrary.getState().collections.find((c) => c.id === item.id)?.shoots.some((p) => samePath(p, d.path))
        : d.id !== item.id && !descendantIds(useLibrary.getState().collections, d.id).has(item.id)),
    drop: (d) => {
      if (item.kind !== "collection") return
      if (d.kind === "shoot") useLibrary.getState().addToCollection(item.id, [d.path])
      else useLibrary.getState().moveCollection(d.id, item.id)
    },
  })
  const dragging = useDnd((s) =>
    item.kind === "folder" ? s.item?.kind === "shoot" && samePath(s.item.path, item.path) : s.item?.kind === "collection" && s.item.id === item.id,
  )
  const onPointerDown = dragSource(() =>
    item.kind === "folder"
      ? { kind: "shoot", path: item.path, label: item.title, from: collectionId }
      : { kind: "collection", id: item.id, label: item.title },
  )
  return { dropId: dropId || undefined, over: state === "over", dragging, onPointerDown }
}

function statusLine(item: CardItem, stats?: FolderStats) {
  if (item.kind === "collection") return plural(item.count, "shoot")
  if (stats && !stats.exists) return "Folder not found"
  if (stats?.error) return "Can’t read this folder"
  if (!stats) return item.subtitle || " "
  const bits = [stats.totalPhotos ? plural(stats.totalPhotos, "photo") : "No photos"]
  if (stats.subfolders) bits.push(plural(stats.subfolders, "folder"))
  if (stats.documents) bits.push(plural(stats.documents, "doc"))
  return bits.join(" · ")
}

function GridCard({ item, stats, selected, current, onSelect, onOpen, collectionId, ref, className, ...rest }: ItemProps) {
  const dnd = useCardDnd(item, collectionId)
  const missing = !!stats && !stats.exists
  const problem = missing || !!stats?.error
  return (
    <button
      {...rest}
      ref={ref}
      role="listitem"
      data-card={itemKey(item)}
      data-drop-id={dnd.dropId}
      aria-current={current || undefined}
      aria-selected={selected}
      title={item.kind === "folder" ? (stats?.error ?? item.path) : item.title}
      onPointerDown={(e) => {
        rest.onPointerDown?.(e) // the context menu's long press
        if (e.button === 0) onSelect()
        tapAt = e.pointerType === "touch" || isIPad ? e.timeStamp : 0
        dnd.onPointerDown(e)
      }}
      onPointerUp={(e) => {
        rest.onPointerUp?.(e)
        // iPad: a tap opens (a long press shows the menu instead).
        if (tapAt && e.timeStamp - tapAt < 500) onOpen()
        tapAt = 0
      }}
      // WebKit doesn't focus a clicked button; Return and the arrows act on the focused card.
      onClick={(e) => {
        rest.onClick?.(e)
        e.currentTarget.focus({ preventScroll: true })
      }}
      onFocus={onSelect}
      onDoubleClick={onOpen}
      className={cn(
        "group/card flex min-w-0 flex-col items-center gap-2 rounded-xl px-3 pt-4 pb-3 text-center outline-none transition-[background-color,box-shadow] duration-150",
        "hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring/60",
        selected && "bg-accent hover:bg-accent",
        dnd.over && "bg-primary/12 shadow-[inset_0_0_0_1px_var(--primary)]",
        className,
      )}
    >
      <span className="relative">
        <FolderIcon
          size={76}
          kind={item.kind}
          selected={selected || current}
          dropTarget={dnd.over}
          dragging={dnd.dragging}
          missing={missing}
        />
        {problem && (
          <TriangleAlert className="absolute right-0 bottom-1 size-4 rounded-full bg-background p-0.5 text-(--label-yellow)" aria-label="Problem with this folder" />
        )}
      </span>
      <span className="flex w-full min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium">{item.title}</span>
        <span className="truncate text-[11px] text-muted-foreground">{statusLine(item, stats)}</span>
      </span>
      {item.kind === "folder" && stats && stats.totalPhotos > 0 ? (
        <ViewProgress viewed={stats.totalViewed} total={stats.totalPhotos} size="sm" />
      ) : (
        <span className="h-[10px]" aria-hidden />
      )}
    </button>
  )
}

/** When a finger came down on a card (0 for mouse). */
let tapAt = 0

const LIST_COLUMNS = "24px minmax(0,1fr) 72px 48px 96px 168px"

function ListRow({ item, stats, selected, current, onSelect, onOpen, collectionId, ref, className, ...rest }: ItemProps) {
  const dnd = useCardDnd(item, collectionId)
  const missing = !!stats && !stats.exists
  const opened = item.kind === "folder" && item.openedAt ? relativeTime(item.openedAt) : "—"
  return (
    <button
      {...rest}
      ref={ref}
      role="row"
      data-card={itemKey(item)}
      data-drop-id={dnd.dropId}
      aria-current={current || undefined}
      aria-selected={selected}
      title={item.kind === "folder" ? (stats?.error ?? item.path) : item.title}
      onPointerDown={(e) => {
        rest.onPointerDown?.(e) // the context menu's long press
        if (e.button === 0) onSelect()
        tapAt = e.pointerType === "touch" || isIPad ? e.timeStamp : 0
        dnd.onPointerDown(e)
      }}
      onPointerUp={(e) => {
        rest.onPointerUp?.(e)
        // iPad: a tap opens (a long press shows the menu instead).
        if (tapAt && e.timeStamp - tapAt < 500) onOpen()
        tapAt = 0
      }}
      // WebKit doesn't focus a clicked button; Return and the arrows act on the focused card.
      onClick={(e) => {
        rest.onClick?.(e)
        e.currentTarget.focus({ preventScroll: true })
      }}
      onFocus={onSelect}
      onDoubleClick={onOpen}
      className={cn(
        "group/card grid h-10 w-full items-center gap-3 rounded-md px-2 text-left text-[13px] outline-none transition-[background-color] duration-100",
        "hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring/60",
        selected && "bg-accent hover:bg-accent",
        dnd.over && "bg-primary/12",
        dnd.dragging && "opacity-40",
        className,
      )}
      style={{ gridTemplateColumns: LIST_COLUMNS }}
    >
      <FolderIcon size={24} kind={item.kind} selected={selected || current} dropTarget={dnd.over} missing={missing} />
      <span role="cell" className="flex min-w-0 flex-col">
        <span className={cn("truncate font-medium", missing && "text-muted-foreground")}>{item.title}</span>
        {missing && <span className="truncate text-[11px] text-(--label-yellow)">Folder not found · right-click to locate it</span>}
      </span>
      <span role="cell" className="text-right text-muted-foreground tabular-nums">
        {item.kind === "collection" ? plural(item.count, "shoot") : stats ? stats.totalPhotos.toLocaleString() : ""}
      </span>
      <span role="cell" className="text-right text-muted-foreground tabular-nums">
        {stats?.documents ? stats.documents.toLocaleString() : ""}
      </span>
      <span role="cell" className="truncate text-xs text-muted-foreground">{opened}</span>
      <span role="cell">
        {item.kind === "folder" && stats && stats.totalPhotos > 0 && <ViewProgress viewed={stats.totalViewed} total={stats.totalPhotos} size="sm" />}
      </span>
    </button>
  )
}

/** A folder card for something that isn't in the library yet (a subfolder), titled by its name. */
export const subfolderItem = (path: string): CardItem => ({ kind: "folder", path, title: baseName(path) })
