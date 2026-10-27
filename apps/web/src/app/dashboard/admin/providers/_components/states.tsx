'use client'

import { RefreshCw, Siren } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'

/** Skeleton shaped like a provider page: header, one banner, one table/card block. */
export function ProviderPageSkeleton({ label = 'Loading accounts' }: { label?: string }) {
  return (
    <div className="space-y-6" role="status" aria-label={label}>
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

/** A failed query: what failed, why, and a retry. */
export function ProviderLoadError({
  what,
  message,
  onRetry,
  retrying,
}: {
  what: string
  message: string
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <Alert variant="destructive">
      <Siren className="size-4" />
      <AlertTitle>Could not load {what}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{message}</p>
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={`mr-1.5 size-3.5 ${retrying ? 'animate-spin motion-reduce:animate-none' : ''}`} />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  )
}
