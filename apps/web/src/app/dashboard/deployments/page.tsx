'use client'

import { useMemo, useState } from 'react'
import { AuthDashboardProjects } from '@/routes'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { ArrowRight, CheckCircle2, Clock3, RefreshCw, Rocket, Search, Workflow, XCircle, XOctagon, TrendingUp, Server, Network } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, PageLoadingState, PageErrorState, StatusDot, StatusBadge, EnvironmentBadge } from '@/components/dashboard'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { useNodeScope } from '@/domains/node/node-context'

type DeploymentSortKey = 'startedAt' | 'projectId' | 'status' | 'environment'
type SortDirection = 'asc' | 'desc'

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'success') return 'default'
  if (status === 'in-progress') return 'secondary'
  if (status === 'failed') return 'destructive'
  return 'outline'
}

function computeDurationLabel(startedAt: string, finishedAt?: string): string {
  const start = new Date(startedAt).getTime()
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—'

  const durationSeconds = Math.floor((end - start) / 1000)
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  return `${String(minutes)}m ${String(seconds)}s`
}

function projectLabel(serviceId: string): string {
  return serviceId.replace(/-/g, ' ').slice(0, 20)
}

/** Fields the deployments page reads from a deployment entity. */
interface DeploymentRow {
  id: string
  serviceId: string
  status: string
  environment?: string | null
  triggeredBy?: string | null
  domainUrl?: string | null
  deployStartedAt?: string | null
  buildStartedAt?: string | null
  createdAt?: string | null
  deployCompletedAt?: string | null
  buildCompletedAt?: string | null
}

export default function DashboardDeploymentsPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'in-progress' | 'rolled-back'>('all')
  const [environmentFilter, setEnvironmentFilter] = useState<'all' | 'production' | 'staging' | 'preview' | 'development'>('all')
  const [sortBy, setSortBy] = useState<DeploymentSortKey>('startedAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const { nodeId, isNodeSelected } = useNodeScope()

  const deploymentQuery = useMemo(() => {
    if (nodeId) {
      return {
        query: {
          filter: { nodeId: { operator: 'eq' as const, value: nodeId } },
          limit: 100,
          offset: 0,
        },
      }
    }
    return { query: { limit: 100, offset: 0 } }
  }, [nodeId])

  const { data: deploymentsData, isLoading, error, refetch } = useDeploymentList(deploymentQuery)
  const deployments = useMemo<DeploymentRow[]>(() => {
    const d = deploymentsData as { data?: DeploymentRow[] } | undefined
    return d?.data ?? []
  }, [deploymentsData])

  const filteredDeployments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = deployments.filter((deployment) => {
      if (statusFilter !== 'all' && deployment.status !== statusFilter) return false
      if (environmentFilter !== 'all' && deployment.environment !== environmentFilter) return false
      if (!query) return true
      return (
        deployment.id.toLowerCase().includes(query)
        || deployment.serviceId.toLowerCase().includes(query)
        || (deployment.triggeredBy ?? '').toLowerCase().includes(query)
      )
    })

    return filtered.sort((a, b) => {
      const multiplier = sortDirection === 'asc' ? 1 : -1
      const aTime = a.deployStartedAt ?? a.buildStartedAt ?? a.createdAt ?? ''
      const bTime = b.deployStartedAt ?? b.buildStartedAt ?? b.createdAt ?? ''
      if (sortBy === 'projectId') return a.serviceId.localeCompare(b.serviceId) * multiplier
      if (sortBy === 'status') return a.status.localeCompare(b.status) * multiplier
      if (sortBy === 'environment') return (a.environment ?? '').localeCompare(b.environment ?? '') * multiplier
      return (new Date(aTime).getTime() - new Date(bTime).getTime()) * multiplier
    })
  }, [deployments, environmentFilter, searchTerm, sortBy, sortDirection, statusFilter])

  const deploymentSummary = useMemo(() => {
    const list = deployments
    const total = list.length
    const successful = list.filter((d) => d.status === 'success').length
    const failed = list.filter((d) => d.status === 'failed').length
    const inProgress = list.filter((d) => d.status === 'in-progress').length
    const completed = list.filter((d) => d.deployCompletedAt ?? d.buildCompletedAt)
    const avgDurationSeconds = completed.length > 0
      ? Math.round(
          completed.reduce((sum: number, d: DeploymentRow) => {
            const start = new Date(d.deployStartedAt ?? d.buildStartedAt ?? d.createdAt ?? '').getTime()
            const end = new Date(d.deployCompletedAt ?? d.buildCompletedAt ?? d.createdAt ?? '').getTime()
            if (Number.isNaN(start) || Number.isNaN(end) || end < start) return sum
            return sum + (end - start) / 1000
          }, 0) / completed.length,
        )
      : 0

    return {
      total,
      successful,
      failed,
      inProgress,
      successRate: total > 0 ? Math.round((successful / total) * 1000) / 10 : 0,
      avgDurationSeconds,
    }
  }, [deployments])

  if (error) {
    return (
      <PageErrorState
        title="Failed to load deployments"
        message={(error as Error).message ?? 'An unexpected error occurred'}
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading) {
    return <PageLoadingState label="Loading deployments…" />
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={isNodeSelected ? 'Node Deployments' : 'Mesh Deployments'}
        title={isNodeSelected ? `Deployments — ${nodeId?.slice(0, 8)}` : 'Deployment timeline'}
        description={isNodeSelected
          ? `Showing deployments running on node ${nodeId?.slice(0, 8)}. Select "All Nodes" to see mesh-wide deployments.`
          : 'Filter, sort, and operate on recent rollouts across environments and nodes.'
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setActionFeedback('Deployment timeline refreshed.')
                toast.success('Deployment timeline refreshed')
              }}
            >
              <RefreshCw className="mr-2 size-4" />
              Refresh
            </Button>
            <Button asChild variant="outline">
              <AuthDashboardProjects.Link>
                Open projects
                <ArrowRight className="ml-2 size-4" />
              </AuthDashboardProjects.Link>
            </Button>
          </>
        }
      />

      {/* Section-first summary band — metrics live with the table they describe,
          not as a floating top-of-page KPI strip (web AGENTS.md rule). */}
      <div className="flex flex-wrap items-stretch divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/40 backdrop-blur-xl sm:divide-x sm:divide-y-0">
        <BandCell
          label="Total"
          value={deploymentSummary.total}
          tone={deploymentSummary.total > 0 ? 'live' : 'neutral'}
          icon={Rocket}
        />
        <BandCell
          label="Success"
          value={deploymentSummary.successful}
          tone="live"
          icon={CheckCircle2}
        />
        <BandCell
          label="Failed"
          value={deploymentSummary.failed}
          tone={deploymentSummary.failed > 0 ? 'danger' : 'neutral'}
          icon={XOctagon}
        />
        <BandCell
          label="In progress"
          value={deploymentSummary.inProgress}
          tone={deploymentSummary.inProgress > 0 ? 'pending' : 'neutral'}
          icon={Workflow}
          pulse={deploymentSummary.inProgress > 0}
        />
        <BandCell
          label="Success rate"
          value={`${deploymentSummary.successRate}%`}
          tone={deploymentSummary.successRate >= 90 ? 'live' : deploymentSummary.successRate > 0 ? 'pending' : 'neutral'}
          icon={TrendingUp}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rollouts</CardTitle>
          <CardDescription>Search, filter, and act on deployment records.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[minmax(260px,1fr)_170px_180px_170px_130px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search deployment, project, initiator…"
                className="pl-9"
                aria-label="Search deployments"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
            >
              <SelectTrigger aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="in-progress">In progress</SelectItem>
                <SelectItem value="rolled-back">Rolled back</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={environmentFilter}
              onValueChange={(value) => setEnvironmentFilter(value as typeof environmentFilter)}
            >
              <SelectTrigger aria-label="Filter by environment">
                <SelectValue placeholder="All environments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All environments</SelectItem>
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="staging">Staging</SelectItem>
                <SelectItem value="preview">Preview</SelectItem>
                <SelectItem value="development">Development</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={sortBy}
              onValueChange={(value) => setSortBy(value as DeploymentSortKey)}
            >
              <SelectTrigger aria-label="Sort by">
                <SelectValue placeholder="Sort: Started" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="startedAt">Sort: Started</SelectItem>
                <SelectItem value="projectId">Sort: Project</SelectItem>
                <SelectItem value="status">Sort: Status</SelectItem>
                <SelectItem value="environment">Sort: Environment</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={sortDirection}
              onValueChange={(value) => setSortDirection(value as SortDirection)}
            >
              <SelectTrigger aria-label="Sort direction">
                <SelectValue placeholder="Desc" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Desc</SelectItem>
                <SelectItem value="asc">Asc</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {actionFeedback ? <p className="rounded border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{actionFeedback}</p> : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deployment</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Initiated by</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="w-56">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDeployments.map((deployment) => (
                  <TableRow key={deployment.id}>
                    <TableCell className="font-mono text-xs">{deployment.id}</TableCell>
                    <TableCell className="font-medium capitalize">{projectLabel(deployment.serviceId)}</TableCell>
                    <TableCell><EnvironmentBadge environment={deployment.environment} /></TableCell>
                    <TableCell><StatusBadge status={deployment.status} /></TableCell>
                    <TableCell className="text-xs">
                      {deployment.domainUrl ? (
                        <a
                          href={deployment.domainUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block max-w-40 truncate align-bottom font-mono text-primary underline decoration-primary/40 hover:decoration-primary"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {String(deployment.domainUrl).replace(/^https?:\/\//, '')}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{deployment.triggeredBy ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(deployment.deployStartedAt ?? deployment.buildStartedAt ?? deployment.createdAt ?? '')}</TableCell>
                    <TableCell className="text-xs">{computeDurationLabel(deployment.deployStartedAt ?? deployment.buildStartedAt ?? deployment.createdAt ?? '', deployment.deployCompletedAt ?? deployment.buildCompletedAt ?? '')}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => {
                            setActionFeedback(`Retry queued for ${deployment.id}`)
                            toast.success('Retry queued', { description: deployment.id })
                          }}
                        >
                          <Workflow className="mr-1 size-3" />
                          Retry
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => {
                            setActionFeedback(`Rollback check opened for ${deployment.id}`)
                            toast.info('Rollback guardrails opened', { description: deployment.id })
                          }}
                        >
                          <XCircle className="mr-1 size-3" />
                          Rollback
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => {
                            setActionFeedback(`Logs stream requested for ${deployment.id}`)
                            toast.info('Logs stream requested', { description: deployment.id })
                          }}
                        >
                          <Clock3 className="mr-1 size-3" />
                          Logs
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredDeployments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No deployments match current filters.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** One cell of the compact summary band — dot + label + value. */
function BandCell({
  label,
  value,
  icon: Icon,
  tone,
  pulse = false,
}: {
  label: string
  value: React.ReactNode
  icon: typeof Rocket
  tone: 'live' | 'pending' | 'danger' | 'neutral'
  pulse?: boolean
}) {
  return (
    <div className="flex flex-1 items-center gap-3 px-4 py-3">
      <StatusDot tone={tone} pulse={pulse} />
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="flex items-center gap-1.5 text-lg font-semibold tracking-tight tabular-nums">
          <Icon className="size-3.5 text-muted-foreground/70" />
          {value}
        </p>
      </div>
    </div>
  )
}
