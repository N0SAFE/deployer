import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { NetworkConfigurationClient } from './NetworkConfigurationClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationNetwork } from '@/routes'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationNetwork.Page(async function ServiceNetworkConfigPage({ params }) {
  const { projectId, serviceId } = await params
  
  const orpcServer = await createServerORPC()
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery(
    orpcServer.service.getById.queryOptions({ input: { id: serviceId } })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <NetworkConfigurationClient projectId={projectId} serviceId={serviceId} />
    </HydrationBoundary>
  )
})