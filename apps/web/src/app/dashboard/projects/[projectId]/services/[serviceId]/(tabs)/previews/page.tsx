import getQueryClient from '@/lib/getQueryClient'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { ServicePreviewsClient } from './ServicePreviewsClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsPreviews } from '@/routes'
import { tryCatch } from '@/utils/server'
import { orpc } from '@/lib/orpc'

export default DashboardProjectsProjectIdServicesServiceIdTabsPreviews.Page(
    async function ServicePreviewDeploymentsPage({ params }) {
        const { projectId } = await params

        const queryClient = getQueryClient()

        tryCatch(
            async () => {
                // Prefetch preview environments data
                await queryClient.prefetchQuery(
                    orpc.environment.listPreviewEnvironments.queryOptions({
                        input: { projectId },
                    })
                )
            },
            (error) => {
                console.error('Failed to prefetch preview environments:', error)
            }
        )

        return (
            <HydrationBoundary state={dehydrate(queryClient)}>
                <ServicePreviewsClient projectId={projectId} />
            </HydrationBoundary>
        )
    }
)
