import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import DashboardClient from './DashboardClient'
import getQueryClient from '@/lib/getQueryClient'
import { Dashboard } from '@/routes'
import { tryCatchAll } from '@/utils/server'
import { orpc } from '@/lib/orpc'

export default Dashboard.Page(async function DashboardPage() {
    const queryClient = getQueryClient()

    // Prefetch all required data using tryCatchAll for parallel operations
    await tryCatchAll(
        [
            () => queryClient.prefetchQuery(orpc.project.list.queryOptions({ input: {} })),
            () =>
                queryClient.prefetchQuery(
                    orpc.health.check.queryOptions({ input: {} })
                ),
            () =>
                queryClient.prefetchQuery(
                    orpc.health.detailed.queryOptions({ input: {} })
                ),
        ],
        (error, index) => {
            const operations = ['projects', 'health check', 'detailed health']
            console.error(
                `❌ [Dashboard] Failed to prefetch ${operations[index]}:`,
                error
            )
        }
    )

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <DashboardClient />
        </HydrationBoundary>
    )
})
