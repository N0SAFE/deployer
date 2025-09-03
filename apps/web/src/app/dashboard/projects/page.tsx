import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { ProjectsClient } from './ProjectsClient'

export default async function ProjectsPage() {
  const pageStart = performance.now();
  const queryClient = getQueryClient()
  
  // Create server-side ORPC client with authentication cookies
  const clientStart = performance.now();
  const orpc = await createServerORPC()
  const clientTime = performance.now() - clientStart;
  
  try {
    // Prefetch projects data on the server
    const prefetchStart = performance.now();
    await queryClient.prefetchQuery(orpc.project.list.queryOptions())
    const prefetchTime = performance.now() - prefetchStart;
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`📋 Projects prefetch completed in ${prefetchTime.toFixed(2)}ms`);
    }
  } catch (error) {
    // If prefetching fails, let the client handle it
    console.error('Failed to prefetch projects:', error)
  }

  const totalTime = performance.now() - pageStart;
  if (process.env.NODE_ENV === 'development') {
    console.log(`📄 Projects page server render completed in ${totalTime.toFixed(2)}ms (client: ${clientTime.toFixed(2)}ms)`);
  }

  const dehydratedState = dehydrate(queryClient)

  return (
    <HydrationBoundary state={dehydratedState}>
      <ProjectsClient />
    </HydrationBoundary>
  )
}