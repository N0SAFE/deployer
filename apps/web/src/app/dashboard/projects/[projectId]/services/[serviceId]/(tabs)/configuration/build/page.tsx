import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { BuildConfigurationClient } from './BuildConfigurationClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationBuild } from '@/routes'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationBuild.Page(async function ServiceBuildConfigPage({ params }) {
  const { projectId, serviceId } = await params
  const orpcServer = await createServerORPC()
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery(
    orpcServer.service.getById.queryOptions({ input: { id: serviceId } })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BuildConfigurationClient params={{ id: projectId, serviceId }} />
    </HydrationBoundary>
  )
})