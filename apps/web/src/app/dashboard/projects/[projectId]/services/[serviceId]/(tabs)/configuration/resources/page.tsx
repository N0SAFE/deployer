import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { ResourcesConfigurationClient } from './ResourcesConfigurationClient'

interface ServiceResourceConfigProps {
  params: {
    id: string
    serviceId: string
  }
}

export default async function ServiceResourceConfigPage({ params }: ServiceResourceConfigProps) {
  const orpcServer = createServerORPC()
  const queryClient = getQueryClient()
  const serviceId = params.serviceId

  // Prefetch service data (already prefetched in layout but ensure it's here)
  await queryClient.prefetchQuery(
    (await orpcServer).service.getById.queryOptions({
      input: { id: serviceId }
    })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ResourcesConfigurationClient serviceId={serviceId} />
    </HydrationBoundary>
  )
}