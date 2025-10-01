import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import ServiceLogsClient from './ServiceLogsClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsLogs } from '@/routes/index'
import { tryCatch } from '@/utils/server'
import { orpc } from '@/lib/orpc'

export default DashboardProjectsProjectIdServicesServiceIdTabsLogs.Page(async function ServiceLogsPage({ params, searchParams }) {
  const { deploymentId } = (await searchParams) || {}
  const queryClient = getQueryClient()

  if (deploymentId) {
    await tryCatch(
      () => queryClient.prefetchQuery(
        orpc.deployment.getLogs.queryOptions({
          input: { deploymentId, limit: 200, offset: 0 },
        })
      ),
      (error) => console.error('❌ [ServiceLogs] Failed to prefetch deployment logs:', error)
    )
  }

  const dehydratedState = dehydrate(queryClient)

  return (
    <HydrationBoundary state={dehydratedState}>
      <ServiceLogsClient />
    </HydrationBoundary>
  )
})