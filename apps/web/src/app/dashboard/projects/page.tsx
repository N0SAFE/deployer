import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { ProjectsClient } from './ProjectsClient'
import { DashboardProjects } from '@/routes'
import { tryCatch } from '@/utils/server'

export default DashboardProjects.Page(async function ProjectsPage() {
    const pageStart = performance.now()
    const queryClient = getQueryClient()

    // Create server-side ORPC client with authentication cookies
    const clientStart = performance.now()
    const orpc = await createServerORPC()
    const clientTime = performance.now() - clientStart

    // Prefetch projects data on the server
    const prefetchStart = performance.now()
    await tryCatch(
        () => queryClient.prefetchQuery(orpc.project.list.queryOptions()),
        (error) =>
            console.error('❌ [Projects] Failed to prefetch projects:', error)
    )
    const prefetchTime = performance.now() - prefetchStart

    if (process.env.NODE_ENV === 'development') {
        console.log(
            `📋 Projects prefetch completed in ${prefetchTime.toFixed(2)}ms`
        )
    }

    const totalTime = performance.now() - pageStart
    if (process.env.NODE_ENV === 'development') {
        console.log(
            `📄 Projects page server render completed in ${totalTime.toFixed(2)}ms (client: ${clientTime.toFixed(2)}ms)`
        )
    }

    const dehydratedState = dehydrate(queryClient)

    return (
        <HydrationBoundary state={dehydratedState}>
            <ProjectsClient />
        </HydrationBoundary>
    )
})
