// Deadlyne's folder: a warm charcoal folder with a tab, a couple of prints tucked inside and a
// front flap that lifts a little on hover and opens wider when something is dragged onto it.
// Selected folders take the brand orange on the flap only. Drawn in SVG so it stays crisp from
// list rows (20 px) to grid cards.
import { useId } from "react"
import { cn } from "@/lib/utils"

export type FolderState = { selected?: boolean; dropTarget?: boolean; dragging?: boolean; missing?: boolean }

interface Props extends FolderState {
  /** A collection reads as a stack of folders. */
  kind?: "folder" | "collection"
  /** Width in px; height follows the 5:4 shape. */
  size?: number
  className?: string
}

export function FolderIcon({ kind = "folder", size = 72, selected, dropTarget, dragging, missing, className }: Props) {
  const id = useId().replace(/:/g, "")
  const detailed = size >= 40
  const open = dropTarget ? "folder-open-wide" : ""
  return (
    <svg
      viewBox="0 0 80 64"
      width={size}
      height={(size * 64) / 80}
      aria-hidden
      className={cn(
        "group/folder shrink-0 overflow-visible transition-[opacity,filter] duration-200",
        dragging && "opacity-40",
        missing && "opacity-55 grayscale",
        className,
      )}
    >
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a3f36" />
          <stop offset="1" stopColor="#2e2723" />
        </linearGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6e5e51" />
          <stop offset="0.55" stopColor="#54473d" />
          <stop offset="1" stopColor="#40362f" />
        </linearGradient>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7240" />
          <stop offset="0.6" stopColor="#ff4d12" />
          <stop offset="1" stopColor="#d93a06" />
        </linearGradient>
        <linearGradient id={`${id}p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8e2dc" />
          <stop offset="1" stopColor="#b8b0a8" />
        </linearGradient>
        {detailed && (
          <filter id={`${id}s`} x="-20%" y="-20%" width="140%" height="160%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        )}
      </defs>

      {/* Soft contact shadow */}
      {detailed && <ellipse cx="40" cy="60" rx="30" ry="2.6" fill="#000" opacity="0.55" filter={`url(#${id}s)`} />}

      {/* A second folder peeking out behind: collections */}
      {kind === "collection" && (
        <path
          d="M12 6.5a3.5 3.5 0 0 1 3.5-3.5h14c1.6 0 2.5.5 3.5 1.5l2.6 2.6c1 1 1.9 1.4 3.4 1.4h25.5a3.5 3.5 0 0 1 3.5 3.5V40H12Z"
          fill="#2f2924"
          opacity="0.9"
        />
      )}

      {/* Back panel with its tab */}
      <path
        d="M6 11a4 4 0 0 1 4-4h17.2c1.9 0 3 .6 4.2 1.8l3.4 3.4c1.2 1.2 2.3 1.8 4.2 1.8H70a4 4 0 0 1 4 4V54a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4Z"
        fill={missing ? "none" : `url(#${id}b)`}
        stroke={missing ? "#6b625b" : "none"}
        strokeDasharray={missing ? "3 2.5" : undefined}
      />
      {!missing && <path d="M10 7.6h17.2" stroke="#fff" strokeOpacity="0.1" strokeWidth="0.8" />}

      {/* Prints tucked inside */}
      {detailed && !missing && (
        <g className="transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] group-hover/card:-translate-y-0.5 motion-reduce:transition-none">
          <rect x="15" y="15" width="44" height="30" rx="1.6" fill="#6f665e" transform="rotate(-4 37 30)" />
          <rect x="20" y="14.5" width="44" height="30" rx="1.6" fill={`url(#${id}p)`} transform="rotate(3 42 29)" />
          <rect x="23" y="17.5" width="38" height="20" rx="0.8" fill="#2a2522" opacity="0.85" transform="rotate(3 42 29)" />
        </g>
      )}

      {/* Front flap: lifts on hover, opens wider as a drop target */}
      {!missing && (
        <g
          className={cn(
            "origin-bottom transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] [transform-box:fill-box] motion-reduce:transition-none",
            "group-hover/card:[transform:skewX(-3deg)_scaleY(0.97)]",
            open && "[transform:skewX(-7deg)_scaleY(0.9)] group-hover/card:[transform:skewX(-7deg)_scaleY(0.9)]",
          )}
        >
          <path d="M4 25a4 4 0 0 1 4-4h64a4 4 0 0 1 4 4l-1.6 29.2A4 4 0 0 1 70.4 58H9.6a4 4 0 0 1-4-3.8Z" fill={`url(#${id}f)`} />
          <path
            d="M4 25a4 4 0 0 1 4-4h64a4 4 0 0 1 4 4l-1.6 29.2A4 4 0 0 1 70.4 58H9.6a4 4 0 0 1-4-3.8Z"
            fill={`url(#${id}a)`}
            className={cn("transition-opacity duration-200", selected || dropTarget ? "opacity-100" : "opacity-0")}
          />
          {/* Lit top edge and a faint fold line */}
          <path d="M8.2 21.7H71.8" stroke="#fff" strokeOpacity={selected || dropTarget ? 0.42 : 0.2} strokeWidth="0.9" strokeLinecap="round" />
          {detailed && <path d="M9 51.5H71" stroke="#000" strokeOpacity="0.18" strokeWidth="0.8" />}
        </g>
      )}
    </svg>
  )
}
