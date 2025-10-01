import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { DeploymentsClient } from './DeploymentsClient'
import { GlobalDeployments } from '@/routes'
import { tryCatch } from '@/utils/server'
import { orpc } from '@/lib/orpc'

export default GlobalDeployments.Page(async function GlobalDeploymentsPage() {
    const queryClient = getQueryClient()

    // Prefetch projects data for filtering
    await tryCatch(
        () => queryClient.prefetchQuery(orpc.project.list.queryOptions()),
        (error) =>
            console.error(
                '❌ [Deployments] Failed to prefetch projects:',
                error
            )
    )

    // Note: Skip deployment prefetch for now as it requires specific parameters
    // Individual deployment queries will be handled by the client components

    const dehydratedState = dehydrate(queryClient)

    return (
        <HydrationBoundary state={dehydratedState}>
            <DeploymentsClient />
        </HydrationBoundary>
    )
})
