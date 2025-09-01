'use client'

import { usePathname } from 'next/navigation'
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
    DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import {
    Activity,
    Settings,
    MoreHorizontal,
    ExternalLink,
    GitBranch,
    Users,
    CheckCircle2,
    Server,
    Container,
    Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { useProject } from '@/hooks/useProjects'
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@repo/ui/components/shadcn/tabs'
import {
    DashboardProjectsProjectIdTabs,
    DashboardProjectsProjectIdTabsActivity,
    DashboardProjectsProjectIdTabsConfiguration,
    DashboardProjectsProjectIdTabsDependencies,
    DashboardProjectsProjectIdTabsDeployments,
    DashboardProjectsProjectIdTabsDomains,
    DashboardProjectsProjectIdTabsJobs,
    DashboardProjectsProjectIdTabsMonitoring,
    DashboardProjectsProjectIdTabsServices,
    DashboardProjectsProjectIdTabsSsl,
    DashboardProjectsProjectIdTabsTeam,
} from '@/routes/index'
import { useParams } from '@/routes/hooks'

interface ProjectLayoutProps {
    children: React.ReactNode
}

export default function ProjectLayout({ children }: ProjectLayoutProps) {
    const pathname = usePathname()
    const { projectId } = useParams(DashboardProjectsProjectIdTabs)

    const { data: project, isLoading, error } = useProject(projectId)

    // Determine active tab from pathname
    const getActiveTab = () => {
        if (
            pathname ===
            DashboardProjectsProjectIdTabs({
                projectId,
            })
        )
            return 'overview'
        if (
            pathname.startsWith(
                DashboardProjectsProjectIdTabsServices({
                    projectId,
                })
            )
        )
            return 'services'
        if (
            pathname.startsWith(
                DashboardProjectsProjectIdTabsDependencies({
                    projectId,
                })
            )
        )
            return 'dependencies'
        if (
            pathname.startsWith(
                DashboardProjectsProjectIdTabsDeployments({
                    projectId,
                })
            )
        )
            return 'deployments'
        if (
            pathname.startsWith(
                DashboardProjectsProjectIdTabsMonitoring({
                    projectId,
                })
            )
        )
            return 'monitoring'
        if (
            pathname.startsWith(
                DashboardProjectsProjectIdTabsConfiguration({
                    projectId,
                })
            )
        )
            return 'configuration'
        if (
            pathname.startsWith(
                DashboardProjectsProjectIdTabsDomains({
                    projectId,
                })
            )
        )
            return 'domains'
        if (
            pathname.startsWith(
                DashboardProjectsProjectIdTabsSsl({
                    projectId,
                })
            )
        )
            return 'ssl'
        if (
            pathname.startsWith(
                DashboardProjectsProjectIdTabsJobs({
                    projectId,
                })
            )
        )
            return 'jobs'
        if (
            pathname.startsWith(
                DashboardProjectsProjectIdTabsTeam({
                    projectId,
                })
            )
        )
            return 'team'
        if (
            pathname.startsWith(
                DashboardProjectsProjectIdTabsActivity({
                    projectId,
                })
            )
        )
            return 'activity'
        return 'overview'
    }

    // Mock data for metrics (will be replaced with proper hooks later)
    const services: unknown[] = []
    const deployments: unknown[] = []

    const activeDeployments = deployments.filter((d: unknown) => {
        const deployment = d as { status?: string }
        return ['pending', 'queued', 'building', 'deploying'].includes(
            deployment.status || ''
        )
    })

    const successfulDeployments = deployments.filter((d: unknown) => {
        const deployment = d as { status?: string }
        return deployment.status === 'success'
    })

    const successRate =
        deployments.length > 0
            ? Math.round(
                  (successfulDeployments.length / deployments.length) * 100
              )
            : 0

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <div className="text-center">
                    <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
                    <p className="text-muted-foreground">Loading project...</p>
                </div>
            </div>
        )
    }

    if (error || !project) {
        return (
            <div className="flex h-96 items-center justify-center">
                <div className="text-center">
                    <p className="text-destructive mb-4">
                        Failed to load project
                    </p>
                    <p className="text-muted-foreground text-sm">
                        {error?.message || 'Project not found'}
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Project Header */}
            <div className="flex items-start justify-between">
                <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                        <h1 className="text-3xl font-bold tracking-tight">
                            {project.name}
                        </h1>
                        <Badge variant="default">Active</Badge>
                    </div>
                    <p className="text-muted-foreground">
                        {project.description || 'No description provided'}
                    </p>
                </div>
                <div className="flex items-center space-x-2">
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
                                <ExternalLink className="mr-2 h-4 w-4" />
                                View Domain
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                                <GitBranch className="mr-2 h-4 w-4" />
                                Git Settings
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                                <Users className="mr-2 h-4 w-4" />
                                Manage Team
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Project Metrics */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Services
                        </CardTitle>
                        <Server className="text-muted-foreground h-4 w-4" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {services.length}
                        </div>
                        <p className="text-muted-foreground text-xs">
                            0 active
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Deployments
                        </CardTitle>
                        <Container className="text-muted-foreground h-4 w-4" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {deployments.length}
                        </div>
                        <p className="text-muted-foreground text-xs">
                            {activeDeployments.length} active
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
                        <div className="text-2xl font-bold">{successRate}%</div>
                        <p className="text-muted-foreground text-xs">
                            Last 30 days
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
                            Last 7 days
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Tabs value={getActiveTab()} className="space-y-4">
                <TabsList>
                    <TabsTrigger asChild value="overview">
                        <DashboardProjectsProjectIdTabs.Link projectId={projectId}>
                            Overview
                        </DashboardProjectsProjectIdTabs.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="services">
                        <DashboardProjectsProjectIdTabsServices.Link
                            projectId={projectId}
                        >
                            Services
                        </DashboardProjectsProjectIdTabsServices.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="deployments">
                        <DashboardProjectsProjectIdTabsDeployments.Link
                            projectId={projectId}
                        >
                            Deployments
                        </DashboardProjectsProjectIdTabsDeployments.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="monitoring">
                        <DashboardProjectsProjectIdTabsMonitoring.Link
                            projectId={projectId}
                        >
                            Monitoring
                        </DashboardProjectsProjectIdTabsMonitoring.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="configuration">
                        <DashboardProjectsProjectIdTabsConfiguration.Link
                            projectId={projectId}
                        >
                            Configuration
                        </DashboardProjectsProjectIdTabsConfiguration.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="domains">
                        <DashboardProjectsProjectIdTabsDomains.Link
                            projectId={projectId}
                        >
                            Domains
                        </DashboardProjectsProjectIdTabsDomains.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="ssl">
                        <DashboardProjectsProjectIdTabsSsl.Link
                            projectId={projectId}
                        >
                            SSL
                        </DashboardProjectsProjectIdTabsSsl.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="jobs">
                        <DashboardProjectsProjectIdTabsJobs.Link
                            projectId={projectId}
                        >
                            Jobs
                        </DashboardProjectsProjectIdTabsJobs.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="dependencies">
                        <DashboardProjectsProjectIdTabsDependencies.Link
                            projectId={projectId}
                        >
                            Dependencies
                        </DashboardProjectsProjectIdTabsDependencies.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="team">
                        <DashboardProjectsProjectIdTabsTeam.Link
                            projectId={projectId}
                        >
                            Team
                        </DashboardProjectsProjectIdTabsTeam.Link>
                    </TabsTrigger>
                    <TabsTrigger asChild value="activity">
                        <DashboardProjectsProjectIdTabsActivity.Link
                            projectId={projectId}
                        >
                            Activity
                        </DashboardProjectsProjectIdTabsActivity.Link>
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
        </div>
    )
}
