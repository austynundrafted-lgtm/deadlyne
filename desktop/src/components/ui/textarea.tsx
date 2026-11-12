import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      autoComplete="off"
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-cut bg-well px-2.5 py-2 text-base shadow-field transition-[border-color,box-shadow,background-color] duration-fast outline-none placeholder:text-muted-foreground focus-visible:shadow-field-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive/70 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
