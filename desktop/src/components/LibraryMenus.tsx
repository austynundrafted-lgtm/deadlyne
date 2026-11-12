// The right-click (and ⋯) menus for shoots, folders and collections. Each menu is described once
// as a list of entries and drawn as either a context menu or a dropdown.
import { revealLabel, trashAction } from "@/lib/format"
import { LABELS } from "@/lib/api"
import {
  deleteCollection,
  locateFolder,
  newCollection,
  newFolder,
  openShoot,
  pickFiles,
  removeFromLibrary,
  removeFromCollection,
  refreshFolder,
  renameCollection,
  renameOnDisk,
  resetProgress,
  resumeShoot,
  trashFolder,
  transferSelectionHere,
} from "@/lib/folders"
import { reveal } from "@/lib/api"
import { isWithin, samePath, statsFor, useLibrary, type LibrarySection } from "@/lib/library"
import { useStore } from "@/store"
import { catalogPath, effectiveCatalogRule } from "@/lib/catalog-rules"
import { useUI } from "@/ui"
import { confirm } from "@/lib/prompts"
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

type FolderMenuContext = { origin?: LibrarySection; collectionId?: string; open?: boolean }

/** Subscribe separately so selection and rule changes update menus without rebuilding folder rows. */
export function FolderEntries({ path, context, dropdown = false }: { path: string; context?: FolderMenuContext; dropdown?: boolean }) {
  useStore((s) => s.loupe ? !!s.focus : s.selected.size > 0)
  useStore((s) => s.folder)
  useStore((s) => s.busy)
  useLibrary((s) => s.shoots)
  useLibrary((s) => s.collections)
  useLibrary((s) => s.folderLabels)
  useLibrary((s) => s.catalogRules)
  useLibrary((s) => s.stats)
  const entries = folderMenu(path, context)
  return dropdown ? <DropdownEntries entries={entries} /> : <ContextEntries entries={entries} />
}

/** Everything you can do to a shoot or one of its folders. `collection` adds "Remove from…". */
export function folderMenu(path: string, ctx: FolderMenuContext = {}): MenuEntry[] {
  const lib = useLibrary.getState()
  const shoot = lib.shoots.find((s) => samePath(s.path, path))
  const stats = statsFor(lib.stats, path)
  const missing = stats && !stats.exists
  const collection = ctx.collectionId ? lib.collections.find((c) => c.id === ctx.collectionId) : undefined

  if (missing) {
    return tidy([
      { label: "Locate folder…", onSelect: () => locateFolder(path) },
      collection && { label: `Remove from “${collection.name}”…`, onSelect: () => removeFromCollection(collection.id, path) },
      shoot && { label: "Remove from Deadlyne", onSelect: () => removeFromLibrary(path) },
    ])
  }

  const partial = !!stats && stats.totalViewed > 0 && stats.totalViewed < stats.totalPhotos
  const isOpen = useStore.getState().folder && samePath(useStore.getState().folder!, path)
  const topLevel = !lib.shoots.some((s) => !samePath(s.path, path) && isWithin(path, s.path))
  const state = useStore.getState()
  const canTransfer = !!state.folder && !state.busy && !samePath(state.folder, path) && (state.loupe ? !!state.focus : state.selected.size > 0)
  const explicitRule = lib.catalogRules[catalogPath(path)]
  const effectiveRule = effectiveCatalogRule(path, lib.catalogRules)
  const collections = lib.collections.slice().sort((a, b) => a.name.localeCompare(b.name))

  return tidy([
    { label: "Color label", sub: [
      { label: "None", onSelect: () => lib.setFolderLabel(path, null) },
      ...LABELS.map((label) => ({ label: `${lib.folderLabels[path.replace(/[\\/]+$/, "")] === label ? "✓ " : ""}${label}`, onSelect: () => lib.setFolderLabel(path, label) })),
    ] },
    "separator",
    !ctx.open && { label: "Open", onSelect: () => openShoot(path, ctx.origin) },
    partial && { label: "Continue reviewing", onSelect: () => resumeShoot(path, ctx.origin) },
    { label: revealLabel, onSelect: () => reveal(path) },
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
    collection && { label: `Remove from “${collection.name}”…`, onSelect: () => removeFromCollection(collection.id, path) },
    "separator",
    { label: "Add files…", onSelect: () => (isOpen ? pickFiles(path) : openShoot(path, ctx.origin).then(() => pickFiles(path))) },
    { label: "New folder inside…", onSelect: () => newFolder(path) },
    { label: "Copy selected photos here", disabled: !canTransfer, onSelect: () => transferSelectionHere(path, false) },
    { label: "Move selected photos here", disabled: !canTransfer, onSelect: () => transferSelectionHere(path, true) },
    { label: "Catalog scanning rules", sub: [
      { label: `${effectiveRule?.rule === "include" ? "✓ " : ""}Include when scanning`, onSelect: () => lib.setCatalogRule(path, "include") },
      { label: `${effectiveRule?.rule === "exclude" ? "✓ " : ""}Exclude when scanning`, onSelect: () => lib.setCatalogRule(path, "exclude") },
      { label: "Clear this folder’s rule…", disabled: !explicitRule, onSelect: async () => {
        if (await confirm({ title: "Remove this catalog rule?", description: `The rule for “${path}” will be removed. Photos remain untouched.`, action: "Remove rule", destructive: true })) useLibrary.getState().setCatalogRule(path, null)
      } },
      { label: "Manage rules in Settings…", onSelect: () => useUI.setState({ profile: true, profileTab: "catalog" }) },
    ] },
    { label: "Rename on disk…", onSelect: () => renameOnDisk(path) },
    { label: "Refresh", onSelect: () => refreshFolder(path) },
    "separator",
    shoot && topLevel && { label: shoot.archived ? "Move out of Archive" : "Archive", onSelect: () => lib.updateShoot(path, { archived: !shoot.archived }) },
    { label: "Reset viewing progress…", disabled: !stats?.totalViewed, onSelect: () => resetProgress(path) },
    "separator",
    shoot && { label: "Remove from Deadlyne", onSelect: () => removeFromLibrary(path) },
    { label: `${trashAction}…`, destructive: true, onSelect: () => trashFolder(path) },
    "separator",
    { label: "Preferences…", onSelect: () => useUI.getState().open("profile") },
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
