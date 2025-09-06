import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import OrchestrationDashboard from '@/components/orchestration/OrchestrationDashboard'
import { DashboardProjectsProjectIdTabsOrchestration } from '@/routes'

export default DashboardProjectsProjectIdTabsOrchestration.Page(async function ProjectOrchestrationPage({ params }) {
  const { projectId } = await params
  const startTime = Date.now()
  const queryClient = getQueryClient()
  
  try {
    console.log(`🔄 [Orchestration-${projectId}] Starting server prefetch...`)
    
    const orpc = await createServerORPC()
    
    // Prefetch orchestration data in parallel
    await Promise.all([
      // List stacks for the project (used by StackList)
      queryClient.prefetchQuery(orpc.orchestration.listStacks.queryOptions({
        input: { projectId }
      })),
      
      // System resource summary (used by ResourceMonitoringDashboard)
      queryClient.prefetchQuery(orpc.orchestration.getSystemResourceSummary.queryOptions({
        input: void 0
      })),
      
      // Resource alerts (used by ResourceMonitoringDashboard)
      queryClient.prefetchQuery(orpc.orchestration.getResourceAlerts.queryOptions({
        input: void 0
      }))
    ])
    
    const endTime = Date.now()
    console.log(`✅ [Orchestration-${projectId}] Prefetch completed in ${endTime - startTime}ms`)
    
  } catch (error) {
    const endTime = Date.now()
    console.error(`❌ [Orchestration-${projectId}] Prefetch failed in ${endTime - startTime}ms:`, error)
    // Continue with client-side rendering as fallback
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OrchestrationDashboard projectId={projectId} />
    </HydrationBoundary>
  )
})
