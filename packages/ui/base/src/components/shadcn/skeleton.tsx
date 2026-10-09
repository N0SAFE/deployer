import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@repo/ui/lib/utils"

const skeletonVariants = cva("animate-pulse bg-muted", {
  variants: {
    variant: {
      default: "rounded-md",
      /** One line of body text. */
      text: "h-4 w-full rounded",
      /** A table/list row. */
      row: "h-10 w-full rounded-md",
      /** A card-sized block. */
      card: "h-32 w-full rounded-xl",
      circle: "size-8 rounded-full",
    },
  },
  defaultVariants: { variant: "default" },
})

function Skeleton({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof skeletonVariants>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(skeletonVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Skeleton, skeletonVariants }
