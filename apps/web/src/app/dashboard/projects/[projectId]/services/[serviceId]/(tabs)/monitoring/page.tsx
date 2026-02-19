import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import ServiceMonitoringClient from './ServiceMonitoringClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsMonitoring } from '@/routes'
import { tryCatch } from '@/utils/server'
import { orpc } from '@/lib/orpc'

export default DashboardProjectsProjectIdServicesServiceIdTabsMonitoring.Page(
    async function ServiceMonitoringPage({ params }) {
        const { serviceId } = await params
        const queryClient = getQueryClient()

        tryCatch(
            async () => {
                // Prefetch service metrics and health status
                return await Promise.all([
                    queryClient.prefetchQuery(
                        orpc.service.getMetrics.queryOptions({
                            input: {
                                id: serviceId,
                                timeRange: '1h',
                                interval: '5m',
                            },
                        })
                    ),
                    queryClient.prefetchQuery(
                        orpc.service.getHealth.queryOptions({
                            input: { id: serviceId },
                        })
                    ),
                ])
            },
            (error) => {
                console.error('Failed to prefetch monitoring data:', error)
            }
        )

        const dehydratedState = dehydrate(queryClient)

        return (
            <HydrationBoundary state={dehydratedState}>
                <ServiceMonitoringClient />
            </HydrationBoundary>
        )
    }
)
