'use client'

import type { ReactNode } from 'react'
import { PageErrorState } from '@/components/dashboard'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { useIngress } from '@/domains/reachability/hooks'
import type { IngressState } from '@deployer/fleet-contracts/modules/reachability/index'

/** Shape of the Network pages while the ingress snapshot loads: a vitals strip and two cards. */
function NetworkSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Reading the network">
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}

/** Every Network page reads the same `getIngress` snapshot; this renders its loading and error states once. */
export function WithIngress({ children }: { children: (ingress: IngressState, refetch: () => void) => ReactNode }) {
  const { data, isLoading, error, refetch } = useIngress()
  if (isLoading) return <NetworkSkeleton />
  if (error !== null || data === undefined) {
    return (
      <PageErrorState
        title="Could not read the network state"
        message={error?.message ?? 'The node did not answer. Check that the API is running, then retry.'}
        onRetry={() => void refetch()}
      />
    )
  }
  return <>{children(data, () => { void refetch() })}</>
}
