import { Skeleton } from '@repo/ui/components/shadcn/skeleton'

/**
 * ProjectDetailSkeleton — project-shell-shaped loading state.
 * Mirrors the real layout: back button + header, tab nav, content area.
 * Used as the Suspense fallback (URL data streaming) in the server layout,
 * so it must be a server component (no hooks, no client directives).
 */
export function ProjectDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  )
}