"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "lucide-react"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // The box keeps the high-contrast input boundary: nothing else marks an empty checkbox.
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-mark border border-input bg-well bg-clip-padding shadow-[inset_0_1px_1px_var(--well-shade)] transition-[background-color,border-color,box-shadow] duration-fast outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-checked:border-[color-mix(in_oklab,var(--primary)_58%,black)] data-checked:bg-primary data-checked:text-primary-foreground data-checked:sheen-cap data-checked:shadow-cap",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
