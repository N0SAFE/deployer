import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import ServiceListClient from './ServiceListClient'

interface PageProps {
    params: Promise<{ projectId: string }>
}

export default async function ProjectServicesPage({ params }: PageProps) {
    const { projectId } = await params
    const queryClient = getQueryClient()
    
    // Create server-side ORPC client with authentication cookies
    const orpc = await createServerORPC()

    try {
        // Prefetch services data for this project
        await queryClient.prefetchQuery(orpc.service.listByProject.queryOptions({
            input: {
                projectId,
                limit: 50
            }
        }))
    } catch (error) {
        // If prefetching fails, let the client handle it
        console.error('Failed to prefetch services:', error)
    }

    const dehydratedState = dehydrate(queryClient)

    return (
        <HydrationBoundary state={dehydratedState}>
            <ServiceListClient projectId={projectId} />
        </HydrationBoundary>
    )
}
