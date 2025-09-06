import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import { GeneralConfigurationClient } from './GeneralConfigurationClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationGeneral } from '@/routes'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationGeneral.Page(async function ServiceGeneralConfigPage({ params }) {
  const { serviceId } = await params
  const queryClient = getQueryClient()
  const orpcServer = await createServerORPC()

  // Prefetch service data for general configuration
  try {
    await queryClient.fetchQuery(
      orpcServer.service.getById.queryOptions({
        input: { id: serviceId },
      })
    )
  } catch (error) {
    console.error('Failed to prefetch service data:', error)
  }

  const dehydratedState = dehydrate(queryClient)

  return (
    <HydrationBoundary state={dehydratedState}>
      <GeneralConfigurationClient serviceId={serviceId} />
    </HydrationBoundary>
  )
})