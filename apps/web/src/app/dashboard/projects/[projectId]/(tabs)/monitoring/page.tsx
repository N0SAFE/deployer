import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import ProjectMonitoringPageClient from './ProjectMonitoringPageClient'
import { DashboardProjectsProjectIdTabsMonitoring } from '@/routes'
import { tryCatch } from '@/utils/server'

export default DashboardProjectsProjectIdTabsMonitoring.Page(
    async function ProjectMonitoringPage({ params }) {
        const { projectId } = await params
        const startTime = Date.now()
        const queryClient = getQueryClient()

        tryCatch(
            async () => {
                console.log(
                    `🔄 [Monitoring-${projectId}] Starting server prefetch...`
                )

                const orpc = await createServerORPC()

                // Prefetch monitoring data in parallel
                await Promise.all([
                    // System resource summary (system-wide, no parameters)
                    queryClient.prefetchQuery(
                        orpc.orchestration.getSystemResourceSummary.queryOptions(
                            {
                                input: void 0,
                            }
                        )
                    ),

                    // Resource alerts (system-wide, no parameters)
                    queryClient.prefetchQuery(
                        orpc.orchestration.getResourceAlerts.queryOptions({
                            input: void 0,
                        })
                    ),

                    // List stacks for the project
                    queryClient.prefetchQuery(
                        orpc.orchestration.listStacks.queryOptions({
                            input: { projectId },
                        })
                    ),
                ])

                const endTime = Date.now()
                console.log(
                    `✅ [Monitoring-${projectId}] Prefetch completed in ${endTime - startTime}ms`
                )
            },
            (error) => {
                const endTime = Date.now()
                console.error(
                    `❌ [Monitoring-${projectId}] Prefetch failed in ${endTime - startTime}ms:`,
                    error
                )
                // Continue with client-side rendering as fallback
            }
        )

        return (
            <HydrationBoundary state={dehydrate(queryClient)}>
                <ProjectMonitoringPageClient />
            </HydrationBoundary>
        )
    }
)
