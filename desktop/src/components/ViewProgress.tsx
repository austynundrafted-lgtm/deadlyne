// How much of a shoot has been reviewed: a row of narrow segments that fill from a deep ember to
// the brand orange, with the percentage beside it. Viewed is its own measure: never mixed with
// tags, ratings or captions.
import { cn } from "@/lib/utils"

type Size = "xs" | "sm" | "md"

const DIMS: Record<Size, { segments: number; w: number; h: number; gap: number; text: string }> = {
  xs: { segments: 12, w: 2, h: 8, gap: 1.5, text: "text-[10px]" },
  sm: { segments: 20, w: 2.5, h: 10, gap: 1.5, text: "text-[11px]" },
  md: { segments: 24, w: 3, h: 14, gap: 2, text: "text-xs" },
}

/** The color of segment `t` (0 first, 1 last): ember at the start, brand orange at the end. */
const ramp = (t: number) => `color-mix(in oklch, var(--primary) ${Math.round(48 + t * 52)}%, #5c2416)`

interface Props {
  viewed: number
  total: number
  size?: Size
  /** Show the percentage beside the segments. */
  label?: boolean
  className?: string
}

export function percentViewed(viewed: number, total: number) {
  // Floor, so 1,999 of 2,000 reads 99% and 100% means truly done.
  return total ? Math.floor((viewed / total) * 100) : 0
}

export function viewedSummary(viewed: number, total: number) {
  if (!total) return "No photos yet"
  return `${viewed.toLocaleString()} of ${total.toLocaleString()} photo${total === 1 ? "" : "s"} viewed`
}

export function ViewProgress({ viewed, total, size = "sm", label = true, className }: Props) {
  const d = DIMS[size]
  const ratio = total ? Math.min(1, viewed / total) : 0
  const filled = ratio * d.segments
  const pct = percentViewed(viewed, total)
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Photos viewed"
      aria-valuetext={viewedSummary(viewed, total)}
      title={viewedSummary(viewed, total)}
      className={cn("inline-flex shrink-0 items-center", size === "xs" ? "gap-1.5" : "gap-2", className)}
    >
      <span className="flex items-center" style={{ gap: d.gap }}>
        {Array.from({ length: d.segments }, (_, i) => {
          const f = Math.min(1, Math.max(0, filled - i))
          return (
            <span
              key={i}
              className="rounded-[1px] transition-[background-color,opacity] duration-300 ease-out motion-reduce:transition-none"
              style={{
                width: d.w,
                height: d.h,
                background: f > 0 ? ramp(d.segments > 1 ? i / (d.segments - 1) : 1) : "oklch(1 0 0 / 0.1)",
                // The leading segment fills partway, so small steps still show.
                opacity: f > 0 ? 0.4 + 0.6 * f : 1,
                transitionDelay: `${i * 10}ms`,
              }}
            />
          )
        })}
      </span>
      {label && (
        <span className={cn("min-w-[3ch] text-right font-medium tabular-nums", d.text, pct === 100 ? "text-foreground" : "text-muted-foreground")}>
          {/* A started review never reads 0%. */}
          {!total ? "–" : viewed > 0 && pct === 0 ? "<1%" : `${pct}%`}
        </span>
      )}
    </span>
  )
}
