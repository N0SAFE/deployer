import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import DashboardClient from './DashboardClient'
import getQueryClient from '@/lib/getQueryClient'
import { Dashboard } from '@/routes'
import { tryCatchAll } from '@/utils/server'

export default Dashboard.Page(async function DashboardPage() {
    const startTime = Date.now()
    const queryClient = getQueryClient()

    console.log('🔄 [Dashboard] Starting server prefetch...')

    const orpc = await createServerORPC()

    // Prefetch all required data using tryCatchAll for parallel operations
    await tryCatchAll(
        [
            () => queryClient.prefetchQuery(orpc.project.list.queryOptions()),
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

    const endTime = Date.now()
    console.log(
        `✅ [Dashboard] Server render completed in ${endTime - startTime}ms`
    )

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <DashboardClient />
        </HydrationBoundary>
    )
})
