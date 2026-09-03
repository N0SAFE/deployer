import { Skeleton } from '@repo/ui/components/shadcn/skeleton'

/**
 * ServiceDetailSkeleton — service-shell-shaped loading state.
 * Mirrors the real layout: breadcrumb + identity header, section nav,
 * content area. Used as the Suspense fallback (URL data streaming) in the
 * server layout, so it must be a server component (no hooks, no client
 * directives).
 */
export function ServiceDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-9 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  )
}