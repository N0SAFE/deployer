import { Skeleton } from '@repo/ui/components/shadcn/skeleton'

/**
 * Cloudflare provider detail loading state.
 * Shown while the provider page (URL params + provider data) streams in.
 * Mirrors the real page: back link, header, tabs, table.
 */
export default function CloudflareDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-10 w-full max-w-md rounded-lg" />
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}