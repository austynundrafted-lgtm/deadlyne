import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// A raised control: a hairline cut into the surface around it, light along its upper edge and a
// short contact shadow. Held down, or holding its menu open, it sinks instead of shrinking, so
// nothing beside it moves. Keyboard focus is the shared ring in index.css.
const RAISED = "border-cut sheen-raised shadow-raised aria-expanded:sheen-pressed aria-expanded:shadow-pressed"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity] duration-fast ease-out outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-[color-mix(in_oklab,var(--primary)_58%,black)] bg-primary text-primary-foreground sheen-cap shadow-cap hover:bg-primary-hover aria-expanded:sheen-pressed aria-expanded:shadow-pressed",
        outline: cn(RAISED, "bg-control-surface text-foreground hover:bg-control-surface-hover aria-expanded:bg-control-surface"),
        secondary: cn(RAISED, "bg-secondary text-secondary-foreground hover:bg-secondary-hover aria-expanded:bg-secondary"),
        ghost:
          "hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-inset aria-expanded:text-foreground aria-expanded:shadow-pressed",
        destructive: cn(RAISED, "border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/25 aria-expanded:bg-destructive/15"),
        link: "text-primary-readable underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-control in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
      press: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      // The pressed face: darker toward the top, shaded inside, no contact shadow.
      { press: true, variant: ["default", "outline", "secondary", "destructive"], className: "active:not-disabled:sheen-pressed active:not-disabled:shadow-pressed" },
      { press: true, variant: "ghost", className: "active:not-disabled:bg-surface-inset active:not-disabled:shadow-pressed" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
      press: true,
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  static: isStatic = false,
  ...props
}: React.ComponentProps<"button"> &
  Omit<VariantProps<typeof buttonVariants>, "press"> & {
    asChild?: boolean
    /** No pressed face, for controls hit over and over where the flicker would distract. */
    static?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, press: !isStatic, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
