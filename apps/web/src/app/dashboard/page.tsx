import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import DashboardClient from './DashboardClient'
import getQueryClient from '@/lib/getQueryClient'

export default async function DashboardPage() {
  const startTime = Date.now()
  const queryClient = getQueryClient()
  
  try {
    console.log('🔄 [Dashboard] Starting server prefetch...')
    
    const orpc = await createServerORPC()
    
    // Prefetch all required data in parallel
    await Promise.all([
      // Prefetch projects
      queryClient.prefetchQuery(orpc.project.list.queryOptions()),
      
      // Prefetch health check (basic)
      queryClient.prefetchQuery(orpc.health.check.queryOptions({
        input: {}
      })),
      
      // Prefetch detailed health data
      queryClient.prefetchQuery(orpc.health.detailed.queryOptions({
        input: {}
      }))
    ])
    
    const endTime = Date.now()
    console.log(`✅ [Dashboard] Prefetch completed in ${endTime - startTime}ms`)
    
  } catch (error) {
    const endTime = Date.now()
    console.error(`❌ [Dashboard] Prefetch failed in ${endTime - startTime}ms:`, error)
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardClient />
    </HydrationBoundary>
  )
}