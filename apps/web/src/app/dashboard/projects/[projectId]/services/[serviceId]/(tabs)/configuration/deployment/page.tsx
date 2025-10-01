import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { DeploymentConfigurationClient } from './DeploymentConfigurationClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationDeployment } from '@/routes'
import { orpc } from '@/lib/orpc'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationDeployment.Page(async function ServiceDeploymentConfigPage({ params }) {
  const { projectId, serviceId } = await params
  
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery(
    orpc.service.getById.queryOptions({ input: { id: serviceId } })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DeploymentConfigurationClient projectId={projectId} serviceId={serviceId} />
    </HydrationBoundary>
  )
})