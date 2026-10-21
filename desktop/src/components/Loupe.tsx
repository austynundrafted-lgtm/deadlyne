// Full-size preview over the grid. Shows the thumbnail instantly, swaps in the full embedded
// JPEG when it's decoded, and pre-loads the neighbours so flipping is instant. Click or Z zooms
// to 100% at that point to check focus; drag or scroll pans, and another click fits it again.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Check, ChevronLeft, ChevronRight, FastForward, Star, X, ZoomIn } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { previewUrl, thumbUrl } from "@/lib/api"
import { isIPad, labelColor, mod, orientationTransform } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore, useVisiblePhotos } from "@/store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type Point = { x: number; y: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function Loupe() {
  const { focus, setLoupe, zoom, setZoom, autoAdvance, setAutoAdvance } = useStore(
    useShallow((s) => ({ focus: s.focus, setLoupe: s.setLoupe, zoom: s.zoom, setZoom: s.setZoom, autoAdvance: s.autoAdvance, setAutoAdvance: s.setAutoAdvance })),
  )
  const list = useVisiblePhotos()
  const index = list.findIndex((p) => p.id === focus)
  const photo = list[index]

  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0, outerW: 0, outerH: 0 })
  const imgRef = useRef<HTMLImageElement>(null)
  /** The zoomed photo's on-screen size, for turning a drag in pixels into a new center. */
  const zoomed = useRef<{ w: number; h: number } | null>(null)
  /** `swipe`: a finger on the fitted photo, which flips photos or, if it doesn't move, zooms there. */
  const drag = useRef<{ x: number; y: number; center: Point | null; wasZoomed: boolean; swipe?: boolean } | null>(null)
  /** On iPad a single tap does nothing and a double tap zooms, like Photos; this is the first tap. */
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    // Fit inside the padding, like the thumbnail shown first, so the photo doesn't jump when the preview lands.
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(el)
      setBox({
        w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
        outerW: el.clientWidth,
        outerH: el.clientHeight,
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [full, setFull] = useState<{ id: string; w: number; h: number } | null>(null)

  // Decode the full preview off-screen, then show it; warm the neighbours.
  useEffect(() => {
    if (!photo) return
    let cancelled = false
    const img = new Image()
    img.style.imageOrientation = "none"
    img.src = previewUrl(photo)
    img
      .decode()
      .then(() => !cancelled && setFull({ id: photo.id, w: img.naturalWidth, h: img.naturalHeight }))
      .catch(() => {})
    for (const n of [list[index + 1], list[index - 1]]) if (n) new Image().src = previewUrl(n)
    return () => {
      cancelled = true
    }
  }, [photo?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!photo) return null

  const showingFull = full?.id === photo.id
  const { transform, swapsAxes } = orientationTransform(showingFull ? (photo.meta?.orientation ?? 1) : 1)

  // Fit the (possibly rotated) image inside the box, or show it at 100% (one photo pixel per
  // screen pixel) around the zoom point, kept edge to edge when it's bigger than the view.
  let style: React.CSSProperties = { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }
  zoomed.current = null
  if (showingFull && box.w > 0) {
    const [dw, dh] = swapsAxes ? [full.h, full.w] : [full.w, full.h]
    const fit = Math.min(box.w / dw, box.h / dh)
    const scale = zoom ? Math.max(fit, 1 / (window.devicePixelRatio || 1)) : fit
    let left = box.outerW / 2
    let top = box.outerH / 2
    if (zoom) {
      const [w, h] = [dw * scale, dh * scale]
      const x = w > box.outerW ? clamp(box.outerW / 2 - zoom.x * w, box.outerW - w, 0) : (box.outerW - w) / 2
      const y = h > box.outerH ? clamp(box.outerH / 2 - zoom.y * h, box.outerH - h, 0) : (box.outerH - h) / 2
      left = x + w / 2
      top = y + h / 2
      zoomed.current = { w, h }
    }
    style = {
      position: "absolute",
      left,
      top,
      width: full.w * scale,
      height: full.h * scale,
      maxWidth: "none", // Tailwind's base style caps images at the view width, which would squash 100%
      transform: `translate(-50%, -50%)${transform === "none" ? "" : ` ${transform}`}`,
      imageOrientation: "none",
    }
  }

  /** Keeps the view inside the photo while panning. */
  const clampCenter = (c: Point): Point => {
    const z = zoomed.current
    if (!z) return c
    const hx = Math.min(0.5, box.outerW / z.w / 2)
    const hy = Math.min(0.5, box.outerH / z.h / 2)
    return { x: clamp(c.x, hx, 1 - hx), y: clamp(c.y, hy, 1 - hy) }
  }

  const pointAt = (x: number, y: number): Point => {
    const r = imgRef.current?.getBoundingClientRect()
    return r && r.width > 0 ? { x: clamp((x - r.left) / r.width, 0, 1), y: clamp((y - r.top) / r.height, 0, 1) } : { x: 0.5, y: 0.5 }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return
    // On iPad every pointer (finger, pencil, trackpad, the Simulator's mouse) taps rather than
    // zooming on press, and nothing is captured, so the next tap always reaches what it's on.
    if ((e.pointerType !== "mouse" || isIPad) && !zoom) {
      drag.current = { x: e.clientX, y: e.clientY, center: null, wasZoomed: false, swipe: true }
      return
    }
    let center = zoom
    if (!center) {
      // Zoom in on the point that was clicked.
      center = pointAt(e.clientX, e.clientY)
      setZoom(center)
    }
    drag.current = { x: e.clientX, y: e.clientY, center, wasZoomed: !!zoom }
    // A mouse needs capture to keep panning past the edge. On iPad touches stay with the photo
    // anyway, and capturing there swallows the pointerup that a double tap needs.
    if (!isIPad) e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const z = zoomed.current
    if (!d?.center || !z) return
    setZoom(clampCenter({ x: d.center.x - (e.clientX - d.x) / z.w, y: d.center.y - (e.clientY - d.y) / z.h }))
  }

  /** True when this tap is the second of a double tap. */
  const isDoubleTap = (e: React.PointerEvent) => {
    const prev = lastTap.current
    const now = { t: e.timeStamp, x: e.clientX, y: e.clientY }
    const double = !!prev && now.t - prev.t < 450 && Math.hypot(now.x - prev.x, now.y - prev.y) < 40
    lastTap.current = double ? null : now
    return double
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.swipe && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      lastTap.current = null
      useStore.getState().move(dx < 0 ? 1 : -1)
      return
    }
    if (isIPad) {
      if (Math.hypot(dx, dy) < 8 && isDoubleTap(e)) setZoom(zoom ? null : pointAt(e.clientX, e.clientY))
      return
    }
    if (d.swipe) {
      if (Math.hypot(dx, dy) < 8) setZoom(pointAt(e.clientX, e.clientY))
      return
    }
    // A click (not a drag) on a zoomed photo fits it again.
    if (d.wasZoomed && Math.hypot(dx, dy) < 3) setZoom(null)
  }

  const onWheel = (e: React.WheelEvent) => {
    const z = zoomed.current
    if (!zoom || !z) return
    setZoom(clampCenter({ x: zoom.x + e.deltaX / z.w, y: zoom.y + e.deltaY / z.h }))
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div
        ref={boxRef}
        className={cn(
          "relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden p-3",
          zoom ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        // Only when the box itself lets go: the photo inside fires this too (it bubbles) as its
        // implicit touch capture moves to the box, which would end every pan before it starts.
        onLostPointerCapture={(e) => e.target === e.currentTarget && (drag.current = null)}
        onWheel={onWheel}
      >
        <img
          ref={imgRef}
          key={showingFull ? "full" : "thumb"}
          src={showingFull ? previewUrl(photo) : thumbUrl(photo)}
          alt={photo.name}
          draggable={false}
          style={style}
          className={cn(showingFull ? "outline -outline-offset-1 outline-white/10" : "size-full")}
        />
        <Button
          variant="secondary"
          size={isIPad ? "icon-lg" : "icon-sm"}
          className={cn("absolute top-3 right-3 z-10", isIPad ? "shadow-edge" : "opacity-70 hover:opacity-100")}
          aria-label="Back to the grid"
          onClick={() => setLoupe(false)}
        >
          <X />
        </Button>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-3 border-t bg-bar px-3 text-xs">
        <span className="min-w-0 truncate font-medium">{photo.name}</span>
        <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
          {index + 1} / {list.length.toLocaleString()}
        </span>
        {/* On iPad the tag and star buttons show these already. */}
        {photo.tagged && !isIPad && (
          <Badge className="bg-(--workspace-photos) text-black">
            <Check /> Tagged
          </Badge>
        )}
        {photo.rating > 0 && !isIPad && (
          <span className="flex">
            {Array.from({ length: photo.rating }, (_, i) => (
              <Star key={i} className="size-3.5 fill-(--workspace-photos) text-(--workspace-photos)" />
            ))}
          </span>
        )}
        {photo.label && (
          <Badge variant="outline" className="gap-1.5">
            <span className="size-2 rounded-full" style={{ background: labelColor(photo.label) }} />
            {photo.label}
          </Badge>
        )}
        <span className="flex-1" />
        {isIPad ? (
          <TouchControls tagged={photo.tagged} rating={photo.rating} />
        ) : (
          <span className="hidden items-center gap-1 text-muted-foreground lg:flex">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd> flip · <Kbd>T</Kbd> tag · <Kbd>1–5</Kbd> rate · <Kbd>Esc</Kbd> grid
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              aria-pressed={autoAdvance}
              className={cn("text-muted-foreground", autoAdvance && "bg-(--workspace-photos)/15 text-(--workspace-photos) hover:bg-(--workspace-photos)/25 hover:text-(--workspace-photos)")}
              onClick={() => setAutoAdvance(!autoAdvance)}
            >
              <FastForward data-icon="inline-start" /> Auto-advance
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Go to the next photo after tagging, rating or labeling <Kbd>⇧{mod}A</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              aria-pressed={!!zoom}
              className={cn("tabular-nums text-muted-foreground", zoom && "bg-(--workspace-photos)/15 text-(--workspace-photos) hover:bg-(--workspace-photos)/25 hover:text-(--workspace-photos)")}
              onClick={() => setZoom(zoom ? null : { x: 0.5, y: 0.5 })}
            >
              <ZoomIn data-icon="inline-start" /> {zoom ? "100%" : "Fit"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Zoom to 100% to check focus <Kbd>Z</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

/** iPad has no keyboard, so the loupe's shortcuts become buttons: flip, tag and rate. */
function TouchControls({ tagged, rating }: { tagged: boolean; rating: number }) {
  const { move, cull } = useStore(useShallow((s) => ({ move: s.move, cull: s.cull })))
  return (
    <span className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" static aria-label="Previous photo" onClick={() => move(-1)}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" static aria-label="Next photo" onClick={() => move(1)}>
        <ChevronRight />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        static
        aria-pressed={tagged}
        className={cn(tagged ? "bg-(--workspace-photos) text-black hover:bg-(--workspace-photos)/80 hover:text-black" : "text-muted-foreground")}
        onClick={() => cull(() => ({ tagged: !tagged }))}
      >
        <Check data-icon="inline-start" /> {tagged ? "Tagged" : "Tag"}
      </Button>
      <span className="flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            variant="ghost"
            size="icon-sm"
            static
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => cull(() => ({ rating: n === rating ? 0 : n }))}
          >
            <Star className={cn(n <= rating ? "fill-(--workspace-photos) text-(--workspace-photos)" : "text-muted-foreground/50")} />
          </Button>
        ))}
      </span>
    </span>
  )
}
