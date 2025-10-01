import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { ResourcesConfigurationClient } from './ResourcesConfigurationClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationResources } from '@/routes'
import { orpc } from '@/lib/orpc'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationResources.Page(async function ServiceResourceConfigPage({ params }) {
  const { serviceId } = await params
  
  const queryClient = getQueryClient()

  // Prefetch service data (already prefetched in layout but ensure it's here)
  await queryClient.prefetchQuery(
    orpc.service.getById.queryOptions({
      input: { id: serviceId }
    })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ResourcesConfigurationClient serviceId={serviceId} />
    </HydrationBoundary>
  )
})