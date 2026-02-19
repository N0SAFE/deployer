import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import ServiceDeploymentsClient from './ServiceDeploymentsClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsDeployments } from '@/routes'
import { tryCatch } from '@/utils/server'
import { orpc } from '@/lib/orpc'

export default DashboardProjectsProjectIdServicesServiceIdTabsDeployments.Page(
    async function ServiceDeploymentsPage({ params }) {
        const { serviceId } = await params
        const queryClient = getQueryClient()

        tryCatch(
            async () => {
                await queryClient.prefetchQuery(
                    orpc.deployment.list.queryOptions({
                        input: { serviceId, limit: 50 },
                    })
                )
            },
            (error) => {
                console.error('Failed to prefetch deployments:', error)
            }
        )

        const dehydratedState = dehydrate(queryClient)

        return (
            <HydrationBoundary state={dehydratedState}>
                <ServiceDeploymentsClient />
            </HydrationBoundary>
        )
    }
)
