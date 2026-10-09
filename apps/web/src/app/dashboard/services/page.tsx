'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthDashboardProjects, AuthDashboardProjectsProjectIdServicesServiceId, AuthDashboardProjectsProjectId } from '@/routes'
import { useServiceList } from '@/domains/service/hooks'
import { useProjectList } from '@/domains/project/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { GitBranch, RefreshCw, Search, Server } from 'lucide-react'
import {
  PageHeader, PageErrorState, ScopeLabel, StatusBadge, StatStrip, StatStripItem, EmptyState, FilteredEmptyState,
} from '@/components/dashboard'
import { PageSkeleton } from '@/components/dashboard/Skeletons'
import { errorReason, useSlowLoading } from '../projects/_components/workload/WorkloadStates'
import { RelativeTime } from '../projects/_components/workload/RelativeTime'
import { IdChip } from '../projects/_components/workload/CopyButton'
import { latestBy } from '../projects/_utils/workload'

type ActivityFilter = 'all' | 'active' | 'inactive'

export default function DashboardServicesPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [activity, setActivity] = useState<ActivityFilter>('all')
  const [projectFilter, setProjectFilter] = useState('all')

  const servicesQuery = useServiceList({ query: { limit: 100, offset: 0 } })
  const projectsQuery = useProjectList({ query: { limit: 100, offset: 0 } })
  const deploymentsQuery = useDeploymentList({ query: { limit: 100, offset: 0 } })
  const slow = useSlowLoading(servicesQuery.isLoading)

  const services = useMemo(() => servicesQuery.data?.data ?? [], [servicesQuery.data])
  const projectNames = useMemo(
    () => new Map((projectsQuery.data?.data ?? []).map((p) => [p.id, p.name])),
    [projectsQuery.data],
  )
  const serviceNames = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services])
  const latestByService = useMemo(
    () => latestBy(deploymentsQuery.data?.data ?? [], (d) => d.serviceId),
    [deploymentsQuery.data],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return services.filter((s) => {
      if (activity === 'active' && !s.isActive) return false
      if (activity === 'inactive' && s.isActive) return false
      if (projectFilter !== 'all' && s.projectId !== projectFilter) return false
      if (!q) return true
      return s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.type.toLowerCase().includes(q)
    })
  }, [services, search, activity, projectFilter])

  if (servicesQuery.error) {
    return (
      <PageErrorState
        title="Could not load services"
        message={errorReason(servicesQuery.error)}
        onRetry={() => void servicesQuery.refetch()}
      />
    )
  }

  if (servicesQuery.isLoading) {
    return (
      <div className="space-y-4">
        <PageSkeleton label="Loading services" blocks={1} />
        {slow ? (
          <p role="status" className="text-sm font-medium text-status-pending">
            Still loading — waiting on the platform API to return services. It may be starting.
          </p>
        ) : null}
      </div>
    )
  }

  const deployDataOk = !deploymentsQuery.isError
  const activeCount = services.filter((s) => s.isActive).length
  const lastOk = [...latestByService.values()].filter((d) => d.status === 'success').length
  const lastFailed = [...latestByService.values()].filter((d) => d.status === 'failed').length
  const filtered = search.trim() !== '' || activity !== 'all' || projectFilter !== 'all'
  const clear = () => { setSearch(''); setActivity('all'); setProjectFilter('all') }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workloads"
        title="Services"
        description="Every service of every project, with whether it is switched on and how its latest deployment went. Open one to deploy, configure or read its logs."
        badge={<ScopeLabel scope="mesh" />}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => { void servicesQuery.refetch(); void deploymentsQuery.refetch() }}
              disabled={servicesQuery.isFetching}
            >
              <RefreshCw className={`mr-1.5 size-4 ${servicesQuery.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              Refresh
            </Button>
            <Button asChild variant="outline">
              <AuthDashboardProjects.Link>Projects</AuthDashboardProjects.Link>
            </Button>
          </>
        }
      />

      {services.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No services yet"
          description="Services are created inside a project. Open a project and choose Create service."
          action={{ label: 'Go to projects', onClick: () => { router.push(AuthDashboardProjects()) } }}
        />
      ) : (
        <>
          <StatStrip>
            <StatStripItem label="Services" value={services.length} />
            <StatStripItem label="Switched on" value={activeCount} tone={activeCount > 0 ? 'live' : undefined} hint={`${String(services.length - activeCount)} off`} />
            <StatStripItem
              label="Last deploy succeeded"
              value={deployDataOk ? lastOk : undefined}
              hint={deployDataOk ? undefined : 'deployments unavailable'}
              tone={lastOk > 0 ? 'live' : undefined}
            />
            <StatStripItem
              label="Last deploy failed"
              value={deployDataOk ? lastFailed : undefined}
              tone={lastFailed > 0 ? 'danger' : undefined}
            />
          </StatStrip>

          <Card>
            <CardHeader>
              <CardTitle>All services</CardTitle>
              <CardDescription>{rows.length} of {services.length} shown. Sub-services are listed under their parent’s name.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-52 flex-1 md:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => { setSearch(event.target.value) }}
                    placeholder="Search by name, type or id"
                    className="pl-9"
                    aria-label="Search services"
                  />
                </div>
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger className="w-48" aria-label="Filter by project"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {[...projectNames.entries()].map(([id, name]) => (
                      <SelectItem key={id} value={id}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={activity} onValueChange={(v) => { setActivity(v as ActivityFilter) }}>
                  <SelectTrigger className="w-40" aria-label="Filter by switch"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">On and off</SelectItem>
                    <SelectItem value="active">Switched on</SelectItem>
                    <SelectItem value="inactive">Switched off</SelectItem>
                  </SelectContent>
                </Select>
                {filtered ? <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button> : null}
              </div>

              {rows.length === 0 ? (
                <FilteredEmptyState label="No service matches these filters." onClear={clear} />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>Service</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Switch</TableHead>
                        <TableHead>Latest deployment</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((s) => {
                        const deploy = latestByService.get(s.id)
                        const parentName = s.parentId ? serviceNames.get(s.parentId) : undefined
                        return (
                          <TableRow key={s.id} className="hover:bg-muted/40">
                            <TableCell>
                              <AuthDashboardProjectsProjectIdServicesServiceId.Link
                                projectId={s.projectId}
                                serviceId={s.id}
                                className="inline-flex items-center gap-1.5 font-medium hover:underline"
                              >
                                {s.parentId ? <GitBranch className="size-3.5 text-muted-foreground" aria-label="Sub-service" /> : null}
                                {s.name}
                              </AuthDashboardProjectsProjectIdServicesServiceId.Link>
                              {parentName ? <p className="text-sm text-muted-foreground">sub-service of {parentName}</p> : null}
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">{s.type}</Badge>
                                <IdChip id={s.id} label={`Copy id of ${s.name}`} />
                              </div>
                            </TableCell>
                            <TableCell>
                              {projectNames.get(s.projectId) ? (
                                <AuthDashboardProjectsProjectId.Link projectId={s.projectId} className="hover:underline">
                                  {projectNames.get(s.projectId)}
                                </AuthDashboardProjectsProjectId.Link>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={s.isActive ? 'active' : 'inactive'} />
                            </TableCell>
                            <TableCell>
                              {!deployDataOk ? (
                                <span className="text-muted-foreground">—</span>
                              ) : deploy ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge status={deploy.status} />
                                  <RelativeTime value={deploy.createdAt} className="text-sm text-muted-foreground" />
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">None in the latest runs</span>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
