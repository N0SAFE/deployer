import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { EnvironmentDashboard } from '@/components/environment/EnvironmentDashboard'
import { DashboardEnvironment } from '@/routes'

export default DashboardEnvironment.Page(async function EnvironmentPage({ params }) {
  const { projectId } = await params
  const startTime = Date.now()
  const queryClient = getQueryClient()
  
  console.log('🔄 [Environment] Starting server prefetch...')
  
  // Environment endpoints may not be fully implemented yet
  // This page will still work with client-side hydration
  // but we can add server prefetching later when environment endpoints are ready
  
  const endTime = Date.now()
  console.log(`✅ [Environment] Page loaded in ${endTime - startTime}ms (client-side rendering)`)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <EnvironmentDashboard projectId={projectId} />
    </HydrationBoundary>
  )
})