import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { createServerORPC } from '@/lib/orpc/server'
import getQueryClient from '@/lib/getQueryClient'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Settings, ArrowLeft } from 'lucide-react'
import {
    DashboardProjects,
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
import ProjectActionsDropdown from './ProjectActionsDropdown'
import { ReactElement } from 'react'
import ProjectTabsList from './ProjectTabsList'
import { tryCatchAll } from '@/utils/server'

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

export default DashboardProjectsProjectIdTabs.Page<{
    children: React.ReactNode
}>(async function ProjectLayout({ children, params }) {
    const { projectId } = await params
    const startTime = Date.now()
    const queryClient = getQueryClient()

    console.log(`🔄 [ProjectLayout-${projectId}] Starting server prefetch...`)

    const orpcServer = await createServerORPC()

    // Fetch shared data and get results for server rendering
    const [project] = await tryCatchAll(
        [
            // Project data - used by layout header and all child pages
            async () => {
                const result = await queryClient.fetchQuery(
                    orpcServer.project.getById.queryOptions({
                        input: { id: projectId },
                    })
                )
                // Also set cache for hydration
                queryClient.setQueryData(
                    orpcServer.project.getById.queryKey({
                        input: { id: projectId },
                    }),
                    result
                )
                return result
            },
            // Services data - used by services page, deployments page, and overview
            async () => {
                const result = await queryClient.fetchQuery(
                    orpcServer.service.listByProject.queryOptions({
                        input: {
                            projectId,
                            limit: 50,
                        },
                    })
                )
                // Also set cache for hydration
                queryClient.setQueryData(
                    orpcServer.service.listByProject.queryKey({
                        input: { projectId, limit: 50 },
                    }),
                    result
                )
                return result
            },
        ],
        (error, index) => {
            const operation = index === 0 ? 'project data' : 'services data'
            console.error(
                `❌ [ProjectLayout-${projectId}] Failed to fetch ${operation}:`,
                error
            )
        }
    )

    const endTime = Date.now()
    console.log(
        `✅ [ProjectLayout-${projectId}] Server render completed in ${endTime - startTime}ms`
    )

    // Get tab sections for server-side rendering
    const tabSections = getTabSections({ projectId })

    const dehydratedState = dehydrate(queryClient)

    // Return server-side rendered content with client components for interactivity
    return (
        <HydrationBoundary state={dehydratedState}>
            <div className="space-y-6">
                {/* Server-rendered Project Header */}
                <div className="flex items-start justify-between">
                    <div className="space-y-1">
                        <div className="flex items-center space-x-3">
                            <Button 
                                asChild 
                                variant="ghost" 
                                size="sm" 
                                className="p-2 hover:bg-muted/50" 
                                title="Back to Projects"
                            >
                                <DashboardProjects.Link>
                                    <ArrowLeft className="h-4 w-4" />
                                </DashboardProjects.Link>
                            </Button>
                            <div className="flex items-center space-x-2">
                                <h1 className="text-3xl font-bold tracking-tight">
                                    {project?.name || 'Loading...'}
                                </h1>
                                <Badge variant="default">Active</Badge>
                            </div>
                        </div>
                        <p className="text-muted-foreground ml-12">
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

                <ProjectTabsList tabSections={tabSections} />

                {children}

                {/* Fallback for when no children are rendered */}
                {children ? null : (
                    <div className="text-muted-foreground py-6 text-center">
                        Select a tab to view content
                    </div>
                )}
            </div>
        </HydrationBoundary>
    )
})
