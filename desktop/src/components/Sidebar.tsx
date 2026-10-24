// The library sidebar beside the Photos workspace: Library lists, pinned folders, collections,
// shoot folders (expandable into their real subfolders) and the archive. Collapses to an icon
// rail to give the photos more room. Arrow keys move through it like a Finder sidebar.
import { useEffect, useMemo, useState } from "react"
import {
  Archive,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  FolderTree,
  Images,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Star,
  TriangleAlert,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { dragSource, useDnd, useDropTarget, type DragItem } from "@/lib/dnd"
import { newCollection, openShoot, useTree } from "@/lib/folders"
import { alt, mod } from "@/lib/format"
import {
  baseName,
  descendantIds,
  folderTitle,
  isWithin,
  samePath,
  SECTION_TITLES,
  statsFor,
  useLibrary,
  type Collection,
  type LibrarySection,
  type LibraryShoot,
} from "@/lib/library"
import { pref, setPref } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"
import { collectionMenu, ContextEntries, folderMenu } from "@/components/LibraryMenus"
import { ViewProgress } from "@/components/ViewProgress"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Kbd } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export const SIDEBAR_WIDTH = 240
export const RAIL_WIDTH = 52
/** Below this window width the sidebar shows as the rail, whatever was chosen. */
const AUTO_RAIL_BELOW = 1100

/** Shoots not inside another library shoot: the top of the Folders tree. */
export function topLevelShoots(shoots: LibraryShoot[]) {
  return shoots.filter((s) => !shoots.some((o) => o !== s && !samePath(o.path, s.path) && isWithin(s.path, o.path)))
}

export const byTitle = (a: { path: string }, b: { path: string }) =>
  folderTitle(a.path).localeCompare(folderTitle(b.path), undefined, { numeric: true, sensitivity: "base" })

// MARK: - Open / rail state

interface SidebarPrefs {
  rail: boolean
  expanded: Record<string, boolean>
}
let prefs: SidebarPrefs = pref("sidebar", { rail: false, expanded: { library: true, collections: true, folders: true } })

function usePrefs() {
  const [state, setState] = useState(prefs)
  const update = (patch: Partial<SidebarPrefs>) => {
    prefs = { ...prefs, ...patch }
    setPref("sidebar", prefs)
    setState(prefs)
    window.dispatchEvent(new Event("deadlyne-sidebar"))
  }
  useEffect(() => {
    const sync = () => setState(prefs)
    window.addEventListener("deadlyne-sidebar", sync)
    return () => window.removeEventListener("deadlyne-sidebar", sync)
  }, [])
  return [state, update] as const
}

/** Whether the sidebar is collapsed to the rail (the menu's "Show Sidebar" / "Hide Sidebar"). */
export const isSidebarRail = () => prefs.rail

export function toggleSidebar() {
  prefs = { ...prefs, rail: !prefs.rail }
  setPref("sidebar", prefs)
  window.dispatchEvent(new Event("deadlyne-sidebar"))
}

function useNarrowWindow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < AUTO_RAIL_BELOW)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < AUTO_RAIL_BELOW)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return narrow
}

// MARK: - Keyboard

/** ↑ ↓ move between rows, → opens a group (or steps into it), ← closes it (or steps out). */
function onTreeKey(e: React.KeyboardEvent<HTMLElement>) {
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-tree-row]")]
  const i = rows.indexOf(document.activeElement as HTMLElement)
  if (i < 0) return
  const row = rows[i]
  const go = (n: number) => {
    e.preventDefault()
    rows[Math.max(0, Math.min(rows.length - 1, n))]?.focus()
  }
  if (e.key === "ArrowDown") return go(i + 1)
  if (e.key === "ArrowUp") return go(i - 1)
  if (e.key === "Home") return go(0)
  if (e.key === "End") return go(rows.length - 1)
  const expanded = row.getAttribute("aria-expanded")
  if (e.key === "ArrowRight" && expanded !== null) {
    e.preventDefault()
    if (expanded === "false") row.ontreetoggle?.()
    else go(i + 1)
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault()
    if (expanded === "true") row.ontreetoggle?.()
    else {
      // Step out to the row this one sits under.
      const level = Number(row.getAttribute("aria-level") ?? 1)
      for (let j = i - 1; j >= 0; j--) if (Number(rows[j].getAttribute("aria-level") ?? 1) < level) return go(j)
    }
  }
}

// MARK: - Sidebar

export function Sidebar() {
  const [{ rail: chosenRail, expanded }, update] = usePrefs()
  const narrow = useNarrowWindow()
  const rail = chosenRail || narrow
  const { shoots, collections, stats, loaded } = useLibrary(
    useShallow((s) => ({ shoots: s.shoots, collections: s.collections, stats: s.stats, loaded: s.loaded })),
  )
  const { section, folder, origin } = useStore(useShallow((s) => ({ section: s.librarySection, folder: s.folder, origin: s.origin })))

  const active = shoots.filter((s) => !s.archived)
  const top = useMemo(() => topLevelShoots(active).sort(byTitle), [active])
  const pinned = useMemo(() => shoots.filter((s) => s.pinned).sort(byTitle), [shoots])
  const archived = shoots.filter((s) => s.archived)
  const toggle = (key: string, on?: boolean) => update({ expanded: { ...expanded, [key]: on ?? !expanded[key] } })
  const isSection = (k: LibrarySection["kind"], id?: string) =>
    section?.kind === k && (k !== "collection" || (section as { id: string }).id === id)

  if (rail) return <Rail pinned={pinned} narrow={narrow && !chosenRail} onExpand={() => update({ rail: false })} />

  return (
    <nav aria-label="Library" className="flex h-full shrink-0 flex-col border-r bg-sidebar" style={{ width: SIDEBAR_WIDTH }}>
      <div className="flex h-10 shrink-0 items-center gap-1 pr-1.5 pl-3">
        <span className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Library</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="New collection" onClick={() => newCollection()}>
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New collection</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Collapse sidebar" onClick={() => update({ rail: true })}>
              <PanelLeftClose />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Collapse sidebar <Kbd>{alt}{mod}S</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Radix lays the viewport out as a table that grows with long names; keep it to the sidebar's width so names truncate. */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div role="tree" aria-label="Shoots and collections" className="flex flex-col gap-3 px-2 pb-4" onKeyDown={onTreeKey}>
          <Group>
            <SectionRow icon={Images} label={SECTION_TITLES.all} count={top.length} section={{ kind: "all" }} active={isSection("all")} />
            <SectionRow icon={Clock} label="Recent" section={{ kind: "recent" }} active={isSection("recent")} />
            <SectionRow
              icon={Star}
              label={SECTION_TITLES.favorites}
              count={shoots.filter((s) => s.favorite).length || undefined}
              section={{ kind: "favorites" }}
              active={isSection("favorites")}
              drop={{ id: "favorites", label: "Add to Favorites", apply: (path) => useLibrary.getState().updateShoot(path, { favorite: true }) }}
            />
          </Group>

          {/* Never appears mid-drag: rows mustn't shift under the pointer. */}
          {pinned.length > 0 && <PinnedGroup pinned={pinned} folder={folder} origin={origin} />}

          <Group
            title="Collections"
            open={expanded.collections !== false}
            onToggle={() => toggle("collections")}
            action={
              <Button variant="ghost" size="icon-xs" aria-label="New collection" onClick={() => newCollection()}>
                <Plus />
              </Button>
            }
            dropId="collections-root"
          >
            {collections.filter((c) => !c.parent).length === 0 ? (
              <button
                className="mx-1 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => newCollection()}
              >
                Group shoots by season, team or client. Files stay where they are.
              </button>
            ) : (
              collections
                .filter((c) => !c.parent)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => <CollectionRow key={c.id} collection={c} level={1} expanded={expanded} toggle={toggle} />)
            )}
          </Group>

          <Group title="Folders" open={expanded.folders !== false} onToggle={() => toggle("folders")} dropId="folders-root">
            {!loaded ? null : top.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-muted-foreground">Shoots you open or ingest appear here.</p>
            ) : (
              top.map((s) => (
                <FolderRow key={s.path} path={s.path} level={1} expanded={expanded} toggle={toggle} stats={statsFor(stats, s.path)} folder={folder} origin={origin} />
              ))
            )}
          </Group>

          <Group>
            <SectionRow
              icon={Archive}
              label={SECTION_TITLES.archive}
              count={archived.length || undefined}
              section={{ kind: "archive" }}
              active={isSection("archive")}
              drop={{ id: "archive", label: "Archive", apply: (path) => useLibrary.getState().updateShoot(path, { archived: true }) }}
            />
          </Group>
        </div>
      </ScrollArea>
    </nav>
  )
}

function Group({
  title,
  open = true,
  onToggle,
  action,
  dropId,
  children,
}: {
  title?: string
  open?: boolean
  onToggle?: () => void
  action?: React.ReactNode
  dropId?: string
  children: React.ReactNode
}) {
  const drop = useDropTarget(dropId ?? "", {
    accepts: (item) =>
      !!dropId &&
      ((dropId === "collections-root" && item.kind === "collection" && !!useLibrary.getState().collections.find((c) => c.id === item.id)?.parent) ||
        (dropId === "folders-root" && item.kind === "shoot" && !!useLibrary.getState().shoots.find((s) => samePath(s.path, item.path))?.archived)),
    drop: (item) => {
      if (item.kind === "collection") useLibrary.getState().moveCollection(item.id, null)
      else useLibrary.getState().updateShoot(item.path, { archived: false })
    },
  })
  return (
    <div role="group" className="flex flex-col gap-px">
      {title && (
        <div
          data-drop-id={dropId}
          className={cn("group/header flex h-7 items-center rounded-md pr-1 transition-[background-color] duration-100", drop === "over" && "bg-primary/15")}
        >
          <button
            data-tree-row
            role="treeitem"
            aria-level={0}
            aria-expanded={open}
            onClick={onToggle}
            ref={(el) => {
              if (!el || !onToggle) return
              el.ontreetoggle = onToggle
            }}
            className="flex h-full flex-1 items-center gap-1 rounded-md px-2 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {title}
            <ChevronRight className={cn("size-3 opacity-0 transition-[rotate,opacity] duration-150 group-hover/header:opacity-100", open && "rotate-90")} />
          </button>
          {action && <span className="opacity-0 transition-opacity duration-100 group-hover/header:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">{action}</span>}
        </div>
      )}
      {open && children}
    </div>
  )
}

declare global {
  interface HTMLElement {
    /** Set on expandable tree rows, so → and ← can open and close them. */
    ontreetoggle?: () => void
  }
}

const ROW =
  "group/row relative flex h-7 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left text-[13px] outline-none transition-[background-color,color] duration-100 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring/50"
const ROW_ACTIVE = "bg-accent text-foreground hover:bg-accent"

function SectionRow({
  icon: Icon,
  label,
  count,
  section,
  active,
  drop,
}: {
  icon: typeof Images
  label: string
  count?: number
  section: LibrarySection
  active: boolean
  drop?: { id: string; label: string; apply: (path: string) => void }
}) {
  const state = useDropTarget(drop?.id ?? "", {
    accepts: (item) => !!drop && item.kind === "shoot",
    drop: (item) => item.kind === "shoot" && drop?.apply(item.path),
  })
  return (
    <button
      data-tree-row
      role="treeitem"
      aria-level={1}
      aria-selected={active}
      data-drop-id={drop?.id}
      className={cn(ROW, "pl-2", active && ROW_ACTIVE, state === "over" && "bg-primary/15 text-foreground")}
      onClick={() => useStore.getState().showSection(section)}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {state === "over" ? (
        <span className="text-[11px] text-primary">{drop!.label}</span>
      ) : (
        count !== undefined && <span className="text-[11px] text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
      )}
    </button>
  )
}

function PinnedGroup({ pinned, folder, origin }: { pinned: LibraryShoot[]; folder: string | null; origin: LibrarySection }) {
  const state = useDropTarget("pinned", {
    accepts: (item) => item.kind === "shoot" && !useLibrary.getState().shoots.find((s) => samePath(s.path, item.path))?.pinned,
    drop: (item) => item.kind === "shoot" && useLibrary.getState().updateShoot(item.path, { pinned: true }),
  })
  const stats = useLibrary((s) => s.stats)
  return (
    <div role="group" data-drop-id="pinned" className={cn("flex flex-col gap-px rounded-md transition-[background-color] duration-100", state === "over" && "bg-primary/15")}>
      <div className="flex h-7 items-center px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        Pinned
      </div>
      {pinned.map((s) => (
        <FolderRow key={s.path} path={s.path} level={1} stats={statsFor(stats, s.path)} folder={folder} origin={origin} icon={Pin} />
      ))}
    </div>
  )
}

function CollectionRow({
  collection: c,
  level,
  expanded,
  toggle,
}: {
  collection: Collection
  level: number
  expanded: Record<string, boolean>
  toggle: (key: string, on?: boolean) => void
}) {
  const { collections, stats } = useLibrary(useShallow((s) => ({ collections: s.collections, stats: s.stats })))
  const section = useStore((s) => s.librarySection)
  const folder = useStore((s) => s.folder)
  const active = section?.kind === "collection" && section.id === c.id
  const key = `c:${c.id}`
  const open = !!expanded[key]
  const children = collections.filter((x) => x.parent === c.id).sort((a, b) => a.name.localeCompare(b.name))
  const hasChildren = children.length > 0 || c.shoots.length > 0
  const dragged = useDnd((s) => s.item?.kind === "collection" && s.item.id === c.id)
  const state = useDropTarget(key, {
    accepts: (item: DragItem) =>
      item.kind === "shoot"
        ? !c.shoots.some((p) => samePath(p, item.path))
        : !descendantIds(useLibrary.getState().collections, item.id).has(c.id) && item.id !== c.id && c.id !== useLibrary.getState().collections.find((x) => x.id === item.id)?.parent,
    drop: (item) => {
      if (item.kind === "shoot") useLibrary.getState().addToCollection(c.id, [item.path])
      else useLibrary.getState().moveCollection(item.id, c.id)
      toggle(key, true)
    },
  })

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            data-tree-row
            role="treeitem"
            aria-level={level}
            aria-expanded={hasChildren ? open : undefined}
            aria-selected={active}
            data-drop-id={key}
            ref={(el) => {
              if (el) el.ontreetoggle = () => toggle(key)
            }}
            onPointerDown={dragSource(() => ({ kind: "collection", id: c.id, label: c.name }))}
            onClick={() => useStore.getState().showSection({ kind: "collection", id: c.id })}
            className={cn(ROW, active && ROW_ACTIVE, state === "over" && "bg-primary/15", dragged && "opacity-40")}
            style={{ paddingLeft: 8 + (level - 1) * 14 }}
          >
            <Disclosure open={open} visible={hasChildren} onToggle={() => toggle(key)} />
            <Library className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">{c.shoots.length || ""}</span>
          </button>
        </ContextMenuTrigger>
        <ContextEntries entries={collectionMenu(c.id)} />
      </ContextMenu>
      {open && (
        <div role="group" className="flex flex-col gap-px">
          {children.map((x) => (
            <CollectionRow key={x.id} collection={x} level={level + 1} expanded={expanded} toggle={toggle} />
          ))}
          {c.shoots
            .slice()
            .sort((a, b) => folderTitle(a).localeCompare(folderTitle(b)))
            .map((p) => (
              <FolderRow
                key={p}
                path={p}
                level={level + 1}
                stats={statsFor(stats, p)}
                folder={folder}
                origin={{ kind: "collection", id: c.id }}
                collectionId={c.id}
              />
            ))}
        </div>
      )}
    </>
  )
}

function Disclosure({ open, visible, onToggle }: { open: boolean; visible: boolean; onToggle: () => void }) {
  return (
    <span
      aria-hidden
      className={cn("-mr-1 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground", !visible && "invisible")}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <ChevronRight className={cn("size-3 transition-[rotate] duration-150", open && "rotate-90")} />
    </span>
  )
}

function FolderRow({
  path,
  level,
  stats,
  folder,
  origin,
  collectionId,
  expanded,
  toggle,
  icon,
}: {
  path: string
  level: number
  stats: ReturnType<typeof statsFor>
  folder: string | null
  origin: LibrarySection
  collectionId?: string
  expanded?: Record<string, boolean>
  toggle?: (key: string, on?: boolean) => void
  icon?: typeof Folder
}) {
  const section = useStore((s) => s.librarySection)
  const active = section === null && !!folder && samePath(folder, path)
  const containsOpen = !active && !!folder && isWithin(folder, path)
  const key = `f:${path}`
  const open = !!expanded?.[key]
  const children = useTree((s) => s.children[path])
  const allStats = useLibrary((s) => s.stats)
  const dragged = useDnd((s) => s.item?.kind === "shoot" && samePath(s.item.path, path))
  const missing = stats && !stats.exists
  const expandable = !!toggle && !missing && (stats?.subfolders ?? 1) > 0

  useEffect(() => {
    if (open && children === undefined) useTree.getState().load(path)
  }, [open, children, path])

  const Icon = missing ? TriangleAlert : icon ?? (active ? FolderOpen : Folder)
  // Shoots read as titles wherever they appear; their subfolders keep their real names.
  const isShoot = useLibrary((s) => s.shoots.some((x) => samePath(x.path, path)))
  const label = isShoot ? folderTitle(path) : baseName(path)
  const total = stats?.totalPhotos ?? 0

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            data-tree-row
            role="treeitem"
            aria-level={level}
            aria-expanded={expandable ? open : undefined}
            aria-selected={active}
            ref={(el) => {
              if (el && toggle) el.ontreetoggle = () => toggle(key)
            }}
            onPointerDown={dragSource(() => ({ kind: "shoot", path, label, from: collectionId }))}
            onClick={() => openShoot(path, origin)}
            title={stats?.error ?? (missing ? `${path} isn’t there anymore` : path)}
            className={cn(ROW, active && ROW_ACTIVE, dragged && "opacity-40")}
            style={{ paddingLeft: 8 + (level - 1) * 14 }}
          >
            <Disclosure open={open} visible={expandable} onToggle={() => toggle?.(key)} />
            <Icon className={cn("size-4 shrink-0", missing ? "text-(--label-yellow)" : active || containsOpen ? "text-primary" : "text-muted-foreground")} />
            <span className={cn("min-w-0 flex-1 truncate", missing && "text-muted-foreground")}>{label}</span>
            {/* The count gives way to progress on the open folder, or while pointing at one. The open
                folder's meter takes its own space so the name truncates before it instead of under it. */}
            {total > 0 && (
              <span className="relative flex shrink-0 items-center justify-end">
                {!active && (
                  <span className="text-[11px] text-muted-foreground tabular-nums group-hover/row:opacity-0 group-focus-visible/row:opacity-0">
                    {total.toLocaleString()}
                  </span>
                )}
                <ViewProgress
                  size="xs"
                  viewed={stats!.totalViewed}
                  total={total}
                  className={cn(
                    !active && "absolute right-0 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-visible/row:opacity-100",
                  )}
                />
              </span>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextEntries entries={folderMenu(path, { origin, collectionId })} />
      </ContextMenu>
      {open && expandable && (
        <div role="group" className="flex flex-col gap-px">
          {children === undefined ? (
            <span className="h-7 animate-pulse" style={{ marginLeft: 8 + level * 14 }} />
          ) : children === "error" ? (
            <span className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: 8 + level * 14 + 22 }}>
              Can’t read this folder
            </span>
          ) : (
            children.map((c) => (
              <FolderRow
                key={c.path}
                path={c.path}
                level={level + 1}
                stats={statsFor(allStats, c.path)}
                folder={folder}
                origin={origin}
                expanded={expanded}
                toggle={toggle}
              />
            ))
          )}
        </div>
      )}
    </>
  )
}

// MARK: - Rail

function Rail({ pinned, narrow, onExpand }: { pinned: LibraryShoot[]; narrow: boolean; onExpand: () => void }) {
  const { section, folder } = useStore(useShallow((s) => ({ section: s.librarySection, folder: s.folder })))
  const item = (label: string, icon: typeof Images, active: boolean, onClick: () => void, key?: string) => {
    const Icon = icon
    return (
      <Tooltip key={key ?? label}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-current={active || undefined}
            className={cn("size-9 text-muted-foreground", active && "bg-accent text-primary hover:text-primary")}
            onClick={onClick}
          >
            <Icon className="size-[18px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }
  const show = (s: LibrarySection) => () => useStore.getState().showSection(s)
  return (
    <nav aria-label="Library" className="flex h-full shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-1.5" style={{ width: RAIL_WIDTH }}>
      {narrow ? (
        <span className="flex size-9 items-center justify-center text-muted-foreground" title="Widen the window to show the full sidebar">
          <FolderTree className="size-[18px]" />
        </span>
      ) : (
        item("Expand sidebar", PanelLeftOpen, false, onExpand)
      )}
      <span className="my-1 h-px w-6 bg-border" />
      {item(SECTION_TITLES.all, Images, section?.kind === "all", show({ kind: "all" }))}
      {item("Recent", Clock, section?.kind === "recent", show({ kind: "recent" }))}
      {item(SECTION_TITLES.favorites, Star, section?.kind === "favorites", show({ kind: "favorites" }))}
      {pinned.length > 0 && <span className="my-1 h-px w-6 bg-border" />}
      {pinned.map((s) =>
        item(folderTitle(s.path), Pin, section === null && !!folder && samePath(folder, s.path), () => openShoot(s.path), s.path),
      )}
      <span className="my-1 h-px w-6 bg-border" />
      {item(SECTION_TITLES.archive, Archive, section?.kind === "archive", show({ kind: "archive" }))}
    </nav>
  )
}
