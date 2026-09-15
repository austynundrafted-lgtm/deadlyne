// Photos: the contact sheet, the loupe, the caption panel and a one-line status bar. Culling is
// keyboard-first (see lib/hotkeys.ts); the mouse and right-click menus can do everything too.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Check, FolderOpen, Images, MessageSquareText, Star } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { thumbUrl, type Photo } from "@/lib/api"
import { askTrash, copyOrMove, openFolderDialog } from "@/lib/actions"
import { captureTime, exposureLine, labelColor, mod, plural } from "@/lib/format"
import { LABELS, reveal } from "@/lib/api"
import { cn } from "@/lib/utils"
import { THUMB_MAX, THUMB_MIN, useStore, useVisiblePhotos } from "@/store"
import { CaptionPanel } from "@/components/CaptionPanel"
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"

const GAP = 8
const PAD = 12
const FOOTER = 30

export function PhotosView() {
  const { folder, loading, loupe, captionPanel } = useStore(
    useShallow((s) => ({ folder: s.folder, loading: s.loading, loupe: s.loupe, captionPanel: s.captionPanel })),
  )

  if (!folder) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Images />
          </EmptyMedia>
          <EmptyTitle>{loading ? "Opening…" : "No shoot open"}</EmptyTitle>
          <EmptyDescription>
            Deadlyne reads the previews already inside your RAW files, so even thousand-frame shoots open instantly.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={openFolderDialog}>
            <FolderOpen data-icon="inline-start" />
            Open a shoot <Kbd className="ml-1 bg-black/20 text-primary-foreground">{mod}O</Kbd>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <Grid />
          {loupe && <Loupe />}
        </div>
        <StatusBar />
      </div>
      {captionPanel && <CaptionPanel />}
    </div>
  )
}

function Grid() {
  const { thumbSize, selected, focus, detailsReady } = useStore(
    useShallow((s) => ({ thumbSize: s.thumbSize, selected: s.selected, focus: s.focus, detailsReady: s.detailsReady })),
  )
  const list = useVisiblePhotos()
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

  // Keep the focused photo on screen as the keyboard moves it.
  const focusIndex = useMemo(() => list.findIndex((p) => p.id === focus), [list, focus])
  useEffect(() => {
    if (focusIndex >= 0) virtualizer.scrollToIndex(Math.floor(focusIndex / columns), { align: "auto" })
  }, [focusIndex, columns, virtualizer])

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
    <div ref={scrollRef} className="absolute inset-0 overflow-y-auto" tabIndex={-1}>
      {!detailsReady && <Progress className="absolute inset-x-0 top-0 z-10 h-0.5 rounded-none" value={null} />}
      {list.length === 0 ? (
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
  onPointerDown: (e: React.PointerEvent) => void
  onOpen: () => void
  onToggleTag: () => void
  onRate: (n: number) => void
}

/** The photos under the last two pointer presses, oldest first. */
let pointerHistory: [string | null, string | null] = [null, null]

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
        <ContextMenuItem onSelect={() => s().copyCaptions()}>
          Copy caption info <ContextMenuShortcut>⌥{mod}C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!s().captionClipboard} onSelect={() => s().pasteCaptions()}>
          Paste caption info <ContextMenuShortcut>⌥{mod}V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyOrMove("selected", false)}>Copy {them} to…</ContextMenuItem>
        <ContextMenuItem onSelect={() => copyOrMove("selected", true)}>Move {them} to…</ContextMenuItem>
        <ContextMenuItem onSelect={() => reveal(photo.id)}>Show in {navigator.userAgent.includes("Mac") ? "Finder" : "Explorer"}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={askTrash}>
          Move to Trash <ContextMenuShortcut>{mod}⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

const PhotoCard = memo(function PhotoCard({ photo: p, width, selected, focused, onPointerDown, onOpen, onToggleTag, onRate, ref, className, style, ...rest }: CardProps) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      {...rest}
      ref={ref}
      className={cn(
        "group/card relative flex shrink-0 flex-col overflow-hidden rounded-md bg-card ring-1 ring-white/5 transition-shadow",
        selected && "bg-accent ring-2 ring-(--workspace-photos)",
        focused && selected && "ring-3",
        className,
      )}
      style={{ ...style, width }}
      onPointerDown={(e) => {
        pointerHistory = [pointerHistory[1], p.id]
        onPointerDown(e)
      }}
      onDoubleClick={(e) => {
        // Only two clicks on this same photo open it: not a click then a quick shift/⌘-click on
        // another photo, and not quickly tagging then rating.
        if (e.shiftKey || e.metaKey || e.ctrlKey || pointerHistory[0] !== p.id) return
        if (!(e.target as HTMLElement).closest("button")) onOpen()
      }}
    >
      <div className="relative min-h-0 flex-1 bg-black/30">
        {!failed && (
          <img
            src={thumbUrl(p)}
            alt=""
            draggable={false}
            decoding="async"
            className="size-full object-contain"
            onError={() => setFailed(true)}
          />
        )}
        {p.label && <span className="absolute inset-x-0 top-0 h-1" style={{ background: labelColor(p.label) }} />}
      </div>
      <div className="flex h-[30px] shrink-0 items-center gap-1 px-1.5 text-xs">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={p.tagged ? "Untag" : "Tag"}
          aria-pressed={p.tagged}
          className={cn("rounded-sm", p.tagged ? "bg-(--workspace-photos) text-black hover:bg-(--workspace-photos)/80 hover:text-black" : "text-muted-foreground")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleTag}
        >
          <Check className={cn(!p.tagged && "opacity-40")} />
        </Button>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">{p.name}</span>
        {(p.captions.caption || p.captions.headline) && (
          <MessageSquareText className="size-3.5 shrink-0 text-muted-foreground" aria-label="Has a caption" />
        )}
        {width > 260 && <span className="text-[10px] text-muted-foreground">{p.kind}</span>}
        {/* Less is more: stars show once rated, or while pointing at the photo. */}
        <div className={cn(p.rating === 0 && !selected && "opacity-0 group-hover/card:opacity-100")}>
          <Stars rating={p.rating} onRate={onRate} />
        </div>
      </div>
    </div>
  )
})

function Stars({ rating, onRate }: { rating: number; onRate: (n: number) => void }) {
  return (
    <div className="flex" onPointerDown={(e) => e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Button
          key={n}
          variant="ghost"
          size="icon-xs"
          className="size-4 rounded-none p-0 hover:bg-transparent"
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onClick={() => onRate(n)}
        >
          <Star
            className={cn("size-3", n <= rating ? "fill-(--workspace-photos) text-(--workspace-photos)" : "text-muted-foreground/40")}
          />
        </Button>
      ))}
    </div>
  )
}

function StatusBar() {
  const { photos, focus, selectedCount, detailsReady, thumbSize, setThumbSize, busy } = useStore(
    useShallow((s) => ({
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

  const left = busy
    ? busy
    : selectedCount > 1
      ? `${selectedCount.toLocaleString()} selected`
      : focused
        ? [focused.name, focused.meta?.camera, focused.meta?.lens, exposureLine(focused.meta), captureTime(focused.meta)]
            .filter(Boolean)
            .join("   ·   ")
        : ""

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-bar px-3 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{left}</span>
      <Slider
        aria-label="Thumbnail size"
        min={THUMB_MIN}
        max={THUMB_MAX}
        value={[thumbSize]}
        onValueChange={([v]) => setThumbSize(v)}
        className="w-24"
      />
      <span className="shrink-0 tabular-nums">
        {plural(photos.length, "photo")} · {tagged.toLocaleString()} tagged
        {!detailsReady && " · reading…"}
      </span>
    </footer>
  )
}
