import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import OrchestrationDashboard from '@/components/orchestration/OrchestrationDashboard'
import { DashboardOrchestration } from '@/routes'

export default DashboardOrchestration.Page(async function OrchestrationPage({ params }) {
  const { projectId } = await params
  const startTime = Date.now()
  const queryClient = getQueryClient()
  
  console.log('🔄 [Orchestration] Starting server prefetch...')
  
  // Orchestration endpoints may not be fully implemented yet
  // This page will still work with client-side hydration
  // but we can add server prefetching later when orchestration endpoints are ready
  
  const endTime = Date.now()
  console.log(`✅ [Orchestration] Page loaded in ${endTime - startTime}ms (client-side rendering)`)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OrchestrationDashboard projectId={projectId} />
    </HydrationBoundary>
  )
})