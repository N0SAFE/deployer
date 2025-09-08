import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import ActivityFeed from '@/components/activity/ActivityFeed'
import { DashboardProjectsProjectIdTabsActivity } from '@/routes'
import { tryCatch } from '@/utils/server'

export default DashboardProjectsProjectIdTabsActivity.Page(
    async function ProjectActivityPage({ params }) {
        const { projectId } = await params
        const startTime = Date.now()
        const queryClient = getQueryClient()

        console.log(`🔄 [Activity-${projectId}] Starting server prefetch...`)

        const orpc = await createServerORPC()

        await tryCatch(
            () =>
                queryClient.prefetchQuery(
                    orpc.analytics.getUserActivity.queryOptions({
                        input: {
                            resource: `project:${projectId}`, // Filter by project resource
                            timeRange: '7d',
                            limit: 10,
                            offset: 0,
                        },
                    })
                ),
            (error) => {
                const endTime = Date.now()
                console.error(
                    `❌ [Activity-${projectId}] Prefetch failed in ${endTime - startTime}ms:`,
                    error
                )
            }
        )

        const endTime = Date.now()
        console.log(
            `✅ [Activity-${projectId}] Server render completed in ${endTime - startTime}ms`
        )

        return (
            <HydrationBoundary state={dehydrate(queryClient)}>
                <ActivityFeed projectId={projectId} />
            </HydrationBoundary>
        )
    }
)
