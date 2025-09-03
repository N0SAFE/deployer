import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import OrchestrationDashboard from '@/components/orchestration/OrchestrationDashboard'

export default async function OrchestrationPage() {
  const startTime = Date.now()
  const queryClient = getQueryClient()
  
  // For now, we'll use a default project ID
  // In the future, this could come from user context or URL params
  const projectId = 'default'
  
  try {
    console.log('🔄 [Orchestration] Starting server prefetch...')
    
    // Orchestration endpoints may not be fully implemented yet
    // This page will still work with client-side hydration
    // but we can add server prefetching later when orchestration endpoints are ready
    
    const endTime = Date.now()
    console.log(`✅ [Orchestration] Page loaded in ${endTime - startTime}ms (client-side rendering)`)
    
  } catch (error) {
    const endTime = Date.now()
    console.error(`❌ [Orchestration] Error in ${endTime - startTime}ms:`, error)
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OrchestrationDashboard projectId={projectId} />
    </HydrationBoundary>
  )
}