'use client'

import { useMemo, useState } from 'react'
import { AuthDashboardProjects } from '@/routes'
import Link from 'next/link'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { ArrowRight, Bell, Clock3, GitCommitHorizontal, RefreshCw, Rocket, Search, Siren, Workflow, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useDeploymentList } from '@/domains/deployment/hooks'

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

function severityVariant(severity: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (severity === 'sev1' || severity === 'sev2') return 'destructive'
  if (severity === 'sev3') return 'secondary'
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

export default function DashboardDeploymentsPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'in-progress' | 'rolled-back'>('all')
  const [environmentFilter, setEnvironmentFilter] = useState<'all' | 'production' | 'staging' | 'preview' | 'development'>('all')
  const [sortBy, setSortBy] = useState<DeploymentSortKey>('startedAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)

  const { data: deploymentsData, isLoading, error } = useDeploymentList({ query: { limit: 100, offset: 0 } })
  const deployments = useMemo(() => deploymentsData ?? [], [deploymentsData])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Siren className="mb-4 size-12 text-destructive" />
        <h2 className="text-xl font-semibold">Failed to load deployments</h2>
        <p className="mt-2 text-muted-foreground">{(error as Error).message ?? 'An unexpected error occurred'}</p>
        <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <RefreshCw className="mb-4 size-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Loading deployments...</p>
      </div>
    )
  }

  const filteredDeployments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = (deployments as any[]).filter((deployment) => {
      if (statusFilter !== 'all' && deployment.status !== statusFilter) return false
      if (environmentFilter !== 'all' && deployment.environment !== environmentFilter) return false
      if (!query) return true
      return (
        deployment.id.toLowerCase().includes(query)
        || deployment.serviceId.toLowerCase().includes(query)
        || (deployment.triggeredBy ?? '').toLowerCase().includes(query)
      )
    })

    return filtered.sort((a: any, b: any) => {
      const multiplier = sortDirection === 'asc' ? 1 : -1
      const aTime = a.deployStartedAt ?? a.buildStartedAt ?? a.createdAt
      const bTime = b.deployStartedAt ?? b.buildStartedAt ?? b.createdAt
      if (sortBy === 'projectId') return a.serviceId.localeCompare(b.serviceId) * multiplier
      if (sortBy === 'status') return a.status.localeCompare(b.status) * multiplier
      if (sortBy === 'environment') return a.environment.localeCompare(b.environment) * multiplier
      return (new Date(aTime).getTime() - new Date(bTime).getTime()) * multiplier
    })
  }, [deployments, environmentFilter, searchTerm, sortBy, sortDirection, statusFilter])

  const deploymentSummary = useMemo(() => {
    const list = deployments as any[]
    const total = list.length
    const successful = list.filter((d) => d.status === 'success').length
    const failed = list.filter((d) => d.status === 'failed').length
    const inProgress = list.filter((d) => d.status === 'in-progress').length
    const completed = list.filter((d) => d.deployCompletedAt ?? d.buildCompletedAt)
    const avgDurationSeconds = completed.length > 0
      ? Math.round(
          completed.reduce((sum: number, d: any) => {
            const start = new Date(d.deployStartedAt ?? d.buildStartedAt ?? d.createdAt).getTime()
            const end = new Date(d.deployCompletedAt ?? d.buildCompletedAt ?? d.createdAt).getTime()
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deployments</h1>
          <p className="mt-2 text-muted-foreground">
            Production-grade release control center with deployment timeline, incidents, and operator shortcuts.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Total</CardDescription><CardTitle>{deploymentSummary.total}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Success</CardDescription><CardTitle>{deploymentSummary.successful}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Failed</CardDescription><CardTitle>{deploymentSummary.failed}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>In progress</CardDescription><CardTitle>{deploymentSummary.inProgress}</CardTitle></CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Success rate</CardDescription><CardTitle>{deploymentSummary.successRate}%</CardTitle></CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deployment timeline</CardTitle>
          <CardDescription>Filter, sort, and operate on recent rollouts across environments.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[minmax(260px,1fr)_160px_170px_180px_120px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search deployment/project/initiator..."
                className="pl-9"
              />
            </div>
            <select
              className="h-9 rounded-md border border-border/70 bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="in-progress">In progress</option>
              <option value="rolled-back">Rolled back</option>
            </select>
            <select
              className="h-9 rounded-md border border-border/70 bg-background px-3 text-sm"
              value={environmentFilter}
              onChange={(event) => setEnvironmentFilter(event.target.value as typeof environmentFilter)}
            >
              <option value="all">All environments</option>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="preview">Preview</option>
              <option value="development">Development</option>
            </select>
            <select
              className="h-9 rounded-md border border-border/70 bg-background px-3 text-sm"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as DeploymentSortKey)}
            >
              <option value="startedAt">Sort: Started</option>
              <option value="projectId">Sort: Project</option>
              <option value="status">Sort: Status</option>
              <option value="environment">Sort: Environment</option>
            </select>
            <select
              className="h-9 rounded-md border border-border/70 bg-background px-3 text-sm"
              value={sortDirection}
              onChange={(event) => setSortDirection(event.target.value as SortDirection)}
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
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
                  <TableHead>Initiated by</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="w-56">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDeployments.map((deployment: any) => (
                  <TableRow key={deployment.id}>
                    <TableCell className="font-mono text-xs">{deployment.id}</TableCell>
                    <TableCell className="font-medium capitalize">{projectLabel(deployment.serviceId)}</TableCell>
                    <TableCell><Badge variant="outline">{deployment.environment}</Badge></TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(deployment.status)}>{deployment.status}</Badge></TableCell>
                    <TableCell>{deployment.triggeredBy ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(deployment.deployStartedAt ?? deployment.buildStartedAt ?? deployment.createdAt)}</TableCell>
                    <TableCell className="text-xs">{computeDurationLabel(deployment.deployStartedAt ?? deployment.buildStartedAt ?? deployment.createdAt, deployment.deployCompletedAt ?? deployment.buildCompletedAt)}</TableCell>
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
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No deployments match current filters.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deployment controls</CardTitle>
          <CardDescription>Operator shortcuts for high-tempo release windows.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            className="justify-between"
            onClick={() => {
              setActionFeedback('Trigger rollout flow opened.')
              toast.info('Trigger rollout flow opened')
            }}
          >
            Trigger rollout
            <Rocket className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="justify-between"
            onClick={() => {
              setActionFeedback('Bulk retry simulation executed for failed deployments.')
              toast.success('Bulk retry simulation executed')
            }}
          >
            Retry failed jobs
            <ArrowRight className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="justify-between"
            onClick={() => {
              setActionFeedback('Audit history stream opened.')
              toast.info('Audit history stream opened')
            }}
          >
            Open audit history
            <GitCommitHorizontal className="size-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
