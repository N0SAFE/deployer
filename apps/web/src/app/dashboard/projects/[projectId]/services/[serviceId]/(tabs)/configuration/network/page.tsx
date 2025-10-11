import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { NetworkConfigurationClient } from './NetworkConfigurationClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationNetwork } from '@/routes'
import { orpc } from '@/lib/orpc'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationNetwork.Page(async function ServiceNetworkConfigPage({ params }) {
  const { projectId, serviceId } = await params
  
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery(
    orpc.service.getById.queryOptions({ input: { id: serviceId } })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <NetworkConfigurationClient projectId={projectId} serviceId={serviceId} />
    </HydrationBoundary>
  )
})