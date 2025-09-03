import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { DeploymentsClient } from './DeploymentsClient'

export default async function GlobalDeploymentsPage() {
  const queryClient = getQueryClient()
  
  // Create server-side ORPC client with authentication cookies
  const orpc = await createServerORPC()
  
  try {
    // Prefetch projects data for filtering
    await queryClient.prefetchQuery(orpc.project.list.queryOptions())
    
    // Note: Skip deployment prefetch for now as it requires specific parameters
    // Individual deployment queries will be handled by the client components
  } catch (error) {
    // If prefetching fails, let the client handle it
    console.error('Failed to prefetch deployments data:', error)
  }

  const dehydratedState = dehydrate(queryClient)

  return (
    <HydrationBoundary state={dehydratedState}>
      <DeploymentsClient />
    </HydrationBoundary>
  )
}