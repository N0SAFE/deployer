import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { DeploymentConfigurationClient } from './DeploymentConfigurationClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationDeployment } from '@/routes'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationDeployment.Page(async function ServiceDeploymentConfigPage({ params }) {
  const { projectId, serviceId } = await params
  
  const orpcServer = await createServerORPC()
  const queryClient = getQueryClient()

  await queryClient.prefetchQuery(
    orpcServer.service.getById.queryOptions({ input: { id: serviceId } })
  )

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DeploymentConfigurationClient projectId={projectId} serviceId={serviceId} />
    </HydrationBoundary>
  )
})