import type { ReactElement } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import Link from 'next/link'
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import {
    Activity,
    BarChart3,
    Container,
} from 'lucide-react'
import {
    DashboardProjectsProjectIdTabs,
    DashboardProjectsProjectIdServicesServiceIdTabs,
    DashboardProjectsProjectIdServicesServiceIdTabsConfiguration,
    DashboardProjectsProjectIdServicesServiceIdTabsDeployments,
    DashboardProjectsProjectIdServicesServiceIdTabsLogs,
    DashboardProjectsProjectIdServicesServiceIdTabsMonitoring,
    DashboardProjectsProjectIdServicesServiceIdTabsPreviews,
} from '@/routes/index'
import ServiceTabsList from './ServiceTabsList'
import ServiceActionsDropdown from './ServiceActionsDropdown'
import { tryCatchAll } from '@/utils/server'

const getConfigSections = ({
    projectId,
    serviceId,
}: {
    projectId: string
    serviceId: string
}) =>
    Object.entries({
        Overview: DashboardProjectsProjectIdServicesServiceIdTabs,
        Deployments: DashboardProjectsProjectIdServicesServiceIdTabsDeployments,
        Previews: DashboardProjectsProjectIdServicesServiceIdTabsPreviews,
        Logs: DashboardProjectsProjectIdServicesServiceIdTabsLogs,
        Monitoring: DashboardProjectsProjectIdServicesServiceIdTabsMonitoring,
        Configuration:
            DashboardProjectsProjectIdServicesServiceIdTabsConfiguration,
    }).map(([label, routeBuilder]) => ({
        label: label,
        path: routeBuilder({ projectId, serviceId }),
        link: routeBuilder.Link({
            projectId,
            serviceId,
            children: label,
            prefetch: true,
        }) as ReactElement,
    }))

export default DashboardProjectsProjectIdServicesServiceIdTabs.Page<{
    children: React.ReactNode
}>(async function ServiceLayout({
    children,
    params,
}) {
    const { projectId, serviceId } = await params
    const startTime = Date.now()
    const queryClient = getQueryClient()

    console.log(
        `🔄 [ServiceLayout-${projectId}/${serviceId}] Starting server prefetch...`
    )

    const orpcServer = await createServerORPC()

    // Fetch service and deployments data using tryCatchAll for cleaner error handling
    const [service, deploymentsData] = await tryCatchAll([
        async () => {
            const result = await queryClient.fetchQuery(
                orpcServer.service.getById.queryOptions({
                    input: { id: serviceId },
                })
            )
            // Hydrate the cache
            queryClient.setQueryData(
                orpcServer.service.getById.queryKey({ input: { id: serviceId } }),
                result
            )
            return result
        },
        async () => {
            const result = await queryClient.fetchQuery(
                orpcServer.service.getDeployments.queryOptions({
                    input: { id: serviceId, limit: 50 },
                })
            )
            // Hydrate the cache
            queryClient.setQueryData(
                orpcServer.service.getDeployments.queryKey({
                    input: { id: serviceId, limit: 50 },
                }),
                result
            )
            return result
        }
    ], (error, index) => {
        const operation = index === 0 ? 'service data' : 'deployments data'
        console.error(`❌ [ServiceLayout-${projectId}/${serviceId}] Failed to fetch ${operation}:`, error)
    })

    const endTime = Date.now()
    console.log(
        `✅ [ServiceLayout-${projectId}/${serviceId}] Server render completed in ${endTime - startTime}ms`
    )

    const tabSections = getConfigSections({ projectId, serviceId })
    const dehydratedState = dehydrate(queryClient)

    // Compute deployment stats on server (safe defaults if missing)
    const deployments = (
        (deploymentsData as unknown as { deployments?: Array<{ status: string }> })
            ?.deployments ?? []
    )
    const total = deployments.length
    const successful = deployments.filter((d) => d.status === 'success').length
    const active = deployments.filter((d) =>
        ['pending', 'queued', 'building', 'deploying'].includes(d.status)
    ).length
    const successRate = total > 0 ? Math.round((successful / total) * 100) : 0

    const getProviderLabel = (provider?: string) => {
        if (!provider) return 'Unknown'
        const labels: Record<string, string> = {
            github: 'GitHub',
            gitlab: 'GitLab',
            bitbucket: 'Bitbucket',
            docker_registry: 'Docker Registry',
            gitea: 'Gitea',
            s3_bucket: 'S3 Bucket',
            manual: 'Manual',
        }
        return labels[provider] || provider
    }

    const getBuilderLabel = (builder?: string) => {
        if (!builder) return 'Unknown'
        const labels: Record<string, string> = {
            dockerfile: 'Dockerfile',
            nixpack: 'Nixpack',
            railpack: 'Railpack',
            buildpack: 'Buildpack',
            static: 'Static',
            docker_compose: 'Docker Compose',
        }
        return labels[builder] || builder
    }

    return (
        <HydrationBoundary state={dehydratedState}>
            <div className="space-y-6">
                {/* Service Header */}
                <div className="flex items-start justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                            <Button asChild variant="ghost" size="sm">
                                <Link href={DashboardProjectsProjectIdTabs({ projectId })}>
                                    {/* Using a simple unicode arrow to avoid client-only icon here */}
                                    ← Back to Project
                                </Link>
                            </Button>
                        </div>
                        <div className="flex items-center space-x-3">
                            <h1 className="text-3xl font-bold tracking-tight">
                                {service?.name || 'Loading...'}
                            </h1>
                            <Badge variant={service?.isActive ? 'default' : 'secondary'}>
                                {service?.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                            {service?.type && (
                                <Badge variant="outline">{service.type}</Badge>
                            )}
                        </div>
                        <div className="text-muted-foreground flex items-center space-x-4 text-sm">
                            <span>{getProviderLabel(service?.provider as unknown as string)}</span>
                            <span>•</span>
                            <span>{getBuilderLabel(service?.builder as unknown as string)}</span>
                            {service?.port ? (
                                <>
                                    <span>•</span>
                                    <span>Port {service.port}</span>
                                </>
                            ) : null}
                        </div>
                    </div>

                    <ServiceActionsDropdown
                        serviceId={serviceId}
                        serviceName={service?.name || ''}
                    />
                </div>

                {/* Service Metrics */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Total Deployments
                            </CardTitle>
                            <Container className="text-muted-foreground h-4 w-4" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{total}</div>
                            <p className="text-muted-foreground text-xs">{active} active</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Success Rate
                            </CardTitle>
                            {/* Icon purely presentational */}
                            <Container className="text-muted-foreground h-4 w-4" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{successRate}%</div>
                            <p className="text-muted-foreground text-xs">{successful} successful</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                Memory Usage
                            </CardTitle>
                            <BarChart3 className="text-muted-foreground h-4 w-4" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">256 MB</div>
                            <p className="text-muted-foreground text-xs">of 512 MB allocated</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
                            <Activity className="text-muted-foreground h-4 w-4" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">99.9%</div>
                            <p className="text-muted-foreground text-xs">Last 30 days</p>
                        </CardContent>
                    </Card>
                </div>

                <ServiceTabsList tabSections={tabSections} />

                {children}

                {children ? null : (
                    <div className="text-muted-foreground py-6 text-center">
                        Select a tab to view content
                    </div>
                )}
            </div>
        </HydrationBoundary>
    )
})
