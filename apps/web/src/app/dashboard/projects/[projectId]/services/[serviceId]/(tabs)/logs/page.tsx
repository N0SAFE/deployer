import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import ServiceLogsClient from './ServiceLogsClient'

interface PageProps {
  params: Promise<{ projectId: string; serviceId: string }>
  searchParams?: Promise<{ deploymentId?: string }>
}

export default async function ServiceLogsPage({ params, searchParams }: PageProps) {
  const { serviceId } = await params
  const { deploymentId } = (await searchParams) || {}
  const queryClient = getQueryClient()
  const orpc = await createServerORPC()

  try {
    if (deploymentId) {
      await queryClient.prefetchQuery(
        orpc.deployment.getLogs.queryOptions({
          input: { deploymentId, limit: 200, offset: 0 },
        })
      )
    }
  } catch (error) {
    console.error('Failed to prefetch deployment logs:', error)
  }

  const dehydratedState = dehydrate(queryClient)

  return (
    <HydrationBoundary state={dehydratedState}>
      <ServiceLogsClient />
    </HydrationBoundary>
  )
}