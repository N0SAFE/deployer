'use client'

import { isDefinedORPCError, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useProject, useProjectEnvironments } from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren, ArrowUpRight, Boxes, Layers, Rocket, GitBranch } from 'lucide-react'
import { EmptyState } from '@/components/dashboard'
import {
  AuthDashboardProjectsProjectIdServices,
  AuthDashboardProjectsProjectIdEnvironments,
  AuthDashboardProjectsProjectIdDeployments,
  AuthDashboardProjectsProjectIdDependencies,
} from '@/routes'
import { formatDate } from './_utils/helpers'
import { filterProjectTopLevelServices } from '@/domains/service/hierarchy'

/**
 * Project Overview — the lean project dashboard.
 *
 * The project identity header + section nav live in the layout. This page
 * ONLY renders dashboard content: KPI stats, recent deployments, and quick
 * links to the dedicated Services / Environments / Deployments pages.
 * No service tables, no create wizards, no config — those live in their
 * own pages now.
 */
export default function DashboardProjectOverviewPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId || ''

  const { data: projectData, isLoading: projectLoading, error: projectError } = useProject(projectId)
  const { data: servicesData, isLoading: servicesLoading, error: servicesError } = useServiceList({ query: { limit: 100, offset: 0 } })
  const { data: environmentsData, isLoading: envLoading, error: envError } = useProjectEnvironments(projectId)
  const { data: deploymentsData, isLoading: deploymentsLoading, error: deploymentsError } = useDeploymentList({
    query: {
      filter: { projectId: { operator: 'eq' as const, value: projectId } },
      limit: 50,
      offset: 0,
    },
  })

  const localServices = useMemo(
    () => filterProjectTopLevelServices(servicesData?.data ?? [], projectId),
    [servicesData, projectId],
  )
  const environments = useMemo(() => {
    if (environmentsData) return Array.isArray(environmentsData) ? environmentsData : (environmentsData as any).environments ?? []
    return []
  }, [environmentsData])
  const deploymentItems = useMemo(() => deploymentsData?.data ?? [], [deploymentsData])

  const activeServices = localServices.filter((s: any) => (s.status ?? s.state ?? 'active') === 'active').length

  const recentDeployments = useMemo(() => {
    return [...deploymentItems]
      .sort((a: any, b: any) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
      .slice(0, 8)
  }, [deploymentItems])

  if (projectLoading || servicesLoading || envLoading || deploymentsLoading) {
    return (
      <div className="space-y-6">
        {/* Matches the loaded layout: a thin summary row, not four tall cards. */}
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    )
  }

  if (projectError || servicesError || envError || deploymentsError) {
    const activeError = projectError ?? servicesError ?? envError ?? deploymentsError
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Failed to load project data</AlertTitle>
        <AlertDescription>
          {isDefinedORPCError(activeError) ? getErrorMessage(activeError, 'An unexpected error occurred.') : 'An unexpected error occurred.'}
        </AlertDescription>
      </Alert>
    )
  }

  if (!projectData) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Project not found</AlertTitle>
        <AlertDescription>The requested project does not exist or has been deleted.</AlertDescription>
      </Alert>
    )
  }

  // Three real counts. "Dependencies" is deliberately NOT one of them: its
  // "value" was the literal string "Graph", making it a navigation link wearing
  // a metric's clothes. It stays reachable — as a link, at the end of the row.
  const kpis = [
    {
      label: 'Services',
      value: String(localServices.length),
      sub: `${String(activeServices)} active`,
      icon: Boxes,
      route: AuthDashboardProjectsProjectIdServices,
    },
    {
      label: 'Environments',
      value: String(environments.length),
      sub: environments.map((e: any) => e.name).slice(0, 3).join(', ') || 'none',
      icon: GitBranch,
      route: AuthDashboardProjectsProjectIdEnvironments,
    },
    {
      label: 'Deployments',
      value: String(deploymentItems.length),
      sub: 'All time',
      icon: Rocket,
      route: AuthDashboardProjectsProjectIdDeployments,
    },
  ]

  return (
    <div className="space-y-6">
      {/*
        Project summary — one dense row instead of a 4-up KPI card grid.
        The strip under a page title is the most valuable space on the screen.
        Spending four bordered cards (each with a header, an icon, a hover state
        and a sparkle arrow) to carry three integers pushed the content people
        actually came for — services, deployments — below the fold.
      */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border/60 bg-card/30 px-4 py-3">
        {kpis.map(({ label, value, sub, icon: Icon, route: Route }) => (
          <Route.Link key={label} projectId={projectId} className="group flex items-center gap-2">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-sm font-medium tabular-nums text-foreground transition-colors group-hover:text-primary">
              {value}
            </span>
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">· {sub}</span>
          </Route.Link>
        ))}
        <AuthDashboardProjectsProjectIdDependencies.Link
          projectId={projectId}
          className="group ml-auto flex items-center gap-1 text-xs font-medium text-primary"
        >
          Dependency graph
          <ArrowUpRight className="size-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </AuthDashboardProjectsProjectIdDependencies.Link>
      </div>

      {/* Recent deployments */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Recent deployments</CardTitle>
            <CardDescription className="text-xs">Latest deployment activity in this project.</CardDescription>
          </div>
          <AuthDashboardProjectsProjectIdDeployments.Link projectId={projectId}>
            <Badge variant="outline" className="cursor-pointer">View all</Badge>
          </AuthDashboardProjectsProjectIdDeployments.Link>
        </CardHeader>
        <CardContent>
          {recentDeployments.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No deployments yet"
              description="Deployments appear here once a service is deployed."
              compact
            />
          ) : (
            <div className="divide-y divide-border/60">
              {recentDeployments.map((dep: any) => {
                const status = dep.status ?? 'unknown'
                const envName = dep.environment ?? (dep as any).environmentId
                const isSuccess = status === 'success' || status === 'healthy' || status === 'succeeded'
                const isFailure = status === 'failed' || status === 'error' || status === 'cancelled'
                return (
                  <AuthDashboardProjectsProjectIdDeployments.Link
                    key={dep.id}
                    projectId={projectId}
                    className="group/deploy block"
                  >
                    <div className="flex items-center justify-between gap-3 py-2.5 transition-colors group-hover/deploy:bg-background/40">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                            {envName ?? '—'}
                          </Badge>
                          <p className="truncate text-sm font-medium">{dep.name ?? dep.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge variant={isFailure ? 'destructive' as const : isSuccess ? 'default' as const : 'secondary' as const}>
                          {status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{formatDate(dep.createdAt ?? '')}</span>
                      </div>
                    </div>
                  </AuthDashboardProjectsProjectIdDeployments.Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
