import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 shrink-0 items-center justify-center gap-1 rounded-sm bg-control-surface px-1 font-sans text-xs font-medium whitespace-nowrap text-muted-foreground shadow-[inset_0_1px_0_var(--edge-light),0_0_0_1px_var(--edge-cut)] select-none in-data-[slot=tooltip-content]:bg-background/40 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
