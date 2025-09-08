import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import { GeneralConfigurationClient } from './GeneralConfigurationClient'
import { DashboardProjectsProjectIdServicesServiceIdTabsConfigurationGeneral } from '@/routes'
import { tryCatch } from '@/utils/server'

export default DashboardProjectsProjectIdServicesServiceIdTabsConfigurationGeneral.Page(
    async function ServiceGeneralConfigPage({ params }) {
        const { serviceId } = await params
        const queryClient = getQueryClient()
        const orpcServer = await createServerORPC()

        // Prefetch service data for general configuration
        tryCatch(
            async () => {
                return await queryClient.fetchQuery(
                    orpcServer.service.getById.queryOptions({
                        input: { id: serviceId },
                    })
                )
            },
            (error) => {
                console.error('Failed to prefetch service data:', error)
            }
        )

        const dehydratedState = dehydrate(queryClient)

        return (
            <HydrationBoundary state={dehydratedState}>
                <GeneralConfigurationClient serviceId={serviceId} />
            </HydrationBoundary>
        )
    }
)
