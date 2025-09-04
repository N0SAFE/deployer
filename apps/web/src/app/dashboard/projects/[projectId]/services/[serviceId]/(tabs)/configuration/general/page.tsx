import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import { GeneralConfigurationClient } from './GeneralConfigurationClient'

interface ServiceGeneralConfigProps {
  params: Promise<{
    projectId: string
    serviceId: string
  }>
}

export default async function ServiceGeneralConfigPage({ params }: ServiceGeneralConfigProps) {
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
}