import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { ResourcesConfigurationClient } from './ResourcesConfigurationClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationResources } from '@/routes'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationResources.Page(async function ServiceResourceConfigPage({ params }) {
  const { serviceId } = await params
  
  const orpcServer = createServerORPC()
  const queryClient = getQueryClient()

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
})