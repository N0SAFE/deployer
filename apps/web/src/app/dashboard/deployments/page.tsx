'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { ArrowRight, Bell, Clock3, GitCommitHorizontal, RefreshCw, Rocket, Search, Siren, Workflow, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { MOCK_DEPLOYMENTS, MOCK_INCIDENTS, MOCK_NOTIFICATIONS } from '@/mocks/platform/entities/operations.mock'

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

function projectLabel(projectId: string): string {
  return projectId.replace('proj-', '').replace(/-/g, ' ')
}

export default function DashboardDeploymentsPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'in-progress' | 'rolled-back'>('all')
  const [environmentFilter, setEnvironmentFilter] = useState<'all' | 'production' | 'staging' | 'preview' | 'development'>('all')
  const [sortBy, setSortBy] = useState<DeploymentSortKey>('startedAt')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)

  const deployments = useMemo(() => MOCK_DEPLOYMENTS, [])
  const incidents = useMemo(() => MOCK_INCIDENTS, [])
  const notifications = useMemo(() => MOCK_NOTIFICATIONS, [])

  const filteredDeployments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = deployments.filter((deployment) => {
      if (statusFilter !== 'all' && deployment.status !== statusFilter) return false
      if (environmentFilter !== 'all' && deployment.environment !== environmentFilter) return false
      if (!query) return true
      return (
        deployment.id.toLowerCase().includes(query)
        || deployment.projectId.toLowerCase().includes(query)
        || deployment.organizationId.toLowerCase().includes(query)
        || deployment.initiatedBy.toLowerCase().includes(query)
      )
    })

    return filtered.sort((a, b) => {
      const multiplier = sortDirection === 'asc' ? 1 : -1
      if (sortBy === 'projectId') return a.projectId.localeCompare(b.projectId) * multiplier
      if (sortBy === 'status') return a.status.localeCompare(b.status) * multiplier
      if (sortBy === 'environment') return a.environment.localeCompare(b.environment) * multiplier
      return (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()) * multiplier
    })
  }, [deployments, environmentFilter, searchTerm, sortBy, sortDirection, statusFilter])

  const deploymentSummary = useMemo(() => {
    const total = deployments.length
    const successful = deployments.filter((deployment) => deployment.status === 'success').length
    const failed = deployments.filter((deployment) => deployment.status === 'failed').length
    const inProgress = deployments.filter((deployment) => deployment.status === 'in-progress').length
    const completed = deployments.filter((deployment) => deployment.finishedAt)
    const avgDurationSeconds = completed.length > 0
      ? Math.round(
          completed.reduce((sum, deployment) => {
            const start = new Date(deployment.startedAt).getTime()
            const end = new Date(deployment.finishedAt ?? deployment.startedAt).getTime()
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
            <Link href="/dashboard/projects">
              Open projects
              <ArrowRight className="ml-2 size-4" />
            </Link>
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
                {filteredDeployments.map((deployment) => (
                  <TableRow key={deployment.id}>
                    <TableCell className="font-mono text-xs">{deployment.id}</TableCell>
                    <TableCell className="font-medium capitalize">{projectLabel(deployment.projectId)}</TableCell>
                    <TableCell><Badge variant="outline">{deployment.environment}</Badge></TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(deployment.status)}>{deployment.status}</Badge></TableCell>
                    <TableCell>{deployment.initiatedBy}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(deployment.startedAt)}</TableCell>
                    <TableCell className="text-xs">{computeDurationLabel(deployment.startedAt, deployment.finishedAt)}</TableCell>
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Siren className="size-4" /> Active incidents</CardTitle>
            <CardDescription>Operational incidents linked to deployment risk and release decisioning.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {incidents.map((incident) => (
              <div key={incident.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{incident.title}</p>
                  <Badge variant={severityVariant(incident.severity)}>{incident.severity}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{incident.id} · {incident.environment} · {incident.status}</p>
                <p className="mt-2 text-xs text-muted-foreground">Affected: {incident.affectedServiceIds.join(', ')}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Bell className="size-4" /> Notification stream</CardTitle>
            <CardDescription>Channel output for deployment events and incident alerts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {notifications.map((notification) => (
              <div key={notification.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{notification.message}</p>
                  <Badge variant={notification.level === 'critical' ? 'destructive' : notification.level === 'warning' ? 'secondary' : 'outline'}>
                    {notification.level}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{notification.channel} · {formatDate(notification.createdAt)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

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
