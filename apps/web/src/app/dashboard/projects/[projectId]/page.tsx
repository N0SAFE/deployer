'use client'

import { useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowUpRight, Rocket } from 'lucide-react'
import { useProject, useProjectEnvironments } from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { filterProjectTopLevelServices } from '@/domains/service/hierarchy'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { EmptyState, EnvironmentBadge, StatStrip, StatStripItem, StatusBadge } from '@/components/dashboard'
import { PageSkeleton } from '@/components/dashboard/Skeletons'
import {
  AuthDashboardProjectsProjectIdServices,
  AuthDashboardProjectsProjectIdServicesServiceId,
  AuthDashboardProjectsProjectIdEnvironments,
  AuthDashboardProjectsProjectIdDeployments,
  AuthDashboardProjectsProjectIdDependencies,
} from '@/routes'
import { InlineError } from '../_components/workload/WorkloadStates'
import { RelativeTime } from '../_components/workload/RelativeTime'
import { toTime } from '../_utils/workload'

/**
 * Project overview — vitals plus the latest deployments. The identity header and
 * section nav live in the layout; services, environments and deployments each have
 * their own page, linked from here.
 */
export default function DashboardProjectOverviewPage() {
  const params = useParams<{ projectId: string }>()
  const router = useRouter()
  const projectId = params.projectId || ''

  const projectQuery = useProject(projectId)
  const servicesQuery = useServiceList({ query: { limit: 100, offset: 0 } })
  const environmentsQuery = useProjectEnvironments(projectId)
  const deploymentsQuery = useDeploymentList({
    query: { filter: { projectId: { operator: 'eq' as const, value: projectId } }, limit: 50, offset: 0 },
  })

  const services = useMemo(
    () => filterProjectTopLevelServices(servicesQuery.data?.data ?? [], projectId),
    [servicesQuery.data, projectId],
  )
  const serviceNames = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services])
  const environments = environmentsQuery.data?.environments ?? []
  const deployments = useMemo(() => deploymentsQuery.data?.data ?? [], [deploymentsQuery.data])
  const recent = useMemo(
    () => [...deployments].sort((a, b) => (toTime(b.createdAt) ?? 0) - (toTime(a.createdAt) ?? 0)).slice(0, 8),
    [deployments],
  )

  if (projectQuery.isLoading) return <PageSkeleton label="Loading project" blocks={1} />

  const firstError = projectQuery.error ?? servicesQuery.error ?? environmentsQuery.error ?? deploymentsQuery.error
  if (projectQuery.error) {
    return (
      <InlineError title="Could not load this project" error={projectQuery.error} onRetry={() => void projectQuery.refetch()} />
    )
  }
  if (!projectQuery.data) {
    return <InlineError title="Project not found" error={new Error('It does not exist or has been deleted.')} />
  }

  const retryAll = () => {
    void servicesQuery.refetch()
    void environmentsQuery.refetch()
    void deploymentsQuery.refetch()
  }
  const activeServices = services.filter((s) => s.isActive).length
  const failing = services.filter((s) => {
    const last = recent.find((d) => d.serviceId === s.id)
    return last?.status === 'failed'
  }).length

  return (
    <div className="space-y-5">
      {firstError ? (
        <InlineError title="Some project data could not be loaded" error={firstError} onRetry={retryAll} />
      ) : null}

      <StatStrip
        trailing={
          <AuthDashboardProjectsProjectIdDependencies.Link
            projectId={projectId}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Dependency graph
            <ArrowUpRight className="size-3.5" aria-hidden />
          </AuthDashboardProjectsProjectIdDependencies.Link>
        }
      >
        <StatStripItem
          label="Services"
          value={servicesQuery.isLoading ? undefined : services.length}
          hint={servicesQuery.isLoading ? 'loading' : `${String(activeServices)} switched on`}
        />
        <StatStripItem
          label="Environments"
          value={environmentsQuery.isLoading || environmentsQuery.isError ? undefined : environments.length}
          hint={environments.slice(0, 3).map((e) => e.name).join(', ') || undefined}
        />
        <StatStripItem
          label="Recent deployments"
          value={deploymentsQuery.isLoading || deploymentsQuery.isError ? undefined : deployments.length}
          hint={failing > 0 ? `${String(failing)} service${failing === 1 ? '' : 's'} failing` : undefined}
          tone={failing > 0 ? 'danger' : undefined}
        />
      </StatStrip>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Latest deployments</CardTitle>
            <CardDescription>The most recent runs across this project’s services.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <AuthDashboardProjectsProjectIdServices.Link projectId={projectId}>Services</AuthDashboardProjectsProjectIdServices.Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <AuthDashboardProjectsProjectIdEnvironments.Link projectId={projectId}>Environments</AuthDashboardProjectsProjectIdEnvironments.Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <AuthDashboardProjectsProjectIdDeployments.Link projectId={projectId}>All deployments</AuthDashboardProjectsProjectIdDeployments.Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {deploymentsQuery.isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">Loading deployments…</p>
          ) : deploymentsQuery.isError ? null : recent.length === 0 ? (
            <EmptyState
              icon={Rocket}
              title="No deployments yet"
              description={
                services.length === 0
                  ? 'Create a service first, then deploy it. Runs show up here.'
                  : 'Open a service and choose Deploy. Runs show up here.'
              }
              action={{
                label: services.length === 0 ? 'Create a service' : 'Open services',
                onClick: () => { router.push(AuthDashboardProjectsProjectIdServices({ projectId })) },
              }}
              compact
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {recent.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <StatusBadge status={d.status} />
                  <AuthDashboardProjectsProjectIdServicesServiceId.Link
                    projectId={projectId}
                    serviceId={d.serviceId}
                    className="min-w-0 truncate text-sm font-medium hover:underline"
                  >
                    {serviceNames.get(d.serviceId) ?? 'Sub-service'}
                  </AuthDashboardProjectsProjectIdServicesServiceId.Link>
                  <EnvironmentBadge environment={d.environment} />
                  <RelativeTime value={d.createdAt} className="ml-auto text-sm text-muted-foreground" />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
