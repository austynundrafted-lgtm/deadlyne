import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  // Off: quiet text that gives a little when held. On: a raised segment; set a tone on it
  // (tone-photos, tone-codes) to light it in a workspace color. Its size never changes.
  "group/toggle inline-flex items-center justify-center gap-1 rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,border-color,box-shadow] duration-fast outline-none hover:text-foreground not-chosen:hover:bg-surface-hover not-chosen:active:bg-surface-inset not-chosen:active:shadow-pressed disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive chosen:border-cut chosen:bg-control-surface chosen:text-[color:var(--tone,var(--foreground))] chosen:sheen-segment chosen:shadow-raised [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "",
        outline: "",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-md px-2.5 text-control has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
