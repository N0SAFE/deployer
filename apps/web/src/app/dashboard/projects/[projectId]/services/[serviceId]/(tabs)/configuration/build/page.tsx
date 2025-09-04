import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { BuildConfigurationClient } from './BuildConfigurationClient'

interface ServiceBuildConfigProps {
  params: {
    id: string
    serviceId: string
  }
}

export default async function ServiceBuildConfigPage({ params }: ServiceBuildConfigProps) {
  const orpcServer = await createServerORPC()
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery(
    orpcServer.service.getById.queryOptions({ input: { id: params.serviceId } })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BuildConfigurationClient params={params} />
    </HydrationBoundary>
  )
}