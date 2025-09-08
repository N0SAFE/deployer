import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import ServiceListClient from './ServiceListClient'
import { DashboardProjectsProjectIdTabsServices } from '@/routes'
import { tryCatch } from '@/utils/server'

export default DashboardProjectsProjectIdTabsServices.Page(
    async function ProjectServicesPage({ params }) {
        const { projectId } = await params
        const queryClient = getQueryClient()

        // Create server-side ORPC client with authentication cookies
        const orpc = await createServerORPC()

        // Prefetch services data for this project
        await tryCatch(
            () =>
                queryClient.prefetchQuery(
                    orpc.service.listByProject.queryOptions({
                        input: {
                            projectId,
                            limit: 50,
                        },
                    })
                ),
            (error) =>
                console.error(
                    `❌ [Services-${projectId}] Failed to prefetch services:`,
                    error
                )
        )

        const dehydratedState = dehydrate(queryClient)

        return (
            <HydrationBoundary state={dehydratedState}>
                <ServiceListClient projectId={projectId} />
            </HydrationBoundary>
        )
    }
)
