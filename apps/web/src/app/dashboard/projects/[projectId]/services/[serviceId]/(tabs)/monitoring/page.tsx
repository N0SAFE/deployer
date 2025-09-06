import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import ServiceMonitoringClient from './ServiceMonitoringClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsMonitoring } from '@/routes'

export default DashboardProjectsProjectIdServicesServiceIdTabsMonitoring.Page(async function ServiceMonitoringPage({ params }) {
  const { serviceId } = await params
  const queryClient = getQueryClient()
  const orpc = await createServerORPC()

  try {
    // Prefetch service metrics and health status
    await Promise.all([
      queryClient.prefetchQuery(
        orpc.service.getMetrics.queryOptions({
          input: { id: serviceId, timeRange: '1h', interval: '5m' },
        })
      ),
      queryClient.prefetchQuery(
        orpc.service.getHealth.queryOptions({
          input: { id: serviceId },
        })
      ),
    ])
  } catch (error) {
    console.error('Failed to prefetch monitoring data:', error)
  }

  const dehydratedState = dehydrate(queryClient)

  return (
    <HydrationBoundary state={dehydratedState}>
      <ServiceMonitoringClient />
    </HydrationBoundary>
  )
})