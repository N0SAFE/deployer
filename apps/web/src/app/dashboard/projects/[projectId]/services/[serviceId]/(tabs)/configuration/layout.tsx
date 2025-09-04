import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import { Settings } from 'lucide-react'
import { ConfigurationTabsList } from './ConfigurationTabsList'
import { ConfigurationActions } from './ConfigurationActions'

interface ServiceConfigLayoutProps {
    children: React.ReactNode
    params: Promise<{ projectId: string; serviceId: string }>
}

export default async function ServiceConfigLayout({
    children,
    params,
}: ServiceConfigLayoutProps) {
    const { projectId, serviceId } = await params
    const queryClient = getQueryClient()
    const orpcServer = await createServerORPC()

    // Prefetch service data for configuration
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
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="flex items-center gap-2 text-lg font-medium">
                            <Settings className="h-5 w-5" />
                            Service Configuration
                        </h3>
                        <p className="text-muted-foreground text-sm">
                            Manage service settings, environment variables, and
                            resource limits
                        </p>
                    </div>
                    <ConfigurationActions />
                </div>

                {/* Layout with Sidebar */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
                    {/* Sidebar */}
                    <ConfigurationTabsList projectId={projectId} serviceId={serviceId} />
                    
                    {/* Main Content */}
                    <div className="lg:col-span-3">{children}</div>
                </div>
            </div>
        </HydrationBoundary>
    )
}
