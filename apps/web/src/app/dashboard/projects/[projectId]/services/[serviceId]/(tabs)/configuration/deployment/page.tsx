import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { DeploymentConfigurationClient } from './DeploymentConfigurationClient'

interface ServiceDeploymentConfigProps {
  params: {
    id: string
    serviceId: string
  }
}

export default async function ServiceDeploymentConfigPage({ params }: ServiceDeploymentConfigProps) {
  const orpcServer = await createServerORPC()
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery(
    orpcServer.service.getById.queryOptions({ input: { id: params.serviceId } })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DeploymentConfigurationClient params={params} />
    </HydrationBoundary>
  )
}