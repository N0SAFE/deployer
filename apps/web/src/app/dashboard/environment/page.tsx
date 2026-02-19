import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { EnvironmentDashboard } from '@/components/environment/EnvironmentDashboard'
import { DashboardEnvironment } from '@/routes'

export default DashboardEnvironment.Page(async function EnvironmentPage({ params }) {
  const { projectId } = await params
  const queryClient = getQueryClient()

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <EnvironmentDashboard projectId={projectId} />
    </HydrationBoundary>
  )
})