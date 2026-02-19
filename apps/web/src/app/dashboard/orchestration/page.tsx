import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import OrchestrationDashboard from '@/components/orchestration/OrchestrationDashboard'
import { DashboardOrchestration } from '@/routes'

export default DashboardOrchestration.Page(async function OrchestrationPage({ params }) {
  const { projectId } = await params
  const queryClient = getQueryClient()

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OrchestrationDashboard projectId={projectId} />
    </HydrationBoundary>
  )
})