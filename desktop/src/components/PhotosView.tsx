// Photos: the library sidebar, then either a library list (All shoots, a collection…) or the open
// folder: the contact sheet, the loupe, the caption panel and a one-line status bar. Culling is
// keyboard-first (see lib/hotkeys.ts); the mouse and right-click menus can do everything too.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Check, Eye, Lock, MessageSquareText, Play, RotateCcw, RotateCw, Star, X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { FILE_SCOPES, LABELS, photoFileName, primaryFile, thumbsWanted, thumbUrl, tinyThumbUrl, type Photo } from "@/lib/api"
import { askTrash, copyOrMove, openExport, openTargets, revealTarget } from "@/lib/actions"
import { captureTime, exposureLine, isIPad, labelColor, mod, openLabel, plural, revealLabel, trashAction } from "@/lib/format"
import { cn } from "@/lib/utils"
import { photoKey, useViewTracker } from "@/lib/viewing"
import { THUMB_MAX, THUMB_MIN, useStore, useVisiblePhotos } from "@/store"
import { useUI } from "@/ui"
import { CaptionPanel } from "@/components/CaptionPanel"
import { DocumentInspector, DocumentsView, FolderBar, SubfoldersView, useRecheckDocs } from "@/components/FolderView"
import { LibraryView } from "@/components/LibraryView"
import { Sidebar } from "@/components/Sidebar"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Loupe } from "@/components/Loupe"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const GAP = 8
const PAD = 12
const FOOTER = 30

export function PhotosView() {
  const { folder, loading, librarySection } = useStore(
    useShallow((s) => ({ folder: s.folder, loading: s.loading, librarySection: s.librarySection })),
  )
  useRecheckDocs()

  return (
    <div className="flex h-full">
      <Sidebar />
      {librarySection || !folder ? (
        loading ? (
          <Empty className="h-full flex-1">
            <EmptyHeader>
              <EmptyTitle>Opening…</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <LibraryView section={librarySection ?? { kind: "all" }} />
        )
      ) : (
        <FolderPane />
      )}
    </div>
  )
}

/** The open folder: its bar, then photos, subfolders or documents, plus the right inspector. */
function FolderPane() {
  const { loupe, captionPanel, folderTab, selectedDoc } = useStore(
    useShallow((s) => ({ loupe: s.loupe, captionPanel: s.captionPanel, folderTab: s.folderTab, selectedDoc: s.selectedDoc })),
  )
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <FolderBar />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The contact sheet stays mounted, so switching tabs keeps its scroll position. */}
          <div className="flex min-h-0 flex-1 flex-col" hidden={folderTab !== "photos"}>
            <div className="relative min-h-0 flex-1">
              <Grid />
              {loupe && <Loupe />}
            </div>
            <StatusBar />
          </div>
          {folderTab === "folders" && <SubfoldersView />}
          {folderTab === "documents" && <DocumentsView />}
        </div>
        {folderTab === "photos" && captionPanel && <CaptionPanel />}
        {folderTab === "documents" && selectedDoc && <DocumentInspector />}
      </div>
    </div>
  )
}

function Grid() {
  const { thumbSize, selected, focus, detailsReady, resumeMarker } = useStore(
    useShallow((s) => ({ thumbSize: s.thumbSize, selected: s.selected, focus: s.focus, detailsReady: s.detailsReady, resumeMarker: s.resumeMarker })),
  )
  const list = useVisiblePhotos()
  const hasPhotos = useStore((s) => s.photos.length > 0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Cells stretch so each row fills the width exactly: no ragged gap on the right.
  const columns = Math.max(1, Math.floor((width - PAD * 2 + GAP) / (thumbSize + GAP)))
  const cellWidth = width > 0 ? (width - PAD * 2 - GAP * (columns - 1)) / columns : thumbSize
  const rowHeight = Math.round(cellWidth * (2 / 3)) + FOOTER + GAP
  const rows = Math.ceil(list.length / columns)

  useEffect(() => useStore.getState().setColumns(columns), [columns])

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    paddingStart: PAD,
    paddingEnd: PAD,
  })
  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer])

  // Rust makes the thumbnails on screen first: tell it which those are as the sheet scrolls.
  const scope = useStore((s) => s.fileScope)
  const items = virtualizer.getVirtualItems()
  const firstRow = items[0]?.index ?? 0
  const lastRow = items[items.length - 1]?.index ?? -1
  useEffect(() => {
    const shown = list.slice(firstRow * columns, (lastRow + 1) * columns).map((p) => primaryFile(p, scope))
    const timer = setTimeout(() => void thumbsWanted(shown).catch(() => {}), 60)
    return () => clearTimeout(timer)
  }, [list, firstRow, lastRow, columns, scope])
  useEffect(() => () => void thumbsWanted([]).catch(() => {}), [])

  // Keep the focused photo on screen as the keyboard moves it; Continue reviewing centers it.
  const focusIndex = useMemo(() => list.findIndex((p) => p.id === focus), [list, focus])
  useEffect(() => {
    if (focusIndex >= 0) virtualizer.scrollToIndex(Math.floor(focusIndex / columns), { align: resumeMarker ? "center" : "auto" })
  }, [focusIndex, columns, virtualizer, resumeMarker])

  // Review tracking: thumbnails that stay on screen long enough count as viewed.
  const tracker = useViewTracker(scrollRef)
  useEffect(() => {
    if (scrollRef.current) tracker.scan(scrollRef.current)
  })

  // ⌘/Ctrl + scroll or pinch resizes thumbnails.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const s = useStore.getState()
      s.setThumbSize(s.thumbSize * (1 - e.deltaY * 0.01))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  const click = useStore((s) => s.click)
  const setLoupe = useStore((s) => s.setLoupe)
  const cull = useStore((s) => s.cull)

  return (
    <div ref={scrollRef} className="absolute inset-0 overflow-y-auto outline-none" tabIndex={-1}>
      {!detailsReady && <Progress aria-label="Loading photo details" className="absolute inset-x-0 top-0 z-10 h-0.5 rounded-none" value={null} />}
      {list.length === 0 && !hasPhotos ? (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyTitle>No photos in this folder</EmptyTitle>
            <EmptyDescription>Its subfolders and documents are under Folders and Documents above.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : list.length === 0 ? (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyTitle>No photos match</EmptyTitle>
            <EmptyDescription>Try another filter, or clear the ones you set.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={() => useStore.getState().clearFilters()}>
              Show all photos
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              className="absolute inset-x-0 flex"
              style={{ top: row.start, height: rowHeight - GAP, gap: GAP, paddingInline: PAD }}
            >
              {list.slice(row.index * columns, row.index * columns + columns).map((p) => (
                <PhotoMenu key={p.id} photo={p} selected={selected.has(p.id)}>
                <PhotoCard
                  photo={p}
                  width={cellWidth}
                  selected={selected.has(p.id)}
                  focused={p.id === focus}
                  resume={p.id === resumeMarker}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    click(p.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })
                  }}
                  onOpen={() => setLoupe(true)}
                  onToggleTag={() => {
                    if (!selected.has(p.id)) click(p.id, {})
                    cull(() => ({ tagged: !p.tagged }))
                  }}
                  onRate={(n) => {
                    if (!selected.has(p.id)) click(p.id, {})
                    cull(() => ({ rating: p.rating === n ? 0 : n }))
                  }}
                />
                </PhotoMenu>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onPointerDown"> {
  ref?: React.Ref<HTMLDivElement>
  photo: Photo
  width: number
  selected: boolean
  focused: boolean
  /** Continue reviewing landed here: a brief marker, never a lasting change to the card. */
  resume?: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onOpen: () => void
  onToggleTag: () => void
  onRate: (n: number) => void
}

/** The photos under the last two pointer presses, oldest first. */
let pointerHistory: [string | null, string | null] = [null, null]
/** A finger came down on the photo that was already selected: lifting it soon opens the loupe. */
let tapOpens: { id: string; at: number } | null = null

/** Right-click a photo: culling, captions and file actions for it (or the whole selection). */
function PhotoMenu({ photo, selected, children }: { photo: Photo; selected: boolean; children: React.ReactNode }) {
  const s = useStore.getState
  const count = selected ? s().selected.size : 1
  const them = count > 1 ? `${count} photos` : "photo"
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open && !useStore.getState().selected.has(photo.id)) useStore.getState().click(photo.id, {})
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem onSelect={() => s().setLoupe(true)}>
          Preview <ContextMenuShortcut>Space</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => s().focusCaption()}>
          Edit caption <ContextMenuShortcut>{mod}↩</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => s().cull((t) => ({ tagged: !t.every((p) => p.tagged) }))}>
          {photo.tagged ? "Untag" : "Tag"} <ContextMenuShortcut>T</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Rating</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <ContextMenuItem key={n} onSelect={() => s().cull(() => ({ rating: n }))}>
                {n ? "★".repeat(n) : "No rating"} <ContextMenuShortcut>{n}</ContextMenuShortcut>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Label</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => s().cull(() => ({ label: null }))}>No label</ContextMenuItem>
            {LABELS.map((l, i) => (
              <ContextMenuItem key={l} onSelect={() => s().cull(() => ({ label: l }))}>
                <span className="size-2.5 rounded-full" style={{ background: labelColor(l) }} /> {l}
                {i < 4 && <ContextMenuShortcut>{i + 6}</ContextMenuShortcut>}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void s().rotate(false)}>
          <RotateCcw /> Rotate left <ContextMenuShortcut>{mod}[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void s().rotate(true)}>
          <RotateCw /> Rotate right <ContextMenuShortcut>{mod}]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => s().copyCaptions()}>
          Copy caption info <ContextMenuShortcut>⌥{mod}C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!s().captionClipboard} onSelect={() => s().pasteCaptions()}>
          Paste caption info <ContextMenuShortcut>⌥{mod}V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => openExport("selected")}>
          Export {them}… <ContextMenuShortcut>⇧{mod}E</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => useUI.getState().openRename("selected")}>
          Rename {them}…
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyOrMove("selected", false)}>Copy {them} to…</ContextMenuItem>
        <ContextMenuItem onSelect={() => copyOrMove("selected", true)}>Move {them} to…</ContextMenuItem>
        <ContextMenuItem onSelect={() => useUI.getState().openSend("selected")}>Send {them} via FTP…</ContextMenuItem>
        <ContextMenuItem onSelect={revealTarget}>
          {revealLabel} <ContextMenuShortcut>⇧{mod}R</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={openTargets}>
          {openLabel} <ContextMenuShortcut>{mod}E</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={askTrash}>
          {trashAction} <ContextMenuShortcut>{mod}⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

const PhotoCard = memo(function PhotoCard({ photo: p, width, selected, focused, resume, onPointerDown, onOpen, onToggleTag, onRate, ref, className, style, ...rest }: CardProps) {
  const scope = useStore((s) => s.fileScope)
  const file = primaryFile(p, scope)
  const src = thumbUrl(file, p.rotated)
  const tiny = tinyThumbUrl(file, p.rotated)
  const name = photoFileName(p, scope)
  const kind = scope === "both" ? p.kind : name.split(".").pop()?.toUpperCase()
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  // The camera's little preview shows at once; the real thumbnail covers it when it's ready.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedTiny, setFailedTiny] = useState<string | null>(null)
  return (
    <div
      {...rest}
      ref={ref}
      data-view-key={photoKey(p)}
      className={cn(
        "group/card relative flex shrink-0 flex-col overflow-hidden rounded-md bg-card shadow-edge",
        // Amber means selected and nothing else: tag and stars stay neutral, so the three read apart.
        selected ? "bg-accent ring-2 ring-(--workspace-photos) ring-offset-2 ring-offset-background" : "hover:shadow-edge-hover",
        focused && selected && "ring-3",
        className,
      )}
      style={{ ...style, width }}
      onPointerDown={(e) => {
        pointerHistory = [pointerHistory[1], p.id]
        tapOpens = (e.pointerType === "touch" || isIPad) && focused && selected ? { id: p.id, at: e.timeStamp } : null
        onPointerDown(e)
      }}
      onPointerUp={(e) => {
        rest.onPointerUp?.(e) // the context menu's long-press timer
        // iPad: tap a photo to select it, tap it again to open it.
        if (tapOpens?.id === p.id && e.timeStamp - tapOpens.at < 500 && !(e.target as HTMLElement).closest("button")) onOpen()
        tapOpens = null
      }}
      onDoubleClick={(e) => {
        // Only two clicks on this same photo open it: not a click then a quick shift/⌘-click on
        // another photo, and not quickly tagging then rating.
        if (e.shiftKey || e.metaKey || e.ctrlKey || pointerHistory[0] !== p.id) return
        if (!(e.target as HTMLElement).closest("button")) onOpen()
      }}
    >
      <div className="relative min-h-0 flex-1 bg-photo-canvas">
        {loadedSrc !== src && failedTiny !== tiny && failedSrc !== src && (
          <img
            key={tiny}
            src={tiny}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 size-full object-contain"
            onError={() => setFailedTiny(tiny)}
          />
        )}
        {failedSrc !== src && (
          <img
            key={src}
            src={src}
            alt={name}
            draggable={false}
            decoding="async"
            fetchPriority={focused ? "high" : undefined}
            className="relative size-full object-contain"
            onLoad={() => setLoadedSrc(src)}
            onError={() => setFailedSrc(src)}
          />
        )}
        {resume && <ResumeMarker />}
        {/* Tagged: a white check on the photo. Untagged: an empty ring while pointing at it. */}
        <Button
          variant="ghost"
          size="icon-xs"
          static
          aria-label={p.tagged ? "Untag" : "Tag"}
          aria-pressed={p.tagged}
          className={cn(
            "absolute top-2 left-2 size-[22px] rounded-full shadow-raised",
            p.tagged
              ? "bg-foreground text-background hover:bg-foreground/85 hover:text-background"
              : "border-[1.5px] border-white/80 bg-black/35 text-transparent opacity-0 group-hover/card:opacity-100 hover:bg-black/50 hover:text-white/80 focus-visible:opacity-100 pointer-coarse:opacity-100",
            !p.tagged && selected && "opacity-100",
            resume && "hidden",
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleTag}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </Button>
      </div>
      <div className="flex h-photo-footer shrink-0 items-center gap-1.5 px-2.5 text-xs shadow-[inset_0_1px_0_var(--edge-light-faint)]">
        {p.locked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Locked on the camera" />
            </TooltipTrigger>
            <TooltipContent className="max-w-56">
              Locked on the camera. It counts as tagged; T untags it here, and the file stays locked.
            </TooltipContent>
          </Tooltip>
        )}
        {p.label && <span className="size-2.5 shrink-0 rounded-full" style={{ background: labelColor(p.label) }} role="img" aria-label={`${p.label} label`} />}
        <span className={cn("min-w-0 flex-1 truncate", p.tagged ? "font-semibold text-foreground" : "text-muted-foreground")} title={name}>{name}</span>
        {(p.captions.caption || p.captions.headline) && (
          <MessageSquareText className="size-3.5 shrink-0 text-muted-foreground" aria-label="Has a caption" />
        )}
        {width > 260 && <span className="text-micro text-muted-foreground">{kind}</span>}
        {/* Less is more: stars show once rated, or while pointing at the photo. */}
        <div className={cn(p.rating === 0 && !selected && "opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100")}>
          <Stars rating={p.rating} onRate={onRate} />
        </div>
      </div>
    </div>
  )
})

/** "Resume here": a soft orange glow and a label that fade out on their own. */
function ResumeMarker() {
  return (
    <div
      className="pointer-events-none absolute inset-0 animate-[resume-marker_6s_ease-out_forwards] rounded-t-md shadow-resume motion-reduce:animate-none"
      aria-hidden
    >
      <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-caption font-semibold text-primary-foreground shadow-sm">
        <Play className="size-2.5 fill-current" /> Resume here
      </span>
    </div>
  )
}

function Stars({ rating, onRate }: { rating: number; onRate: (n: number) => void }) {
  return (
    <div className="flex" onPointerDown={(e) => e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Button
          key={n}
          variant="ghost"
          size="icon-xs"
          static
          className="relative size-4 rounded-none p-0 after:absolute after:inset-x-0 after:-inset-y-1.5 hover:bg-transparent"
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          aria-pressed={rating === n}
          onClick={() => onRate(n)}
        >
          <Star
            className={cn("size-3", n <= rating ? "fill-foreground text-foreground" : "text-muted-foreground group-hover/button:text-foreground")}
          />
        </Button>
      ))}
    </div>
  )
}

function StatusBar() {
  const { photos, focus, selectedCount, detailsReady, thumbSize, setThumbSize, busy, unviewedOnly } = useStore(
    useShallow((s) => ({
      unviewedOnly: s.unviewedOnly,
      busy: s.busy,
      photos: s.photos,
      focus: s.focus,
      selectedCount: s.selected.size,
      detailsReady: s.detailsReady,
      thumbSize: s.thumbSize,
      setThumbSize: s.setThumbSize,
    })),
  )
  const focused = useMemo(() => photos.find((p) => p.id === focus), [photos, focus])
  const tagged = useMemo(() => photos.reduce((n, p) => n + (p.tagged ? 1 : 0), 0), [photos])
  const shown = useVisiblePhotos().length
  const fileScope = useStore((s) => s.fileScope)
  const format = fileScope === "both" ? null : FILE_SCOPES.find((item) => item.value === fileScope)?.label

  const left = busy
    ? busy
    : selectedCount > 1
      ? `${selectedCount.toLocaleString()} selected`
      : focused
        ? [focused.meta?.camera, focused.meta?.lens, exposureLine(focused.meta), captureTime(focused.meta)]
            .filter(Boolean)
            .join("   ·   ")
        : ""

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t surface-bar px-3 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{left}</span>
      {unviewedOnly && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/15 py-0.5 pr-0.5 pl-2 text-caption text-foreground shadow-[inset_0_0_0_1px_var(--focus-soft)]">
          <Eye className="size-3 text-primary-readable" /> Unviewed only
          <Button
            variant="ghost"
            size="icon-xs"
            static
            className="size-4 rounded-full"
            aria-label="Show viewed photos too"
            onClick={() => useStore.getState().setUnviewedOnly(false)}
          >
            <X className="size-3" />
          </Button>
        </span>
      )}
      <Slider
        aria-label="Thumbnail size"
        min={THUMB_MIN}
        max={THUMB_MAX}
        value={[thumbSize]}
        onValueChange={([v]) => setThumbSize(v)}
        className="w-24"
      />
      <span className="flex shrink-0 items-center gap-1 tabular-nums">
        {format && <span className="text-foreground">{format} ·</span>}
        {shown < photos.length ? (
          <>
            {shown.toLocaleString()} of {plural(photos.length, "photo")}
            <Button variant="ghost" size="xs" className="-my-1 h-5 px-1.5 text-xs text-(--workspace-photos) hover:text-(--workspace-photos)" onClick={() => useStore.getState().clearFilters()}>
              Show all
            </Button>
          </>
        ) : (
          plural(photos.length, "photo")
        )}
        {" "}· {tagged.toLocaleString()} tagged
        {!detailsReady && " · reading…"}
      </span>
    </footer>
  )
}
