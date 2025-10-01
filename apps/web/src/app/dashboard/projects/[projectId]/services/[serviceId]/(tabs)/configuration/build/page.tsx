import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { BuildConfigurationClient } from './BuildConfigurationClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationBuild } from '@/routes'
import { orpc } from '@/lib/orpc'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationBuild.Page(async function ServiceBuildConfigPage({ params }) {
  const { projectId, serviceId } = await params
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery(
    orpc.service.getById.queryOptions({ input: { id: serviceId } })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BuildConfigurationClient params={{ id: projectId, serviceId }} />
    </HydrationBoundary>
  )
})