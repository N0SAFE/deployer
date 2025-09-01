'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import {
    Activity,
    Settings,
    MoreHorizontal,
    ExternalLink,
    ArrowLeft,
    Play,
    Square,
    RotateCcw,
    Trash2,
    Eye,
    Zap,
    Network,
    BarChart3,
    Container,
    CheckCircle2,
    Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { useService, useServiceDeployments } from '@/hooks/useServices'
import ServiceDependencyView from '@/components/services/ServiceDependencyView'
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@repo/ui/components/shadcn/tabs'
import {
    DashboardProjectsProjectIdServicesServiceIdTabs,
    DashboardProjectsProjectIdServicesServiceIdTabsConfiguration,
    DashboardProjectsProjectIdServicesServiceIdTabsDeployments,
    DashboardProjectsProjectIdServicesServiceIdTabsLogs,
    DashboardProjectsProjectIdServicesServiceIdTabsMonitoring,
    DashboardProjectsProjectIdServicesServiceIdTabsPreviews,
} from '@/routes/index'
import { useParams } from '@/routes/hooks'

interface ServiceLayoutProps {
    children: React.ReactNode
}

export default function ServiceLayout({ children }: ServiceLayoutProps) {
    const { projectId, serviceId } = useParams(
        DashboardProjectsProjectIdServicesServiceIdTabs
    )
    const router = useRouter()
    const pathname = usePathname()

    const [showDependencies, setShowDependencies] = useState(false)

    const { data: service, isLoading, error } = useService(serviceId)
    const { data: deploymentsData } = useServiceDeployments(serviceId)

    const deployments = deploymentsData?.deployments || []

    // Calculate deployment stats
    const deploymentStats = useMemo(() => {
        const total = deployments.length
        const successful = deployments.filter(
            (d) => d.status === 'success'
        ).length
        const failed = deployments.filter((d) => d.status === 'failed').length
        const active = deployments.filter((d) =>
            ['pending', 'queued', 'building', 'deploying'].includes(d.status)
        ).length

        return {
            total,
            successful,
            failed,
            active,
            successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
        }
    }, [deployments])

    // Determine active tab from pathname
    const getActiveTab = () => {
        const basePath = `/dashboard/projects/${projectId}/services/${serviceId}`
        if (pathname === basePath) return 'overview'
        if (pathname.startsWith(`${basePath}/deployments`)) return 'deployments'
        if (pathname.startsWith(`${basePath}/previews`)) return 'previews'
        if (pathname.startsWith(`${basePath}/logs`)) return 'logs'
        if (pathname.startsWith(`${basePath}/monitoring`)) return 'monitoring'
        if (pathname.startsWith(`${basePath}/configuration`))
            return 'configuration'
        return 'overview'
    }

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <div className="text-center">
                    <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
                    <p className="text-muted-foreground">Loading service...</p>
                </div>
            </div>
        )
    }

    if (error || !service) {
        return (
            <div className="flex h-96 items-center justify-center">
                <div className="text-center">
                    <p className="text-destructive mb-4">
                        Failed to load service
                    </p>
                    <p className="text-muted-foreground text-sm">
                        {error?.message || 'Service not found'}
                    </p>
                </div>
            </div>
        )
    }

    const getProviderLabel = (provider: string) => {
        const labels = {
            github: 'GitHub',
            gitlab: 'GitLab',
            bitbucket: 'Bitbucket',
            docker_registry: 'Docker Registry',
            gitea: 'Gitea',
            s3_bucket: 'S3 Bucket',
            manual: 'Manual',
        }
        return labels[provider as keyof typeof labels] || provider
    }

    const getBuilderLabel = (builder: string) => {
        const labels = {
            dockerfile: 'Dockerfile',
            nixpack: 'Nixpack',
            railpack: 'Railpack',
            buildpack: 'Buildpack',
            static: 'Static',
            docker_compose: 'Docker Compose',
        }
        return labels[builder as keyof typeof labels] || builder
    }

    return (
        <div className="space-y-6">
            {/* Service Header */}
            <div className="flex items-start justify-between">
                <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                router.push(`/dashboard/projects/${projectId}`)
                            }
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back to Project
                        </Button>
                    </div>
                    <div className="flex items-center space-x-3">
                        <h1 className="text-3xl font-bold tracking-tight">
                            {service.name}
                        </h1>
                        <Badge
                            variant={service.isActive ? 'default' : 'secondary'}
                        >
                            {service.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                        <Badge variant="outline">{service.type}</Badge>
                    </div>
                    <div className="text-muted-foreground flex items-center space-x-4 text-sm">
                        <span>{getProviderLabel(service.provider)}</span>
                        <span>•</span>
                        <span>{getBuilderLabel(service.builder)}</span>
                        {service.port && (
                            <>
                                <span>•</span>
                                <span>Port {service.port}</span>
                            </>
                        )}
                    </div>
                </div>

                <div className="flex items-center space-x-2">
                    <Button variant="outline" size="sm">
                        <Eye className="mr-2 h-4 w-4" />
                        View Live
                    </Button>
                    <Button variant="outline" size="sm">
                        <Zap className="mr-2 h-4 w-4" />
                        Deploy
                    </Button>
                    <Button variant="outline" size="sm">
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                                <Play className="mr-2 h-4 w-4" />
                                Start Service
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                                <Square className="mr-2 h-4 w-4" />
                                Stop Service
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                                <RotateCcw className="mr-2 h-4 w-4" />
                                Restart Service
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => setShowDependencies(true)}
                            >
                                <Network className="mr-2 h-4 w-4" />
                                Manage Dependencies
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                                <ExternalLink className="mr-2 h-4 w-4" />
                                View Logs
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive">
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Service
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
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
                        <div className="text-2xl font-bold">
                            {deploymentStats.total}
                        </div>
                        <p className="text-muted-foreground text-xs">
                            {deploymentStats.active} active
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Success Rate
                        </CardTitle>
                        <CheckCircle2 className="text-muted-foreground h-4 w-4" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {deploymentStats.successRate}%
                        </div>
                        <p className="text-muted-foreground text-xs">
                            {deploymentStats.successful} successful
                        </p>
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
                        <p className="text-muted-foreground text-xs">
                            of 512 MB allocated
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Uptime
                        </CardTitle>
                        <Activity className="text-muted-foreground h-4 w-4" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">99.9%</div>
                        <p className="text-muted-foreground text-xs">
                            Last 30 days
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Tabs value={getActiveTab()} className="space-y-4">
                <TabsList>
                    <TabsTrigger asChild value="overview">
                        <DashboardProjectsProjectIdServicesServiceIdTabs.Link
                            projectId={projectId}
                            serviceId={serviceId}
                        >
                            Overview
                        </DashboardProjectsProjectIdServicesServiceIdTabs.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="deployments">
                        <DashboardProjectsProjectIdServicesServiceIdTabsDeployments.Link
                            projectId={projectId}
                            serviceId={serviceId}
                        >
                            Deployments
                        </DashboardProjectsProjectIdServicesServiceIdTabsDeployments.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="previews">
                        <DashboardProjectsProjectIdServicesServiceIdTabsPreviews.Link
                            projectId={projectId}
                            serviceId={serviceId}
                        >
                            Preview Environments
                        </DashboardProjectsProjectIdServicesServiceIdTabsPreviews.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="logs">
                        <DashboardProjectsProjectIdServicesServiceIdTabsLogs.Link
                            projectId={projectId}
                            serviceId={serviceId}
                        >
                            Logs
                        </DashboardProjectsProjectIdServicesServiceIdTabsLogs.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="monitoring">
                        <DashboardProjectsProjectIdServicesServiceIdTabsMonitoring.Link
                            projectId={projectId}
                            serviceId={serviceId}
                        >
                            Monitoring
                        </DashboardProjectsProjectIdServicesServiceIdTabsMonitoring.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="configuration">
                        <DashboardProjectsProjectIdServicesServiceIdTabsConfiguration.Link
                            projectId={projectId}
                            serviceId={serviceId}
                        >
                            Configuration
                        </DashboardProjectsProjectIdServicesServiceIdTabsConfiguration.Link>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value={getActiveTab()}>{children}</TabsContent>

                {/* Fallback for when no children are rendered */}
                {children ? null : (
                    <div className="text-muted-foreground py-6 text-center">
                        Select a tab to view content
                    </div>
                )}
            </Tabs>

            {/* Dependencies Dialog */}
            <ServiceDependencyView
                serviceId={serviceId}
                serviceName={service.name}
                open={showDependencies}
                onOpenChange={setShowDependencies}
            />
        </div>
    )
}
