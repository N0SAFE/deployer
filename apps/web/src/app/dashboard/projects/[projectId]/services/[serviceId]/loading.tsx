import { Skeleton } from '@repo/ui/components/shadcn/skeleton'

/**
 * Service detail loading state.
 * Shown while the service shell (URL params + service data) streams in.
 * Mirrors the service layout: breadcrumb + identity header, section nav,
 * content.
 */
export default function ServiceDetailLoading() {
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