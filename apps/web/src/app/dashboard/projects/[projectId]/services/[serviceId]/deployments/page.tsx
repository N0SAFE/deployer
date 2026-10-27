'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Rocket, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { useDockerContainerList } from '@/domains/docker/hooks'
import { useNow } from '@/components/dashboard/use-now'
import { EmptyState, EnvironmentBadge, FilteredEmptyState, StatusBadge } from '@/components/dashboard'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { ListLoading, InlineError, SectionHeading } from '../../../../_components/workload/WorkloadStates'
import { RelativeTime } from '../../../../_components/workload/RelativeTime'
import { IdChip } from '../../../../_components/workload/CopyButton'
import { deploymentDurationMs, deploymentStartedAt, formatDuration } from '../../../../_utils/workload'
import { filterDeployments, hasActiveFilters, sortDeployments, type StatusFilter } from '../../../../_utils/deployment-list'
import { DeploymentDetail } from './_components/deployment-detail'

const CONTAINER_INPUT = { query: { limit: 500, offset: 0 } } as const

/**
 * Service deployments: the runs of ONE service, and for the selected run its real
 * build/deploy output plus the containers currently serving that environment.
 */
export default function DashboardServiceDeploymentsPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId
  const now = useNow(30_000)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [environment, setEnvironment] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const deploymentsQuery = useDeploymentList({
    query: { filter: { serviceId: { operator: 'eq' as const, value: serviceId } }, limit: 100, offset: 0 },
  })
  const containersQuery = useDockerContainerList(CONTAINER_INPUT)

  const deployments = useMemo(() => deploymentsQuery.data?.data ?? [], [deploymentsQuery.data])
  const noName = (): string => ''
  const filters = { search, status, environment }
  const rows = useMemo(
    () => sortDeployments(filterDeployments(deployments, { search, status, environment }, noName), 'newest', noName),
    [deployments, search, status, environment],
  )
  const environments = useMemo(() => Array.from(new Set(deployments.map((d) => d.environment))).sort(), [deployments])

  // Default selection: the newest run that is still in the filtered list.
  const selected = rows.find((d) => d.id === selectedId) ?? rows[0] ?? null
  const replicas = useMemo(
    () => (containersQuery.data?.data ?? [])
      .filter((c) => c.projectId === projectId && c.serviceId === serviceId && (selected === null || c.environment === selected.environment)),
    [containersQuery.data, projectId, serviceId, selected],
  )

  const clear = () => { setSearch(''); setStatus('all'); setEnvironment('all') }

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Deployments"
        description="Every run of this service. Pick one to read its build and deploy output and see the containers serving it."
      />

      {deploymentsQuery.isError ? (
        <InlineError title="Could not load deployments" error={deploymentsQuery.error} onRetry={() => void deploymentsQuery.refetch()} />
      ) : null}
      {containersQuery.isError ? (
        <InlineError title="Could not load containers" error={containersQuery.error} onRetry={() => void containersQuery.refetch()} />
      ) : null}

      {deploymentsQuery.isLoading ? (
        <ListLoading label="Loading deployments" waitingOn="this service’s deployment history" columns={5} />
      ) : deploymentsQuery.isError ? null : deployments.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="This service has never been deployed"
          description="Runs appear here once the service is deployed from its project’s Deployments page, by a webhook or by a push to its branch."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runs</CardTitle>
              <CardDescription>{rows.length} of {deployments.length} shown</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-44 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => { setSearch(e.target.value) }} placeholder="Search id or initiator" className="pl-9" aria-label="Search deployments" />
                </div>
                <Select value={status} onValueChange={(v) => { setStatus(v as StatusFilter) }}>
                  <SelectTrigger className="w-36" aria-label="Filter by status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="in-progress">In progress</SelectItem>
                    <SelectItem value="success">Succeeded</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger className="w-40" aria-label="Filter by environment"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All environments</SelectItem>
                    {environments.map((env) => (<SelectItem key={env} value={env} className="capitalize">{env}</SelectItem>))}
                  </SelectContent>
                </Select>
                {hasActiveFilters(filters) ? <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button> : null}
              </div>

              {rows.length === 0 ? (
                <FilteredEmptyState label="No run matches these filters." onClear={clear} />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Environment</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead>Run</TableHead>
                        <TableHead className="text-right">Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((d) => {
                        const isSelected = selected?.id === d.id
                        return (
                          <TableRow key={d.id} data-state={isSelected ? 'selected' : undefined} className={cn('hover:bg-muted/40', isSelected && 'bg-primary/5')}>
                            <TableCell><StatusBadge status={d.status} /></TableCell>
                            <TableCell><EnvironmentBadge environment={d.environment} /></TableCell>
                            <TableCell><RelativeTime value={deploymentStartedAt(d)} className="text-sm text-muted-foreground" /></TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{formatDuration(deploymentDurationMs(d, d.status, now))}</TableCell>
                            <TableCell><IdChip id={d.id} label="Copy deployment id" /></TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant={isSelected ? 'secondary' : 'outline'}
                                aria-pressed={isSelected}
                                onClick={() => { setSelectedId(d.id) }}
                              >
                                {isSelected ? 'Shown' : 'View'}
                              </Button>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Run details</CardTitle>
              <CardDescription>{selected ? 'Output and containers of the selected run.' : 'No run selected.'}</CardDescription>
            </CardHeader>
            <CardContent>
              {selected ? (
                <DeploymentDetail
                  key={selected.id}
                  deployment={selected}
                  replicas={replicas}
                  projectId={projectId}
                  serviceId={serviceId}
                  now={now}
                />
              ) : (
                <EmptyState icon={Rocket} title="No run to show" description="Clear the filters to see this service’s runs." compact />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
