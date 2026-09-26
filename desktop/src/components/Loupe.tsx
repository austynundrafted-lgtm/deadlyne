// Full-size preview over the grid. Shows the thumbnail instantly, swaps in the full embedded
// JPEG when it's decoded, and pre-loads the neighbours so flipping is instant.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Check, Star, X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { previewUrl, thumbUrl } from "@/lib/api"
import { labelColor, mod, orientationTransform } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore, useVisiblePhotos } from "@/store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"

export function Loupe() {
  const { focus, setLoupe } = useStore(useShallow((s) => ({ focus: s.focus, setLoupe: s.setLoupe })))
  const list = useVisiblePhotos()
  const index = list.findIndex((p) => p.id === focus)
  const photo = list[index]

  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    // Fit inside the padding, like the thumbnail shown first, so the photo doesn't jump when the preview lands.
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(el)
      setBox({
        w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
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

  // Fit the (possibly rotated) image inside the box.
  let style: React.CSSProperties = { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }
  if (showingFull && box.w > 0) {
    const [dw, dh] = swapsAxes ? [full.h, full.w] : [full.w, full.h]
    const scale = Math.min(box.w / dw, box.h / dh)
    style = {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: full.w * scale,
      height: full.h * scale,
      transform: `translate(-50%, -50%)${transform === "none" ? "" : ` ${transform}`}`,
      imageOrientation: "none",
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center p-3" onDoubleClick={() => setLoupe(false)}>
        <img
          key={showingFull ? "full" : "thumb"}
          src={showingFull ? previewUrl(photo) : thumbUrl(photo)}
          alt={photo.name}
          draggable={false}
          style={style}
          className={cn(showingFull ? "outline -outline-offset-1 outline-white/10" : "size-full")}
        />
        <Button
          variant="secondary"
          size="icon-sm"
          className="absolute top-3 right-3 opacity-70 hover:opacity-100"
          aria-label="Back to the grid"
          onClick={() => setLoupe(false)}
        >
          <X />
        </Button>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-3 border-t bg-bar px-3 text-xs">
        <span className="font-medium">{photo.name}</span>
        <span className="text-muted-foreground tabular-nums">
          {index + 1} / {list.length.toLocaleString()}
        </span>
        {photo.tagged && (
          <Badge className="bg-(--workspace-photos) text-black">
            <Check /> Tagged
          </Badge>
        )}
        {photo.rating > 0 && (
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
        <span className="hidden items-center gap-1 text-muted-foreground md:flex">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> flip · <Kbd>T</Kbd> tag · <Kbd>1–5</Kbd> rate · <Kbd>Esc</Kbd> grid
        </span>
        <span className="sr-only">{mod}</span>
      </div>
    </div>
  )
}
