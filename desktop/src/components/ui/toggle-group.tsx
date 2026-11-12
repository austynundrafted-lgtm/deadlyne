"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 0.5,
  orientation: "horizontal",
})

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 0.5,
  orientation = "horizontal",
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ "--gap": spacing } as React.CSSProperties}
      className={cn(
        // A track cut into the surface, as tall as a button of the same size: the segments sit inside it.
        "group/toggle-group flex h-8 w-fit flex-row items-stretch gap-[calc(var(--spacing)*var(--gap))] rounded-lg bg-well p-0.5 shadow-well data-[size=lg]:h-9 data-[size=sm]:h-7 data-[size=sm]:rounded-md data-vertical:h-auto data-vertical:flex-col",
        className
      )}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        // Inside the track a segment fills its height; its corners follow the track's (radius minus the 2px inset).
        // It can still be hit across the track's full height, as before the track existed.
        "relative h-auto min-w-0 shrink-0 rounded-md group-data-[size=sm]/toggle-group:rounded-sm after:absolute after:inset-x-0 after:-inset-y-0.5 focus:z-10 focus-visible:z-10",
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
