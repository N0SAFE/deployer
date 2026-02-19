import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { CICDDashboard } from '@/components/cicd/CICDDashboard'
import { DashboardCicd } from '@/routes/index'
import { tryCatch } from '@/utils/server'
import { orpc } from '@/lib/orpc'

export default DashboardCicd.Page(async function CICDPage({ params }) {
    const { projectId } = await params
    const queryClient = getQueryClient()

    // Prefetch CI/CD data in parallel using tryCatch for better error handling
    await Promise.all([
        // List pipelines for the project
        tryCatch(
            () =>
                queryClient.prefetchQuery(
                    orpc.ciCd.pipeline.listPipelines.queryOptions({
                        input: { projectId },
                    })
                ),
            (error) =>
                console.error('❌ [CICD] Failed to prefetch pipelines:', error)
        ),

        // List recent builds/runs
        tryCatch(
            () =>
                queryClient.prefetchQuery(
                    orpc.ciCd.build.listBuilds.queryOptions({
                        input: { limit: 20 },
                    })
                ),
            (error) =>
                console.error('❌ [CICD] Failed to prefetch builds:', error)
        ),

        // List webhooks for the project
        tryCatch(
            () =>
                queryClient.prefetchQuery(
                    orpc.ciCd.webhook.listWebhooks.queryOptions({
                        input: { limit: 10 },
                    })
                ),
            (error) =>
                console.error('❌ [CICD] Failed to prefetch webhooks:', error)
        ),
    ])

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <CICDDashboard projectId={projectId} />
        </HydrationBoundary>
    )
})
