import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Settings } from 'lucide-react'
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
import ProjectLayoutClient from './ProjectLayoutClient'
import ProjectActionsDropdown from './ProjectActionsDropdown'
import ProjectMetricsClient from './ProjectMetricsClient'
import { ReactElement } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@repo/ui/components/shadcn/tabs'
import { headers } from 'next/headers'

interface ProjectLayoutProps {
    children: React.ReactNode
    params: Promise<{ projectId: string }>
}

const getTabSections = ({ projectId }: { projectId: string }) =>
    Object.entries({
        Overview: DashboardProjectsProjectIdTabs,
        Services: DashboardProjectsProjectIdTabsServices,
        Dependencies: DashboardProjectsProjectIdTabsDependencies,
        Deployments: DashboardProjectsProjectIdTabsDeployments,
        Monitoring: DashboardProjectsProjectIdTabsMonitoring,
        Configuration: DashboardProjectsProjectIdTabsConfiguration,
        Domains: DashboardProjectsProjectIdTabsDomains,
        SSL: DashboardProjectsProjectIdTabsSsl,
        Jobs: DashboardProjectsProjectIdTabsJobs,
        Team: DashboardProjectsProjectIdTabsTeam,
        Activity: DashboardProjectsProjectIdTabsActivity,
    }).map(([label, routeBuilder]) => ({
        label: label,
        path: routeBuilder({ projectId }),
        link: routeBuilder.Link({
            projectId,
            children: label,
            prefetch: true,
        }) as ReactElement,
    }))

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
    const { projectId } = await params
    const startTime = Date.now()
    const queryClient = getQueryClient()

    const pathname = (await headers()).get('x-pathname') || ''

    console.log(`🔄 [ProjectLayout-${projectId}] Starting server prefetch...`)

    const orpcServer = await createServerORPC()

    // Initialize project with correct types
    let project: { name?: string; description?: string | null } | null = null

    try {
        // Prefetch shared data and get results for server rendering
        const [projectResult, servicesResult] = await Promise.allSettled([
            // Project data - used by layout header and all child pages
            queryClient.fetchQuery(orpcServer.project.getById.queryOptions({
                input: { id: projectId }
            })),
            // Services data - used by services page, deployments page, and overview
            queryClient.fetchQuery(orpcServer.service.listByProject.queryOptions({
                input: {
                    projectId,
                    limit: 50
                }
            }))
        ])

        // Extract data for server-side rendering
        if (projectResult.status === 'fulfilled') {
            project = projectResult.value
        }

        // Also prefetch for client hydration
        if (projectResult.status === 'fulfilled') {
            queryClient.setQueryData(
                orpcServer.project.getById.queryKey({ input: { id: projectId } }),
                projectResult.value
            )
        }
        if (servicesResult.status === 'fulfilled') {
            queryClient.setQueryData(
                orpcServer.service.listByProject.queryKey({ input: { projectId, limit: 50 } }),
                servicesResult.value
            )
        }

    } catch (error) {
        console.error('Failed to prefetch project data:', error)
    }

    const endTime = Date.now()
    console.log(`✅ [ProjectLayout-${projectId}] Server render completed in ${endTime - startTime}ms`)

    // Get tab sections for server-side rendering
    const tabSections = getTabSections({projectId})

    const dehydratedState = dehydrate(queryClient)

    const getActiveTab = () => {
        let section = tabSections.find(
            (section) => section.path === pathname
        )
        if (!section) {
            tabSections.forEach((s) => {
                if (pathname.includes(s.path)) {
                    section = s
                }
            })
        }
        return section?.path || ''
    }

    // Return server-side rendered content with client components for interactivity
    return (
        <HydrationBoundary state={dehydratedState}>
            <div className="space-y-6">
                {/* Server-rendered Project Header */}
                <div className="flex items-start justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                            <h1 className="text-3xl font-bold tracking-tight">
                                {project?.name || 'Loading...'}
                            </h1>
                            <Badge variant="default">Active</Badge>
                        </div>
                        <p className="text-muted-foreground">
                            {project?.description || 'No description provided'}
                        </p>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Button variant="outline" size="sm">
                            <Settings className="mr-2 h-4 w-4" />
                            Settings
                        </Button>
                        <ProjectActionsDropdown />
                    </div>
                </div>

                {/* Client-rendered dynamic metrics */}
                <ProjectMetricsClient projectId={projectId} />

            <Tabs value={getActiveTab()} className="space-y-4">
                <TabsList>
                    {tabSections.map((section) => (
                        <TabsTrigger
                            asChild
                            value={section.path}
                            key={section.path}
                        >
                            {section.link}
                        </TabsTrigger>
                    ))}
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
        </HydrationBoundary>
    )
}