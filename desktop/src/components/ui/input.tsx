import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      autoComplete="off"
      autoCorrect="off"
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-cut bg-well px-2.5 py-1 text-base shadow-field transition-[border-color,box-shadow,background-color] duration-fast outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:shadow-field-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive/70 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
