'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  MOCK_DEPENDENCIES_BY_PROJECT,
  MOCK_DEPLOYMENTS,
  MOCK_INCIDENTS,
  MOCK_NOTIFICATIONS,
  MOCK_PROJECTS,
  MOCK_SERVICE_CONFIGS_BY_PROJECT,
  MOCK_SERVICE_PROVIDERS_BY_PROJECT,
  MOCK_SERVICE_RUNNERS_BY_PROJECT,
  MOCK_SERVICES_BY_PROJECT,
} from '@/mocks/platform'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { ArrowRight, Bell, GitBranch, RefreshCw, Server, Siren, Workflow, Wrench } from 'lucide-react'
import { toast } from 'sonner'

const ENVIRONMENTS = ['production', 'staging', 'preview', 'development'] as const

type RuntimeFilter = 'all' | 'nodejs' | 'nestjs' | 'nextjs' | 'python' | 'go' | 'rust' | 'postgresql' | 'redis' | 'rabbitmq' | 'kafka' | 'nginx' | 'minio' | 's3' | 'composite'
type HealthFilter = 'all' | 'passing' | 'warning' | 'failing' | 'unknown'
type ServiceRow = {
  id: string
  projectId: string
  projectName: string
  name: string
  type: string
  runtime: string
  layer: number
  isActive: boolean
  role?: 'group'
  lifecycle: string
  health: string
  avgLatencyMs: number
  errorRatePercent: number
  providerType: string
  runnerType: string
  autoscaleEnabled: boolean
  minReplicas: number
  maxReplicas: number
  dependencyCount: number
  openIncidentCount: number
  latestDeploymentStatus: string
  latestNotificationLevel: string
}

function titleizeSlug(value: string): string {
  return value.replace(/^proj-/, '').replace(/-/g, ' ')
}

function healthBadgeVariant(health: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (health === 'passing') return 'default'
  if (health === 'warning') return 'secondary'
  if (health === 'failing') return 'destructive'
  return 'outline'
}

function lifecycleBadgeVariant(lifecycle: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (lifecycle === 'running') return 'default'
  if (lifecycle === 'degraded' || lifecycle === 'starting') return 'secondary'
  if (lifecycle === 'maintenance') return 'outline'
  return 'destructive'
}

export default function DashboardServicesPage() {
  const [environment, setEnvironment] = useState<(typeof ENVIRONMENTS)[number]>('production')
  const [searchQuery, setSearchQuery] = useState('')
  const [runtimeFilter, setRuntimeFilter] = useState<RuntimeFilter>('all')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')
  const [riskFilter, setRiskFilter] = useState<'all' | 'at-risk' | 'healthy'>('all')

  const services = useMemo(() => Object.values(MOCK_SERVICES_BY_PROJECT).flat(), [])
  const projectNameById = useMemo(
    () => new Map(MOCK_PROJECTS.map((project) => [project.id, project.name])),
    [],
  )

  const dependenciesByServiceId = useMemo(() => {
    const map = new Map<string, number>()
    for (const dependency of Object.values(MOCK_DEPENDENCIES_BY_PROJECT).flat()) {
      map.set(dependency.serviceId, (map.get(dependency.serviceId) ?? 0) + 1)
    }
    return map
  }, [])

  const openIncidentsByProjectId = useMemo(() => {
    const map = new Map<string, number>()
    for (const incident of MOCK_INCIDENTS) {
      if (incident.status !== 'open') continue
      map.set(incident.projectId, (map.get(incident.projectId) ?? 0) + 1)
    }
    return map
  }, [])

  const latestDeploymentStatusByProjectId = useMemo(() => {
    const map = new Map<string, { status: string; startedAt: string }>()
    for (const deployment of MOCK_DEPLOYMENTS) {
      const current = map.get(deployment.projectId)
      if (!current || new Date(deployment.startedAt).getTime() > new Date(current.startedAt).getTime()) {
        map.set(deployment.projectId, { status: deployment.status, startedAt: deployment.startedAt })
      }
    }
    return new Map(Array.from(map.entries()).map(([projectId, value]) => [projectId, value.status]))
  }, [])

  const latestNotificationLevelByProjectId = useMemo(() => {
    const map = new Map<string, { level: string; createdAt: string }>()
    for (const notification of MOCK_NOTIFICATIONS) {
      const current = map.get(notification.projectId)
      if (!current || new Date(notification.createdAt).getTime() > new Date(current.createdAt).getTime()) {
        map.set(notification.projectId, { level: notification.level, createdAt: notification.createdAt })
      }
    }
    return new Map(Array.from(map.entries()).map(([projectId, value]) => [projectId, value.level]))
  }, [])

  const serviceRows = useMemo<ServiceRow[]>(() => {
    return services.map((service) => {
      const config = MOCK_SERVICE_CONFIGS_BY_PROJECT[service.projectId]?.[service.id]
      const provider = MOCK_SERVICE_PROVIDERS_BY_PROJECT[service.projectId]?.[service.id]
      const runner = MOCK_SERVICE_RUNNERS_BY_PROJECT[service.projectId]?.[service.id]
      const status = config?.statusByEnvironment?.[environment]

      return {
        id: service.id,
        projectId: service.projectId,
        projectName: projectNameById.get(service.projectId) ?? titleizeSlug(service.projectId),
        name: service.name,
        type: service.type,
        runtime: service.runtime,
        layer: service.layer,
        isActive: service.isActive,
        role: service.role,
        lifecycle: status?.lifecycle ?? 'unknown',
        health: status?.health ?? 'unknown',
        avgLatencyMs: status?.averageLatencyMs ?? 0,
        errorRatePercent: status?.errorRatePercent ?? 0,
        providerType: provider?.type ?? config?.providerType ?? 'unknown',
        runnerType: runner?.type ?? config?.runnerType ?? 'unknown',
        autoscaleEnabled: config?.autoscaleEnabled ?? false,
        minReplicas: config?.minReplicas ?? 0,
        maxReplicas: config?.maxReplicas ?? 0,
        dependencyCount: dependenciesByServiceId.get(service.id) ?? 0,
        openIncidentCount: openIncidentsByProjectId.get(service.projectId) ?? 0,
        latestDeploymentStatus: latestDeploymentStatusByProjectId.get(service.projectId) ?? 'none',
        latestNotificationLevel: latestNotificationLevelByProjectId.get(service.projectId) ?? 'none',
      }
    })
  }, [dependenciesByServiceId, environment, latestDeploymentStatusByProjectId, latestNotificationLevelByProjectId, openIncidentsByProjectId, projectNameById, services])

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return serviceRows.filter((row) => {
      const atRisk = row.health === 'failing' || row.health === 'warning' || row.openIncidentCount > 0 || row.latestDeploymentStatus === 'failed'

      if (runtimeFilter !== 'all' && row.runtime !== runtimeFilter) return false
      if (healthFilter !== 'all' && row.health !== healthFilter) return false
      if (riskFilter === 'at-risk' && !atRisk) return false
      if (riskFilter === 'healthy' && atRisk) return false

      if (!query) return true
      return (
        row.name.toLowerCase().includes(query)
        || row.id.toLowerCase().includes(query)
        || row.projectName.toLowerCase().includes(query)
        || row.projectId.toLowerCase().includes(query)
        || row.runtime.toLowerCase().includes(query)
        || row.type.toLowerCase().includes(query)
      )
    })
  }, [healthFilter, riskFilter, runtimeFilter, searchQuery, serviceRows])

  const summary = useMemo(() => {
    const total = serviceRows.length
    const passing = serviceRows.filter((row) => row.health === 'passing').length
    const warning = serviceRows.filter((row) => row.health === 'warning').length
    const failing = serviceRows.filter((row) => row.health === 'failing').length
    const groupServices = serviceRows.filter((row) => row.role === 'group').length
    const autoscaled = serviceRows.filter((row) => row.autoscaleEnabled).length
    return { total, passing, warning, failing, groupServices, autoscaled }
  }, [serviceRows])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Services</h1>
          <p className="mt-2 text-muted-foreground">
            Comprehensive service operations dashboard with lifecycle, health, dependency, provider, and runner visibility.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              toast.success('Service dashboard refreshed')
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Card><CardHeader className="pb-2"><CardDescription>Total services</CardDescription><CardTitle>{summary.total}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Passing</CardDescription><CardTitle>{summary.passing}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Warning</CardDescription><CardTitle>{summary.warning}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Failing</CardDescription><CardTitle>{summary.failing}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Group services</CardDescription><CardTitle>{summary.groupServices}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Autoscaled</CardDescription><CardTitle>{summary.autoscaled}</CardTitle></CardHeader></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Service inventory and health</CardTitle>
          <CardDescription>All service cases from entity-contract mocks across runtime, lifecycle, and topology dimensions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[minmax(260px,1fr)_160px_180px_130px_130px]">
            <Input
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
              }}
              placeholder="Search service/project/runtime..."
            />
            <select
              className="h-9 rounded-md border border-border/70 bg-background px-3 text-sm"
              value={environment}
              onChange={(event) => {
                setEnvironment(event.target.value as (typeof ENVIRONMENTS)[number])
              }}
            >
              {ENVIRONMENTS.map((env) => (
                <option key={env} value={env}>{env}</option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-border/70 bg-background px-3 text-sm"
              value={runtimeFilter}
              onChange={(event) => {
                setRuntimeFilter(event.target.value as RuntimeFilter)
              }}
            >
              <option value="all">All runtimes</option>
              <option value="nodejs">nodejs</option>
              <option value="nestjs">nestjs</option>
              <option value="nextjs">nextjs</option>
              <option value="python">python</option>
              <option value="go">go</option>
              <option value="rust">rust</option>
              <option value="postgresql">postgresql</option>
              <option value="redis">redis</option>
              <option value="rabbitmq">rabbitmq</option>
              <option value="kafka">kafka</option>
              <option value="nginx">nginx</option>
              <option value="minio">minio</option>
              <option value="s3">s3</option>
              <option value="composite">composite</option>
            </select>
            <select
              className="h-9 rounded-md border border-border/70 bg-background px-3 text-sm"
              value={healthFilter}
              onChange={(event) => {
                setHealthFilter(event.target.value as HealthFilter)
              }}
            >
              <option value="all">All health</option>
              <option value="passing">passing</option>
              <option value="warning">warning</option>
              <option value="failing">failing</option>
              <option value="unknown">unknown</option>
            </select>
            <select
              className="h-9 rounded-md border border-border/70 bg-background px-3 text-sm"
              value={riskFilter}
              onChange={(event) => {
                setRiskFilter(event.target.value as 'all' | 'at-risk' | 'healthy')
              }}
            >
              <option value="all">All risk</option>
              <option value="at-risk">At risk</option>
              <option value="healthy">Healthy</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline"><Server className="mr-1 size-3" /> {filteredRows.length} visible</Badge>
            <Badge variant="outline"><Workflow className="mr-1 size-3" /> env: {environment}</Badge>
            <Badge variant={summary.failing > 0 ? 'destructive' : 'secondary'}><Siren className="mr-1 size-3" /> {summary.failing} failing</Badge>
            <Badge variant={summary.warning > 0 ? 'secondary' : 'outline'}><Wrench className="mr-1 size-3" /> {summary.warning} warning</Badge>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Layer</TableHead>
                  <TableHead>Runtime</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Lifecycle</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Error rate</TableHead>
                  <TableHead>Scaling</TableHead>
                  <TableHead>Deps</TableHead>
                  <TableHead>Signals</TableHead>
                  <TableHead className="w-52">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{row.name}</p>
                        <p className="text-xs text-muted-foreground">{row.id} · {row.type}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{row.projectName}</p>
                        <p className="text-xs text-muted-foreground">{row.projectId}</p>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline">L{String(row.layer)}</Badge></TableCell>
                    <TableCell>{row.runtime}</TableCell>
                    <TableCell><Badge variant={healthBadgeVariant(row.health)}>{row.health}</Badge></TableCell>
                    <TableCell><Badge variant={lifecycleBadgeVariant(row.lifecycle)}>{row.lifecycle}</Badge></TableCell>
                    <TableCell>{row.avgLatencyMs}ms</TableCell>
                    <TableCell>{row.errorRatePercent}%</TableCell>
                    <TableCell>
                      <p className="text-xs">{row.autoscaleEnabled ? 'auto' : 'manual'} · {row.minReplicas}-{row.maxReplicas}</p>
                      <p className="text-xs text-muted-foreground">{row.providerType} / {row.runnerType}</p>
                    </TableCell>
                    <TableCell>{row.dependencyCount}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-xs">incidents: {row.openIncidentCount}</p>
                        <p className="text-xs">deploy: {row.latestDeploymentStatus}</p>
                        <p className="text-xs">notify: {row.latestNotificationLevel}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => {
                            toast.info('Service diagnostics opened', { description: row.id })
                          }}
                        >
                          <GitBranch className="mr-1 size-3" />
                          Diagnostics
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => {
                            toast.success('Redeploy simulation started', { description: row.id })
                          }}
                        >
                          <RefreshCw className="mr-1 size-3" />
                          Redeploy
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">No services match current filters.</TableCell>
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
            <CardTitle>Provider distribution</CardTitle>
            <CardDescription>Source providers used by current service set.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Array.from(new Map(filteredRows.map((row) => [row.providerType, 0])).keys()).map((providerType) => {
              const count = filteredRows.filter((row) => row.providerType === providerType).length
              return (
                <Badge key={providerType} variant="outline">{providerType}: {count}</Badge>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Runner distribution</CardTitle>
            <CardDescription>Execution backends active in the selected scope.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Array.from(new Map(filteredRows.map((row) => [row.runnerType, 0])).keys()).map((runnerType) => {
              const count = filteredRows.filter((row) => row.runnerType === runnerType).length
              return (
                <Badge key={runnerType} variant="outline">{runnerType}: {count}</Badge>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cross-surface shortcuts</CardTitle>
          <CardDescription>Jump to related control-plane areas.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Button asChild variant="outline" className="justify-between">
            <Link href="/dashboard/deployments">
              Global deployments
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="justify-between">
            <Link href="/dashboard/projects">
              Project operations
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="justify-between"
            onClick={() => {
              toast.info('Incident command center shortcut triggered')
            }}
          >
            Incident command
            <Bell className="size-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
