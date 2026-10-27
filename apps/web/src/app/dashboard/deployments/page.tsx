'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AuthDashboardProjects } from '@/routes'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { RefreshCw, Rocket, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, PageErrorState, ScopeLabel, EmptyState, FilteredEmptyState, StatStrip, StatStripItem,
} from '@/components/dashboard'
import { PageSkeleton } from '@/components/dashboard/Skeletons'
import { useNow } from '@/components/dashboard/use-now'
import { useDeploymentList, useRetryDeployment } from '@/domains/deployment/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { useNodeScope } from '@/domains/node/node-context'
import { errorReason, useSlowLoading, InlineError } from '../projects/_components/workload/WorkloadStates'
import { summarizeDeployments } from '../projects/_utils/workload'
import {
  filterDeployments, hasActiveFilters, sortDeployments, type DeploymentSort, type StatusFilter,
} from '../projects/_utils/deployment-list'
import { DeploymentsTable, type ServiceRef } from './_components/deployments-table'

const WINDOW = 100

export default function DashboardDeploymentsPage() {
  const router = useRouter()
  const { nodeId, isNodeSelected } = useNodeScope()
  const now = useNow(30_000)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [environment, setEnvironment] = useState('all')
  const [sort, setSort] = useState<DeploymentSort>('newest')

  const deploymentInput = useMemo(
    () => ({
      query: {
        ...(nodeId ? { filter: { nodeId: { operator: 'eq' as const, value: nodeId } } } : {}),
        limit: WINDOW,
        offset: 0,
      },
    }),
    [nodeId],
  )
  const deploymentsQuery = useDeploymentList(deploymentInput)
  const servicesQuery = useServiceList({ query: { limit: 100, offset: 0 } })
  const retryDeployment = useRetryDeployment()
  const slow = useSlowLoading(deploymentsQuery.isLoading)

  const deployments = useMemo(() => deploymentsQuery.data?.data ?? [], [deploymentsQuery.data])
  const services = useMemo(
    () => new Map<string, ServiceRef>((servicesQuery.data?.data ?? []).map((s) => [s.id, { name: s.name, projectId: s.projectId }])),
    [servicesQuery.data],
  )
  const serviceName = useMemo(
    () => (id: string) => services.get(id)?.name ?? '',
    [services],
  )

  const filters = { search, status, environment }
  const rows = useMemo(
    () => sortDeployments(filterDeployments(deployments, filters, serviceName), sort, serviceName),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `filters` is rebuilt each render from the three primitives below
    [deployments, search, status, environment, sort, serviceName],
  )
  const summary = useMemo(() => summarizeDeployments(deployments), [deployments])

  if (deploymentsQuery.error) {
    return (
      <PageErrorState
        title="Could not load deployments"
        message={errorReason(deploymentsQuery.error)}
        onRetry={() => void deploymentsQuery.refetch()}
      />
    )
  }

  if (deploymentsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <PageSkeleton label="Loading deployments" blocks={1} />
        {slow ? (
          <p role="status" className="text-sm font-medium text-status-pending">
            Still loading — waiting on the platform API to return deployment runs. It may be starting.
          </p>
        ) : null}
      </div>
    )
  }

  const handleRetry = async (id: string) => {
    try {
      await retryDeployment.mutateAsync({ params: { id } })
      toast.success('Deployment queued again', { description: 'A new run was started from the failed one.' })
    } catch (err) {
      toast.error('Could not retry this deployment', { description: errorReason(err) })
    }
  }

  const clearFilters = () => {
    setSearch('')
    setStatus('all')
    setEnvironment('all')
  }
  const filtered = hasActiveFilters(filters)
  const scopeText = isNodeSelected ? 'on this node' : 'across the mesh'
  const windowFull = deployments.length >= WINDOW

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workloads"
        title="Deployments"
        description={`Every deployment run ${scopeText}, newest first. Open a service to see its logs and roll back.`}
        badge={<ScopeLabel scope={isNodeSelected ? 'node' : 'mesh'} />}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => void deploymentsQuery.refetch()}
              disabled={deploymentsQuery.isFetching}
            >
              <RefreshCw className={`mr-1.5 size-4 ${deploymentsQuery.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              Refresh
            </Button>
            <Button asChild variant="outline">
              <AuthDashboardProjects.Link>Projects</AuthDashboardProjects.Link>
            </Button>
          </>
        }
      />

      {servicesQuery.isError ? (
        <InlineError
          title="Service names could not be loaded"
          error={servicesQuery.error}
          onRetry={() => void servicesQuery.refetch()}
        />
      ) : null}

      {deployments.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title={isNodeSelected ? 'No deployments on this node yet' : 'No deployments yet'}
          description={
            isNodeSelected
              ? 'Nothing has been deployed to this node. Switch the scope to All nodes to see the rest of the mesh.'
              : 'Deployments appear here once a service is deployed. Open a project, pick a service and choose Deploy.'
          }
          action={{ label: 'Go to projects', onClick: () => { router.push(AuthDashboardProjects()) } }}
        />
      ) : (
        <>
          <StatStrip>
            <StatStripItem label="Runs" value={summary.total} hint={windowFull ? `latest ${String(WINDOW)}` : undefined} />
            <StatStripItem label="Succeeded" value={summary.success} tone={summary.success > 0 ? 'live' : undefined} />
            <StatStripItem label="Failed" value={summary.failed} tone={summary.failed > 0 ? 'danger' : undefined} />
            <StatStripItem label="In progress" value={summary.inProgress} tone={summary.inProgress > 0 ? 'busy' : undefined} />
            <StatStripItem
              label="Success rate"
              value={summary.successRate === null ? undefined : `${String(summary.successRate)}%`}
              hint={summary.successRate === null ? 'no finished runs yet' : 'of finished runs'}
            />
          </StatStrip>

          <Card>
            <CardHeader>
              <CardTitle>Runs</CardTitle>
              <CardDescription>
                {rows.length} of {deployments.length} shown
                {windowFull ? ` — only the latest ${String(WINDOW)} runs are loaded` : ''}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-52 flex-1 md:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => { setSearch(event.target.value) }}
                    placeholder="Search service, initiator or id"
                    className="pl-9"
                    aria-label="Search deployments"
                  />
                </div>
                <Select value={status} onValueChange={(v) => { setStatus(v as StatusFilter) }}>
                  <SelectTrigger className="w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="in-progress">In progress</SelectItem>
                    <SelectItem value="success">Succeeded</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger className="w-44" aria-label="Filter by environment"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All environments</SelectItem>
                    <SelectItem value="production">Production</SelectItem>
                    <SelectItem value="staging">Staging</SelectItem>
                    <SelectItem value="preview">Preview</SelectItem>
                    <SelectItem value="development">Development</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={(v) => { setSort(v as DeploymentSort) }}>
                  <SelectTrigger className="w-44" aria-label="Sort deployments"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                    <SelectItem value="service">Service (A–Z)</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                    <SelectItem value="environment">Environment</SelectItem>
                  </SelectContent>
                </Select>
                {filtered ? (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
                ) : null}
              </div>

              {rows.length === 0 ? (
                <FilteredEmptyState label="No deployment matches these filters." onClear={clearFilters} />
              ) : (
                <DeploymentsTable
                  rows={rows}
                  services={services}
                  now={now}
                  retryPending={retryDeployment.isPending}
                  onRetry={(id) => void handleRetry(id)}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
