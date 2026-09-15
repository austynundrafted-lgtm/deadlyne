// Photos: the contact sheet, the loupe and a one-line status bar. Culling is keyboard-first
// (see useCullingKeys); the mouse can do everything too.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Check, FolderOpen, Images, Star } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { thumbUrl, type Photo } from "@/lib/api"
import { openFolderDialog } from "@/lib/actions"
import { captureTime, exposureLine, labelColor, mod, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { THUMB_MAX, THUMB_MIN, useStore, visiblePhotos } from "@/store"
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
  const { folder, loading, loupe } = useStore(useShallow((s) => ({ folder: s.folder, loading: s.loading, loupe: s.loupe })))

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
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <Grid />
        {loupe && <Loupe />}
      </div>
      <StatusBar />
    </div>
  )
}

function Grid() {
  const { photos, tagFilter, minRating, labelFilter, thumbSize, selected, focus, detailsReady } = useStore(
    useShallow((s) => ({
      photos: s.photos,
      tagFilter: s.tagFilter,
      minRating: s.minRating,
      labelFilter: s.labelFilter,
      thumbSize: s.thumbSize,
      selected: s.selected,
      focus: s.focus,
      detailsReady: s.detailsReady,
    })),
  )
  const list = useMemo(
    () => visiblePhotos({ photos, tagFilter, minRating, labelFilter }),
    [photos, tagFilter, minRating, labelFilter],
  )
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
                <PhotoCard
                  key={p.id}
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
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface CardProps {
  photo: Photo
  width: number
  selected: boolean
  focused: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onOpen: () => void
  onToggleTag: () => void
  onRate: (n: number) => void
}

const PhotoCard = memo(function PhotoCard({ photo: p, width, selected, focused, onPointerDown, onOpen, onToggleTag, onRate }: CardProps) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={cn(
        "group/card relative flex shrink-0 flex-col overflow-hidden rounded-md bg-card ring-1 ring-white/5 transition-shadow",
        selected && "bg-accent ring-2 ring-(--workspace-photos)",
        focused && selected && "ring-3",
      )}
      style={{ width }}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        // Quickly tagging then rating must not count as a double-click on the photo.
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
  const { photos, focus, selectedCount, detailsReady, thumbSize, setThumbSize } = useStore(
    useShallow((s) => ({
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

  const left =
    selectedCount > 1
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
