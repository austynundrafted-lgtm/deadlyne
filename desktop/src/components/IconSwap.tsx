// Cross-fades between state icons (sending → sent, testing → ok) instead of snapping.
// Every icon stays mounted, so both the entering and the leaving one animate; the first
// sets the size and the rest sit on top of it.
import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/utils"

const SWAP = "flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
const SHOWN = "scale-100 opacity-100 blur-[0px]"
const HIDDEN = "scale-[0.25] opacity-0 blur-[4px]"

export function IconSwap<K extends string>({
  current,
  icons,
  className,
  ...props
}: { current: K; icons: Record<K, ReactNode> } & Omit<ComponentProps<"span">, "children">) {
  const keys = Object.keys(icons) as K[]
  return (
    <span className={cn("relative inline-flex shrink-0", className)} {...props}>
      {keys.map((k, i) => (
        <span key={k} aria-hidden={k !== current} className={cn(SWAP, i > 0 && "absolute inset-0", k === current ? SHOWN : HIDDEN)}>
          {icons[k]}
        </span>
      ))}
    </span>
  )
}
