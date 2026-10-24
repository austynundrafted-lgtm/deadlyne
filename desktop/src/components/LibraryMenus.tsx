// The right-click (and ⋯) menus for shoots, folders and collections. Each menu is described once
// as a list of entries and drawn as either a context menu or a dropdown.
import { isMac } from "@/lib/format"
import {
  deleteCollection,
  locateFolder,
  newCollection,
  newFolder,
  openShoot,
  pickFiles,
  removeFromLibrary,
  renameCollection,
  renameOnDisk,
  resetProgress,
  resumeShoot,
  trashFolder,
} from "@/lib/folders"
import { reveal } from "@/lib/api"
import { isWithin, samePath, statsFor, useLibrary, type LibrarySection } from "@/lib/library"
import { useStore } from "@/store"
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"

export type MenuEntry =
  | { label: string; onSelect: () => void; shortcut?: string; destructive?: boolean; disabled?: boolean }
  | { label: string; sub: MenuEntry[] }
  | "separator"

/** Drops leading, trailing and doubled separators left by entries that don't apply. */
function tidy(entries: (MenuEntry | false | null | undefined)[]): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const e of entries) {
    if (!e) continue
    if (e === "separator" && (!out.length || out[out.length - 1] === "separator")) continue
    out.push(e)
  }
  while (out[out.length - 1] === "separator") out.pop()
  return out
}

export function ContextEntries({ entries, className = "w-60" }: { entries: MenuEntry[]; className?: string }) {
  const draw = (list: MenuEntry[]) =>
    list.map((e, i) =>
      e === "separator" ? (
        <ContextMenuSeparator key={i} />
      ) : "sub" in e ? (
        <ContextMenuSub key={i}>
          <ContextMenuSubTrigger>{e.label}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-w-64">{draw(e.sub)}</ContextMenuSubContent>
        </ContextMenuSub>
      ) : (
        <ContextMenuItem key={i} variant={e.destructive ? "destructive" : "default"} disabled={e.disabled} onSelect={e.onSelect}>
          <span className="truncate">{e.label}</span>
          {e.shortcut && <ContextMenuShortcut>{e.shortcut}</ContextMenuShortcut>}
        </ContextMenuItem>
      ),
    )
  return <ContextMenuContent className={className}>{draw(entries)}</ContextMenuContent>
}

export function DropdownEntries({ entries, className = "w-60", align = "end" }: { entries: MenuEntry[]; className?: string; align?: "start" | "end" }) {
  const draw = (list: MenuEntry[]) =>
    list.map((e, i) =>
      e === "separator" ? (
        <DropdownMenuSeparator key={i} />
      ) : "sub" in e ? (
        <DropdownMenuSub key={i}>
          <DropdownMenuSubTrigger>{e.label}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-w-64">{draw(e.sub)}</DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : (
        <DropdownMenuItem key={i} variant={e.destructive ? "destructive" : "default"} disabled={e.disabled} onSelect={e.onSelect}>
          <span className="truncate">{e.label}</span>
          {e.shortcut && <DropdownMenuShortcut>{e.shortcut}</DropdownMenuShortcut>}
        </DropdownMenuItem>
      ),
    )
  return (
    <DropdownMenuContent align={align} className={className}>
      {draw(entries)}
    </DropdownMenuContent>
  )
}

/** Everything you can do to a shoot or one of its folders. `collection` adds "Remove from…". */
export function folderMenu(path: string, ctx: { origin?: LibrarySection; collectionId?: string; open?: boolean } = {}): MenuEntry[] {
  const lib = useLibrary.getState()
  const shoot = lib.shoots.find((s) => samePath(s.path, path))
  const stats = statsFor(lib.stats, path)
  const missing = stats && !stats.exists
  const collection = ctx.collectionId ? lib.collections.find((c) => c.id === ctx.collectionId) : undefined

  if (missing) {
    return tidy([
      { label: "Locate folder…", onSelect: () => locateFolder(path) },
      collection && { label: `Remove from “${collection.name}”`, onSelect: () => lib.removeFromCollection(collection.id, path) },
      shoot && { label: "Remove from Deadlyne", onSelect: () => removeFromLibrary(path) },
    ])
  }

  const partial = !!stats && stats.totalViewed > 0 && stats.totalViewed < stats.totalPhotos
  const isOpen = useStore.getState().folder && samePath(useStore.getState().folder!, path)
  const topLevel = !lib.shoots.some((s) => !samePath(s.path, path) && isWithin(path, s.path))
  const collections = lib.collections.slice().sort((a, b) => a.name.localeCompare(b.name))

  return tidy([
    !ctx.open && { label: "Open", onSelect: () => openShoot(path, ctx.origin) },
    partial && { label: "Continue reviewing", onSelect: () => resumeShoot(path, ctx.origin) },
    { label: `Show in ${isMac ? "Finder" : "Explorer"}`, onSelect: () => reveal(path) },
    "separator",
    { label: shoot?.pinned ? "Unpin" : "Pin to sidebar", onSelect: () => lib.updateShoot(path, { pinned: !shoot?.pinned }) },
    { label: shoot?.favorite ? "Remove from Favorites" : "Add to Favorites", onSelect: () => lib.updateShoot(path, { favorite: !shoot?.favorite }) },
    {
      label: "Add to collection",
      sub: tidy([
        ...collections.map((c) => ({
          label: c.name,
          disabled: c.shoots.some((p) => samePath(p, path)),
          onSelect: () => lib.addToCollection(c.id, [path]),
        })),
        collections.length > 0 && "separator",
        { label: "New collection…", onSelect: () => newCollection(null, [path]) },
      ]),
    },
    collection && { label: `Remove from “${collection.name}”`, onSelect: () => lib.removeFromCollection(collection.id, path) },
    "separator",
    { label: "Add files…", onSelect: () => (isOpen ? pickFiles(path) : openShoot(path, ctx.origin).then(() => pickFiles(path))) },
    { label: "New folder inside…", onSelect: () => newFolder(path) },
    { label: "Rename on disk…", onSelect: () => renameOnDisk(path) },
    "separator",
    shoot && topLevel && { label: shoot.archived ? "Move out of Archive" : "Archive", onSelect: () => lib.updateShoot(path, { archived: !shoot.archived }) },
    { label: "Reset viewing progress…", disabled: !stats?.totalViewed, onSelect: () => resetProgress(path) },
    "separator",
    shoot && { label: "Remove from Deadlyne", onSelect: () => removeFromLibrary(path) },
    { label: "Move to Trash…", destructive: true, onSelect: () => trashFolder(path) },
  ])
}

export function collectionMenu(id: string): MenuEntry[] {
  const lib = useLibrary.getState()
  return tidy([
    { label: "Open", onSelect: () => useStore.getState().showSection({ kind: "collection", id }) },
    { label: "New collection inside…", onSelect: () => newCollection(id) },
    { label: "Rename…", onSelect: () => renameCollection(id) },
    { label: "Duplicate", onSelect: () => lib.duplicateCollection(id) },
    "separator",
    { label: "Delete collection", destructive: true, onSelect: () => deleteCollection(id) },
  ])
}
