import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import OrchestrationDashboard from '@/components/orchestration/OrchestrationDashboard'
import { DashboardProjectsProjectIdTabsOrchestration } from '@/routes'
import { tryCatchAll } from '@/utils/server'
import { orpc } from '@/lib/orpc'

export default DashboardProjectsProjectIdTabsOrchestration.Page(
    async function ProjectOrchestrationPage({ params }) {
        const { projectId } = await params
        const startTime = Date.now()
        const queryClient = getQueryClient()

        console.log(
            `🔄 [Orchestration-${projectId}] Starting server prefetch...`
        )

        // Prefetch orchestration data in parallel using tryCatchAll
        await tryCatchAll(
            [
                // List stacks for the project (used by StackList)
                () =>
                    queryClient.prefetchQuery(
                        orpc.orchestration.listStacks.queryOptions({
                            input: { projectId },
                        })
                    ),

                // System resource summary (used by ResourceMonitoringDashboard)
                () =>
                    queryClient.prefetchQuery(
                        orpc.orchestration.getSystemResourceSummary.queryOptions(
                            {
                                input: void 0,
                            }
                        )
                    ),

                // Resource alerts (used by ResourceMonitoringDashboard)
                () =>
                    queryClient.prefetchQuery(
                        orpc.orchestration.getResourceAlerts.queryOptions({
                            input: void 0,
                        })
                    ),
            ],
            (error, index) => {
                const operations = [
                    'stacks',
                    'system resources',
                    'resource alerts',
                ]
                console.error(
                    `❌ [Orchestration-${projectId}] Failed to prefetch ${operations[index]}:`,
                    error
                )
            }
        )

        const endTime = Date.now()
        console.log(
            `✅ [Orchestration-${projectId}] Server render completed in ${endTime - startTime}ms`
        )

        return (
            <HydrationBoundary state={dehydrate(queryClient)}>
                <OrchestrationDashboard projectId={projectId} />
            </HydrationBoundary>
        )
    }
)
