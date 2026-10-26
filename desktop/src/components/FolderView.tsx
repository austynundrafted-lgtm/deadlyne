// An open folder: a slim bar (where you are, what's inside, how far the review got, add files)
// over one of three views: the photos (the contact sheet, untouched), the subfolders, or the
// documents with their own inspector. Photos and documents are never mixed in one grid.
import { useEffect, useMemo } from "react"
import {
  ChevronRight,
  Eye,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Paperclip,
  Play,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { formatBytes } from "@/lib/api"
import {
  moveDoc,
  newFolder,
  openDoc,
  pickFiles,
  quickLook,
  relinkDoc,
  removeDoc,
  renameDoc,
  resetProgress,
  revealDoc,
} from "@/lib/folders"
import { alt, isIPad, mod, openLabel, relativeTime, revealLabel, shift, trashAction } from "@/lib/format"
import { baseName, folderTitle, isWithin, parentPath, rootShootOf, SECTION_TITLES, useLibrary, type LibrarySection } from "@/lib/library"
import { cn } from "@/lib/utils"
import { continueReviewing, useOpenFolderProgress, useViewing } from "@/lib/viewing"
import { useStore, type FolderDoc, type FolderTab } from "@/store"
import { ContextEntries, DropdownEntries, folderMenu, type MenuEntry } from "@/components/LibraryMenus"
import { FolderItems, subfolderItem, useViewMode, ViewModeToggle } from "@/components/LibraryView"
import { ViewProgress, viewedSummary } from "@/components/ViewProgress"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export const INSPECTOR_WIDTH = 340

function sectionLabel(section: LibrarySection) {
  if (section.kind !== "collection") return SECTION_TITLES[section.kind]
  return useLibrary.getState().collections.find((c) => c.id === section.id)?.name ?? "Collection"
}

// MARK: - Folder bar

export function FolderBar() {
  const { folder, folderTab, subfolders, documents, origin, photoCount, search } = useStore(
    useShallow((s) => ({
      folder: s.folder!,
      folderTab: s.folderTab,
      subfolders: s.subfolders,
      documents: s.documents,
      origin: s.origin,
      photoCount: s.photos.length,
      search: s.search,
    })),
  )
  const shoots = useLibrary((s) => s.shoots)

  // Origin › shoot › … › this folder
  const crumbs = useMemo(() => {
    const root = rootShootOf(shoots, folder)
    const list: string[] = [folder]
    if (root) {
      let p = folder
      while (p !== root.path && isWithin(p, root.path) && list.length < 8) {
        p = parentPath(p)
        list.unshift(p)
      }
    }
    return list
  }, [shoots, folder])

  const tabs: { value: FolderTab; label: string; count: number; show: boolean }[] = [
    { value: "photos", label: "Photos", count: photoCount, show: true },
    { value: "folders", label: "Folders", count: subfolders.length, show: subfolders.length > 0 || folderTab === "folders" },
    { value: "documents", label: "Documents", count: documents.length, show: true },
  ]

  return (
    <div className="@container/bar flex h-10 shrink-0 items-center gap-2 border-b bg-background px-3">
      <nav aria-label="Folder path" className="flex min-w-0 flex-1 items-center gap-0.5 text-[13px]">
        <button
          className="shrink-0 rounded-sm px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => useStore.getState().showSection(origin)}
        >
          {sectionLabel(origin)}
        </button>
        {crumbs.map((p, i) => {
          const last = i === crumbs.length - 1
          const label = i === 0 ? folderTitle(p) : baseName(p)
          return (
            <span key={p} className={cn("flex items-center gap-0.5", last ? "min-w-0" : "hidden min-w-0 shrink @2xl/bar:flex")}>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
              {last ? (
                <span className="truncate font-semibold" title={p} aria-current="page">
                  {label}
                </span>
              ) : (
                <button
                  className="truncate rounded-sm px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  title={p}
                  onClick={() => useStore.getState().openFolder(p)}
                >
                  {label}
                </button>
              )}
            </span>
          )
        })}
      </nav>

      <ToggleGroup
        type="single"
        size="sm"
        value={folderTab}
        onValueChange={(v) => v && useStore.getState().setFolderTab(v as FolderTab)}
        aria-label="Show"
        className="shrink-0"
      >
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <ToggleGroupItem
              key={t.value}
              value={t.value}
              className="gap-1.5 text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground"
            >
              {t.label}
              <span className="hidden text-[11px] text-muted-foreground tabular-nums @xl/bar:inline">{t.count.toLocaleString()}</span>
            </ToggleGroupItem>
          ))}
      </ToggleGroup>

      <ReviewProgress />

      {folderTab !== "photos" && <ViewModeToggle />}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" onClick={() => pickFiles(folder)} aria-label="Add files">
            <Paperclip data-icon="inline-start" />
            <span className="hidden @4xl/bar:inline">Add files</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add documents to this shoot, or drop them on the window</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={() => newFolder(folder)} aria-label="New folder">
            <FolderPlus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          New folder <Kbd>{shift}{mod}N</Kbd>
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Folder actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownEntries entries={folderMenu(folder, { open: true, origin })} />
      </DropdownMenu>
      {search && folderTab !== "photos" && <span className="sr-only">Filtered by “{search}”</span>}
    </div>
  )
}

/** The open folder's review progress, with Continue reviewing and the details in a popover. */
function ReviewProgress() {
  const { viewed, total, ready } = useOpenFolderProgress()
  const { unviewedOnly, folder } = useStore(useShallow((s) => ({ unviewedOnly: s.unviewedOnly, folder: s.folder })))
  const last = useViewing((s) => s.last)
  const photos = useStore((s) => s.photos)
  if (!total || !ready) return null
  const partial = viewed > 0 && viewed < total
  const lastName = last ? photos.find((p) => p.name.replace(/\.[^.]+$/, "").toLowerCase() === last)?.name : undefined

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="flex h-7 items-center rounded-md px-1.5 outline-none transition-[background-color] duration-100 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-white/5"
            aria-label={`Review progress: ${viewedSummary(viewed, total)}`}
          >
            <ViewProgress viewed={viewed} total={total} size="md" className="hidden @3xl/bar:inline-flex" />
            <ViewProgress viewed={viewed} total={total} size="xs" className="@3xl/bar:hidden" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Review progress</span>
              <span className="text-xs text-muted-foreground">
                A photo counts once it’s been on screen for a second, or opened in the loupe. Tags, ratings and captions are separate.
              </span>
            </div>
            <div className="text-[13px] tabular-nums">
              {viewedSummary(viewed, total)}
              {lastName && <span className="block truncate text-xs text-muted-foreground" title={lastName}>Left off at {lastName}</span>}
            </div>
            {viewed < total && (
              <Button size="sm" onClick={continueReviewing}>
                <Play data-icon="inline-start" />
                {viewed ? "Continue reviewing" : "Start reviewing"}
                <Kbd className="ml-auto bg-black/20 text-primary-foreground">{alt}{mod}R</Kbd>
              </Button>
            )}
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex items-center gap-2">
                <Eye className="size-4 text-muted-foreground" /> Show unviewed only
              </span>
              <Switch checked={unviewedOnly} onCheckedChange={(on) => useStore.getState().setUnviewedOnly(on)} />
            </label>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-muted-foreground"
              disabled={!viewed}
              onClick={() => folder && resetProgress(folder)}
            >
              <RotateCcw data-icon="inline-start" />
              Reset viewing progress…
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {partial && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="secondary" size="sm" onClick={continueReviewing} className="gap-1.5">
              <Play className="fill-current" data-icon="inline-start" />
              <span className="hidden @5xl/bar:inline">Continue reviewing</span>
              <span className="@5xl/bar:hidden">Continue</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {viewedSummary(viewed, total)} · back to where you left off <Kbd>{alt}{mod}R</Kbd>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

// MARK: - Subfolders

export function SubfoldersView() {
  const { subfolders, search, origin } = useStore(useShallow((s) => ({ subfolders: s.subfolders, search: s.search, origin: s.origin })))
  const [mode] = useViewMode()
  useEffect(() => {
    if (subfolders.length) useLibrary.getState().refreshStats(subfolders.map((f) => f.path))
  }, [subfolders])
  const q = search.trim().toLowerCase()
  const items = subfolders.filter((f) => !q || f.name.toLowerCase().includes(q)).map((f) => subfolderItem(f.path))
  if (!subfolders.length) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>No folders inside</EmptyTitle>
          <EmptyDescription>Make one to split a shoot into halves, games or edits.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={() => newFolder(useStore.getState().folder!)}>
            <FolderPlus data-icon="inline-start" />
            New folder
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  return <FolderItems items={items} mode={mode} origin={origin} />
}

// MARK: - Documents

const DOC_KINDS: Record<string, { label: string; tint: string }> = {
  pdf: { label: "PDF", tint: "var(--label-red)" },
  doc: { label: "Word", tint: "var(--label-blue)" },
  docx: { label: "Word", tint: "var(--label-blue)" },
  pages: { label: "Pages", tint: "var(--label-yellow)" },
  rtf: { label: "Rich text", tint: "var(--label-blue)" },
  rtfd: { label: "Rich text", tint: "var(--label-blue)" },
  odt: { label: "Document", tint: "var(--label-blue)" },
  xls: { label: "Excel", tint: "var(--label-green)" },
  xlsx: { label: "Excel", tint: "var(--label-green)" },
  numbers: { label: "Numbers", tint: "var(--label-green)" },
  ods: { label: "Spreadsheet", tint: "var(--label-green)" },
  csv: { label: "CSV", tint: "var(--label-green)" },
  tsv: { label: "TSV", tint: "var(--label-green)" },
  tab: { label: "Tab text", tint: "var(--label-green)" },
  key: { label: "Keynote", tint: "var(--label-purple)" },
  ppt: { label: "PowerPoint", tint: "var(--label-purple)" },
  pptx: { label: "PowerPoint", tint: "var(--label-purple)" },
  odp: { label: "Presentation", tint: "var(--label-purple)" },
  txt: { label: "Text", tint: "var(--muted-foreground)" },
  md: { label: "Markdown", tint: "var(--muted-foreground)" },
}
const kindOf = (ext: string) => DOC_KINDS[ext] ?? { label: ext.toUpperCase() || "File", tint: "var(--muted-foreground)" }

/** A page with a folded corner and the format on a small tab: the document twin of FolderIcon. */
export function DocIcon({ ext, size = 56, missing }: { ext: string; size?: number; missing?: boolean }) {
  const { tint } = kindOf(ext)
  const detailed = size >= 36
  return (
    <svg viewBox="0 0 48 60" width={(size * 48) / 60} height={size} aria-hidden className={cn("shrink-0 overflow-visible", missing && "opacity-50 grayscale")}>
      {detailed && <ellipse cx="24" cy="58" rx="17" ry="1.8" fill="#000" opacity="0.45" />}
      <path d="M6 4a3 3 0 0 1 3-3h20l13 13v39a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" fill="#3a332e" stroke={missing ? "#6b625b" : "none"} strokeDasharray={missing ? "3 2" : undefined} />
      <path d="M6 4a3 3 0 0 1 3-3h20l13 13v39a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" fill="url(#doc-sheen)" opacity="0.6" />
      <path d="M29 1v10a3 3 0 0 0 3 3h10Z" fill="#574b42" />
      <path d="M9.2 1.6H28" stroke="#fff" strokeOpacity="0.12" strokeWidth="0.8" />
      {detailed && (
        <g stroke="#fff" strokeOpacity="0.14" strokeWidth="1.4" strokeLinecap="round">
          <path d="M12 22h20M12 27h22M12 32h16" />
        </g>
      )}
      <rect x="2" y={detailed ? 38 : 34} width={detailed ? 30 : 34} height={detailed ? 11 : 14} rx="2" fill={tint} />
      <text
        x={detailed ? 17 : 19}
        y={detailed ? 45.6 : 43.8}
        textAnchor="middle"
        fontSize={detailed ? 7 : 9}
        fontWeight="700"
        fontFamily="-apple-system, BlinkMacSystemFont, system-ui, sans-serif"
        fill="#111"
      >
        {(ext || "?").slice(0, 4).toUpperCase()}
      </text>
      <defs>
        <linearGradient id="doc-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#000" stopOpacity="0.2" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function docMenu(doc: FolderDoc): MenuEntry[] {
  if (!doc.exists) {
    return doc.linkId
      ? [{ label: "Locate file…", onSelect: () => relinkDoc(doc) }, { label: "Remove link", onSelect: () => removeDoc(doc) }]
      : [{ label: "Refresh", onSelect: () => useStore.getState().refreshContents() }]
  }
  const entries: MenuEntry[] = [
    { label: "Quick Look", shortcut: "Space", onSelect: () => quickLook(doc) },
    { label: openLabel, shortcut: "↩", onSelect: () => openDoc(doc) },
    // On iPad both are the share sheet, so one is enough.
    ...(isIPad ? [] : [{ label: revealLabel, onSelect: () => revealDoc(doc) }]),
    "separator",
  ]
  if (!doc.linkId) entries.push({ label: "Rename…", onSelect: () => renameDoc(doc) })
  entries.push({ label: doc.linkId ? "Link to another folder…" : "Move to…", onSelect: () => moveDoc(doc) })
  entries.push("separator")
  entries.push(
    doc.linkId
      ? { label: "Remove link", onSelect: () => removeDoc(doc) }
      : { label: `${trashAction}…`, destructive: true, shortcut: `${mod}⌫`, onSelect: () => removeDoc(doc) },
  )
  return entries
}

function docDetail(doc: FolderDoc) {
  if (!doc.exists) return doc.linkId ? "Missing · linked file was moved" : "Missing"
  return [kindOf(doc.ext).label, formatBytes(doc.size)].join(" · ")
}

export function DocumentsView() {
  const { documents, selectedDoc, search, folder } = useStore(
    useShallow((s) => ({ documents: s.documents, selectedDoc: s.selectedDoc, search: s.search, folder: s.folder! })),
  )
  const [mode] = useViewMode()
  const q = search.trim().toLowerCase()
  const list = documents.filter((d) => !q || d.name.toLowerCase().includes(q))
  const select = (path: string | null) => useStore.getState().selectDoc(path)

  const onKey = (e: React.KeyboardEvent) => {
    const i = list.findIndex((d) => d.path === selectedDoc)
    const doc = list[i]
    if (e.key === " " && doc) {
      e.preventDefault()
      quickLook(doc)
    } else if (e.key === "Enter" && doc) {
      e.preventDefault()
      openDoc(doc)
    } else if ((e.metaKey || e.ctrlKey) && (e.key === "Backspace" || e.key === "Delete") && doc) {
      e.preventDefault()
      removeDoc(doc)
    } else if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key) && list.length) {
      e.preventDefault()
      const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1
      const next = list[Math.max(0, Math.min(list.length - 1, (i < 0 ? -1 : i) + step))]
      select(next.path)
      document.querySelector<HTMLElement>(`[data-doc="${CSS.escape(next.path)}"]`)?.focus()
    }
  }

  if (!documents.length) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia>
            <DocIcon ext="pdf" size={64} />
          </EmptyMedia>
          <EmptyTitle>No documents in this shoot</EmptyTitle>
          <EmptyDescription>Keep shot lists, client briefs, rosters and credentials with the photos. Drop files on this window, or add them here.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={() => pickFiles(folder)}>
            <Paperclip data-icon="inline-start" />
            Add files…
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const item = (d: FolderDoc) => {
    const selected = d.path === selectedDoc
    const common = {
      "data-doc": d.path,
      "aria-selected": selected,
      title: d.path,
      onFocus: () => select(d.path),
      onPointerDown: (e: React.PointerEvent) => e.button === 0 && select(d.path),
      // WebKit doesn't focus a clicked button (and mousedown would undo an earlier focus()), so
      // focus it once the click lands: Space, Return and the arrows act on the focused card.
      onClick: (e: React.MouseEvent<HTMLElement>) => e.currentTarget.focus({ preventScroll: true }),
      onDoubleClick: () => openDoc(d),
    }
    return (
      <ContextMenu key={d.linkId ?? d.path} onOpenChange={(o) => o && select(d.path)}>
        <ContextMenuTrigger asChild>
          {mode === "list" ? (
            <button
              {...common}
              role="row"
              className={cn(
                "grid h-10 w-full items-center gap-3 rounded-md px-2 text-left text-[13px] outline-none transition-[background-color] duration-100 hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring/60",
                selected && "bg-accent hover:bg-accent",
              )}
              style={{ gridTemplateColumns: DOC_COLUMNS }}
            >
              <DocIcon ext={d.ext} size={24} missing={!d.exists} />
              <span role="cell" className="flex min-w-0 items-center gap-1.5">
                <span className={cn("truncate font-medium", !d.exists && "text-muted-foreground")}>{d.name}</span>
                {d.linkId && <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-label="Linked" />}
              </span>
              <span role="cell" className="truncate text-xs text-muted-foreground">{kindOf(d.ext).label}</span>
              <span role="cell" className="text-right text-xs text-muted-foreground tabular-nums">{d.exists ? formatBytes(d.size) : "—"}</span>
              <span role="cell" className="truncate text-xs text-muted-foreground">
                {!d.exists ? <span className="text-(--label-yellow)">Missing</span> : d.modified ? relativeTime(d.modified) : ""}
              </span>
            </button>
          ) : (
            <button
              {...common}
              role="listitem"
              className={cn(
                "flex min-w-0 flex-col items-center gap-2 rounded-xl px-3 pt-4 pb-3 text-center outline-none transition-[background-color] duration-150 hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring/60",
                selected && "bg-accent hover:bg-accent",
              )}
            >
              <span className="relative">
                <DocIcon ext={d.ext} size={64} missing={!d.exists} />
                {d.linkId && (
                  <span className="absolute -right-1 bottom-0 flex size-5 items-center justify-center rounded-full bg-secondary shadow-edge" aria-label="Linked">
                    {d.exists ? <Link2 className="size-3" /> : <TriangleAlert className="size-3 text-(--label-yellow)" />}
                  </span>
                )}
              </span>
              <span className="flex w-full min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium">{d.name}</span>
                <span className={cn("truncate text-[11px]", d.exists ? "text-muted-foreground" : "text-(--label-yellow)")}>{docDetail(d)}</span>
              </span>
            </button>
          )}
        </ContextMenuTrigger>
        <ContextEntries entries={docMenu(d)} />
      </ContextMenu>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onKey}>
      {list.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No documents match “{search}”.</p>
      ) : mode === "list" ? (
        <div role="table" aria-label="Documents" className="min-w-[520px] px-2 pb-4">
          <div role="row" className="sticky top-0 z-10 grid h-8 items-center gap-3 bg-background px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase" style={{ gridTemplateColumns: DOC_COLUMNS }}>
            <span role="columnheader" className="col-span-2">Name</span>
            <span role="columnheader">Kind</span>
            <span role="columnheader" className="text-right">Size</span>
            <span role="columnheader">Modified</span>
          </div>
          {list.map(item)}
        </div>
      ) : (
        <div role="list" aria-label="Documents" className="grid gap-1 p-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          {list.map(item)}
        </div>
      )}
    </div>
  )
}

const DOC_COLUMNS = "24px minmax(0,1fr) 96px 72px 96px"

/** The selected document's details and actions, in the caption panel's place. */
export function DocumentInspector() {
  const { documents, selectedDoc, folder } = useStore(useShallow((s) => ({ documents: s.documents, selectedDoc: s.selectedDoc, folder: s.folder })))
  const doc = documents.find((d) => d.path === selectedDoc)
  if (!doc) return null
  const linked = !!doc.linkId
  const rows: [string, React.ReactNode][] = [
    ["Kind", kindOf(doc.ext).label],
    ["Size", doc.exists ? formatBytes(doc.size) : "—"],
    ["Modified", doc.exists && doc.modified ? new Date(doc.modified).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"],
    ["Stored", linked ? "Linked: the file stays where it is" : `In the shoot folder${folder ? ` (${baseName(folder)})` : ""}`],
    ["Location", <span className="break-all select-text">{doc.path}</span>],
  ]
  return (
    <aside className="flex h-full shrink-0 flex-col border-l bg-panel" style={{ width: INSPECTOR_WIDTH }} aria-label="Document details">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Document</div>
          <div className="truncate text-xs text-muted-foreground">{doc.name}</div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => useStore.getState().selectDoc(null)}>
          <X />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 p-4">
          <button
            className="flex h-40 items-center justify-center rounded-lg bg-black/25 shadow-edge outline-none transition-[box-shadow] duration-100 hover:shadow-edge-hover focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default"
            onClick={() => quickLook(doc)}
            disabled={!doc.exists}
            aria-label="Quick Look"
          >
            <DocIcon ext={doc.ext} size={96} missing={!doc.exists} />
          </button>

          {!doc.exists && (
            <div className="flex gap-2 rounded-lg bg-(--label-yellow)/10 p-3 text-xs">
              <TriangleAlert className="size-4 shrink-0 text-(--label-yellow)" />
              <div className="flex flex-col gap-2">
                <span>
                  {linked
                    ? "This linked file isn’t where it was. It may have been moved, renamed, or be on a drive that isn’t connected."
                    : "This file is no longer in the folder."}
                </span>
                {linked && (
                  <div className="flex gap-2">
                    <Button size="xs" variant="outline" onClick={() => relinkDoc(doc)}>
                      Locate…
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => removeDoc(doc)}>
                      Remove link
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {doc.exists && (
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" onClick={() => openDoc(doc)}>
                Open
              </Button>
              <Button size="sm" variant="secondary" onClick={() => quickLook(doc)}>
                <Eye data-icon="inline-start" />
                Quick Look
              </Button>
            </div>
          )}

          <dl className="flex flex-col gap-2.5 text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[72px_1fr] gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0">{v}</dd>
              </div>
            ))}
            {linked && (
              <div className="grid grid-cols-[72px_1fr] gap-2">
                <dt />
                <dd>
                  <Badge variant="secondary" className="gap-1">
                    <Link2 className="size-3" /> Linked
                  </Badge>
                </dd>
              </div>
            )}
          </dl>

          {doc.exists && (
            <div className="flex flex-col gap-1">
              {docMenu(doc)
                .filter((e): e is Extract<MenuEntry, { onSelect: () => void }> => e !== "separator" && "onSelect" in e && !["Quick Look", openLabel].includes(e.label))
                .map((e) => (
                  <Button
                    key={e.label}
                    variant="ghost"
                    size="sm"
                    className={cn("justify-start", e.destructive ? "text-destructive hover:text-destructive" : "text-muted-foreground")}
                    onClick={e.onSelect}
                  >
                    {e.label}
                  </Button>
                ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

/** Re-reads a linked document's info when the window comes back (it may have been moved). */
export function useRecheckDocs() {
  useEffect(() => {
    const onFocus = () => {
      const s = useStore.getState()
      if (s.folder && s.folderTab === "documents") s.refreshContents()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])
}
