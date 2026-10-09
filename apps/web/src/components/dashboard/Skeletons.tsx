import { cn } from '@/lib/utils'

/** Base pulse block. Honours reduced motion. */
function Bone({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none', className)} />
}

/**
 * PageSkeleton — the silhouette of a dashboard page: header, vitals strip, then
 * content blocks. Use it as the loading state of a whole page instead of a bare
 * spinner. Pure markup (safe in Suspense fallbacks and server components).
 */
export function PageSkeleton({
  blocks = 2,
  withStrip = true,
  label = 'Loading…',
  className,
}: {
  /** Number of content cards under the header. */
  blocks?: number
  /** Render the vitals strip placeholder. */
  withStrip?: boolean
  /** Announced to assistive tech. */
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={cn('space-y-6', className)}>
      <div className="space-y-2">
        <Bone className="h-3 w-24" />
        <Bone className="h-7 w-64 max-w-full" />
        <Bone className="h-4 w-96 max-w-full" />
      </div>
      {withStrip ? (
        <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-xl border border-border/60 px-4 py-3">
          {[0, 1, 2, 3].map((i) => (
            <Bone key={i} className="h-5 w-28" />
          ))}
        </div>
      ) : null}
      {Array.from({ length: blocks }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border/60 p-4">
          <Bone className="h-4 w-40" />
          <Bone className="h-24 w-full" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}

/**
 * TableSkeleton — header row plus `rows` body rows, for lists and tables that
 * load inside an already-rendered card (so the page chrome does not jump).
 */
export function TableSkeleton({
  rows = 6,
  columns = 4,
  label = 'Loading rows…',
  className,
}: {
  rows?: number
  columns?: number
  label?: string
  className?: string
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={cn('w-full space-y-2', className)}>
      <div className="flex gap-4 border-b border-border/60 pb-2">
        {Array.from({ length: columns }, (_, c) => (
          <Bone key={c} className={cn('h-3', c === 0 ? 'w-1/3' : 'w-1/6')} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 py-1.5">
          {Array.from({ length: columns }, (_, c) => (
            <Bone key={c} className={cn('h-4', c === 0 ? 'w-1/3' : 'w-1/6')} />
          ))}
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  )
}
