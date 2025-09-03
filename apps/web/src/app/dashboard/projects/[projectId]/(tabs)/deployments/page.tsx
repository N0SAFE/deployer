import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import DeploymentsClient from './DeploymentsClient'

interface PageProps {
    params: Promise<{ projectId: string }>
}

export default async function ProjectDeploymentsPage({ params }: PageProps) {
    const { projectId } = await params
    const queryClient = getQueryClient()
    
    // Data is already prefetched by the parent layout
    // Just dehydrate the existing cache
    const dehydratedState = dehydrate(queryClient)

    return (
        <HydrationBoundary state={dehydratedState}>
            <DeploymentsClient projectId={projectId} />
        </HydrationBoundary>
    )
}