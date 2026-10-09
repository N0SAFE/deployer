import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "@repo/ui/lib/utils"

/**
 * Accessible spinner. Announces `label` to assistive tech (`role="status"`) and
 * renders the glyph as decorative. Keeps rotating under prefers-reduced-motion
 * (slowed globally) because it is the signal that work is in progress.
 */
function Spinner({
  className,
  label = "Loading",
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & { label?: string }) {
  return (
    <span
      data-slot="spinner"
      role="status"
      className={cn("inline-flex shrink-0 items-center", className)}
      {...props}
    >
      <Loader2Icon aria-hidden="true" className="size-[1em] animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export { Spinner }
