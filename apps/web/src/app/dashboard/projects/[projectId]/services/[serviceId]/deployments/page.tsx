'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  getMockContainerInspectDetail,
  getMockContainerLogs,
  getMockContainerMetrics,
  getMockImagePullScanPipeline,
import {
  useDockerContainerList,
  useDockerDeploymentList,
  useDockerFleetServers,
} from '@/domains/docker/hooks'
import {
  AuthDashboardProjectsProjectIdServicesServiceId,
  AuthDashboardProjectsProjectIdServicesServiceIdLogs,
} from '@/routes'
import { ServiceSectionNav } from '../_components/service-section-nav'
import { DockerSelectionToggle } from '@/app/dashboard/docker/_components/docker-page-utilities'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { ScrollArea } from '@repo/ui/components/shadcn/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { ArrowLeft, Search } from 'lucide-react'
import type {
  DockerContainer,
  DockerContainerLogEntry,
  DockerContainerMetricPoint,
  DockerFleetServer,
} from '@repo/contracts-entities'

const LIST_INPUT = {
  query: {
    limit: 600,
    offset: 0,
  },
} as const

type DateRangePreset = 'all' | '24h' | '7d' | '30d'

interface ServiceItem {
  id: string
  name: string
}

interface ProjectItem {
  id: string
}

interface ReplicaMetricProjection {
  currentCpu: number | null
  currentMemory: number | null
  avgCpu: number | null
  avgMemory: number | null
  networkRxKb: number | null
  networkTxKb: number | null
  ioReadKb: number | null
  ioWriteKb: number | null
  timeline: DockerContainerMetricPoint[]
}

interface DeploymentMetricProjection {
  runningReplicas: number
  healthyReplicas: number
  totalRestarts: number
  avgCpu: number | null
  avgMemory: number | null
  peakCpu: number | null
  peakMemory: number | null
  networkRxKb: number | null
  networkTxKb: number | null
}

interface DeploymentLite {
  id: string
  serviceId: string
  triggeredBy: string | null
  status: 'success' | 'failed' | 'pending' | 'queued' | 'building' | 'deploying' | 'cancelled'
  environment: 'production' | 'preview' | 'development' | 'staging'
  sourceType: string
  containerName: string | null
  containerImage: string | null
  healthCheckUrl: string | null
  domainUrl: string | null
  updatedAt: string
}

interface DeploymentRowProjection {
  deployment: DeploymentLite
  replicas: DockerContainer[]
  metrics: DeploymentMetricProjection
}

interface BuilderLogProjection {
  id: string
  at: string
  layerInstruction: string
  status: string
  progress: number
  message: string
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)}%`
}

function toBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.toLowerCase()
  if (normalized === 'success' || normalized === 'running' || normalized === 'healthy') return 'default'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'dead' || normalized === 'exited') return 'destructive'
  if (normalized === 'pending' || normalized === 'queued' || normalized === 'building' || normalized === 'deploying') return 'secondary'
  return 'outline'
}

function hashText(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function resolveDateRangeCutoff(range: DateRangePreset): number | null {
  const now = Date.now()
  if (range === '24h') return now - 24 * 60 * 60 * 1000
  if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000
  if (range === '30d') return now - 30 * 24 * 60 * 60 * 1000
  return null
}

function parseDateBoundary(value: string, boundary: 'start' | 'end'): number | null {
  if (!value) return null
  const suffix = boundary === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'
  const parsed = new Date(`${value}${suffix}`).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function selectReplicasForDeployment(
  deployment: DeploymentLite,
  serviceContainers: DockerContainer[],
): DockerContainer[] {
  const sameEnvironment = serviceContainers.filter((container) => container.environment === deployment.environment)
  if (sameEnvironment.length > 0) {
    return sameEnvironment
  }
  return serviceContainers
}

function buildReplicaMetrics(replica: DockerContainer): ReplicaMetricProjection {
  const timeline = getMockContainerMetrics(replica.id)
  const latestPoint = timeline.at(-1) ?? null

  if (timeline.length === 0) {
    return {
      currentCpu: replica.cpuPercent,
      currentMemory: replica.memoryPercent,
      avgCpu: replica.cpuPercent,
      avgMemory: replica.memoryPercent,
      networkRxKb: null,
      networkTxKb: null,
      ioReadKb: null,
      ioWriteKb: null,
      timeline,
    }
  }

  const cpuTotal = timeline.reduce((sum, point) => sum + point.cpu, 0)
  const memoryTotal = timeline.reduce((sum, point) => sum + point.memory, 0)
  const rxTotal = timeline.reduce((sum, point) => sum + point.networkRxKb, 0)
  const txTotal = timeline.reduce((sum, point) => sum + point.networkTxKb, 0)
  const ioReadTotal = timeline.reduce((sum, point) => sum + point.ioReadKb, 0)
  const ioWriteTotal = timeline.reduce((sum, point) => sum + point.ioWriteKb, 0)

  return {
    currentCpu: latestPoint?.cpu ?? replica.cpuPercent,
    currentMemory: latestPoint?.memory ?? replica.memoryPercent,
    avgCpu: cpuTotal / timeline.length,
    avgMemory: memoryTotal / timeline.length,
    networkRxKb: rxTotal / timeline.length,
    networkTxKb: txTotal / timeline.length,
    ioReadKb: ioReadTotal / timeline.length,
    ioWriteKb: ioWriteTotal / timeline.length,
    timeline,
  }
}

function aggregateDeploymentMetrics(replicas: DockerContainer[]): DeploymentMetricProjection {
  if (replicas.length === 0) {
    return {
      runningReplicas: 0,
      healthyReplicas: 0,
      totalRestarts: 0,
      avgCpu: null,
      avgMemory: null,
      peakCpu: null,
      peakMemory: null,
      networkRxKb: null,
      networkTxKb: null,
    }
  }

  const replicaMetrics = replicas.map((replica) => buildReplicaMetrics(replica))

  const cpuValues = replicaMetrics
    .map((metric) => metric.currentCpu)
    .filter((value): value is number => value !== null)
  const memoryValues = replicaMetrics
    .map((metric) => metric.currentMemory)
    .filter((value): value is number => value !== null)
  const rxValues = replicaMetrics
    .map((metric) => metric.networkRxKb)
    .filter((value): value is number => value !== null)
  const txValues = replicaMetrics
    .map((metric) => metric.networkTxKb)
    .filter((value): value is number => value !== null)

  const avgCpu = cpuValues.length > 0 ? cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length : null
  const avgMemory =
    memoryValues.length > 0 ? memoryValues.reduce((sum, value) => sum + value, 0) / memoryValues.length : null
  const peakCpu = cpuValues.length > 0 ? Math.max(...cpuValues) : null
  const peakMemory = memoryValues.length > 0 ? Math.max(...memoryValues) : null
  const networkRxKb = rxValues.length > 0 ? rxValues.reduce((sum, value) => sum + value, 0) : null
  const networkTxKb = txValues.length > 0 ? txValues.reduce((sum, value) => sum + value, 0) : null

  return {
    runningReplicas: replicas.filter((replica) => replica.status === 'running').length,
    healthyReplicas: replicas.filter((replica) => replica.health === 'healthy').length,
    totalRestarts: replicas.reduce((sum, replica) => sum + replica.restartCount, 0),
    avgCpu,
    avgMemory,
    peakCpu,
    peakMemory,
    networkRxKb,
    networkTxKb,
  }
}

function buildBuilderLogs(deploymentId: string, replicaName: string, imageRef: string): BuilderLogProjection[] {
  const pipeline = getMockImagePullScanPipeline(imageRef)

  return pipeline.layers.flatMap((layer) => {
    return layer.events.map((event) => ({
      id: `${deploymentId}-${replicaName}-${layer.id}-${event.status}-${event.at}`,
      at: event.at,
      layerInstruction: layer.instruction,
      status: event.status,
      progress: event.progress,
      message: event.message,
    }))
  })
}

function resolveReplicaHost(replicaId: string, servers: DockerFleetServer[]): DockerFleetServer | null {
  if (servers.length === 0) return null
  const index = hashText(replicaId) % servers.length
  return servers[index] ?? null
}

function createDeploymentLogsSearch(
  deploymentId: string,
  replicaNames: string[],
): {
  deploymentId: string
  source: 'deployment'
  replicas?: string
} {
  const replicas = replicaNames.join(',')

  return replicas.length > 0
    ? {
        deploymentId,
        source: 'deployment',
        replicas,
      }
    : {
        deploymentId,
        source: 'deployment',
      }
}

function createReplicaLogsSearch(
  deploymentId: string,
  replicaId: string,
  replicaName: string,
): {
  deploymentId: string
  replicaId: string
  source: 'replica'
  replicas: string
} {
  return {
    deploymentId,
    replicaId,
    source: 'replica',
    replicas: replicaName,
  }
}

export default function DashboardServiceDeploymentsPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const [searchTerm, setSearchTerm] = useState('')
  const [environmentFilter, setEnvironmentFilter] = useState<'all' | DeploymentLite['environment']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | DeploymentLite['status']>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | DeploymentLite['sourceType']>('all')
  const [dateRange, setDateRange] = useState<DateRangePreset>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null)
  const [selectedReplicaId, setSelectedReplicaId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<'overview' | 'replicas' | 'logs'>('overview')
  const [logsTab, setLogsTab] = useState<'provider' | 'builder' | 'runner'>('provider')

  const project = useMemo<ProjectItem | null>(
    [projectId],
  )
  const service = useMemo(() => services.find((item: ServiceItem) => item.id === serviceId) ?? null, [serviceId, services])

  const { data: deploymentData } = useDockerDeploymentList(LIST_INPUT)
  const { data: containerData } = useDockerContainerList(LIST_INPUT)
  const { data: fleetData } = useDockerFleetServers()

  const allDeployments = useMemo(() => (deploymentData?.data ?? []) as DeploymentLite[], [deploymentData?.data])
  const allContainers = useMemo(() => containerData?.data ?? [], [containerData?.data])
  const fleetServers = useMemo(() => fleetData?.items ?? [], [fleetData?.items])

  const serviceDeployments = useMemo(() => {
    return allDeployments
      .filter((deployment) => deployment.serviceId === serviceId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [allDeployments, serviceId])

  const serviceContainers = useMemo(() => {
    return allContainers
      .filter((container) => container.projectId === projectId && container.serviceId === serviceId)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allContainers, projectId, serviceId])

  const deploymentsById = useMemo(() => {
    return new Map(serviceDeployments.map((deployment) => [deployment.id, deployment]))
  }, [serviceDeployments])

  const replicasByDeploymentId = useMemo(() => {
    const map = new Map<string, DockerContainer[]>()
    for (const deployment of serviceDeployments) {
      map.set(deployment.id, selectReplicasForDeployment(deployment, serviceContainers))
    }
    return map
  }, [serviceContainers, serviceDeployments])

  const environmentValues = useMemo(() => {
    return Array.from(new Set(serviceDeployments.map((deployment) => deployment.environment)))
  }, [serviceDeployments])

  const statusValues = useMemo(() => {
    return Array.from(new Set(serviceDeployments.map((deployment) => deployment.status)))
  }, [serviceDeployments])

  const sourceValues = useMemo(() => {
    return Array.from(new Set(serviceDeployments.map((deployment) => deployment.sourceType)))
  }, [serviceDeployments])

  const filteredDeployments = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    const rangeCutoff = resolveDateRangeCutoff(dateRange)
    const fromBoundary = parseDateBoundary(dateFrom, 'start')
    const toBoundary = parseDateBoundary(dateTo, 'end')

    return serviceDeployments.filter((deployment) => {
      if (environmentFilter !== 'all' && deployment.environment !== environmentFilter) return false
      if (statusFilter !== 'all' && deployment.status !== statusFilter) return false
      if (sourceFilter !== 'all' && deployment.sourceType !== sourceFilter) return false

      const deploymentUpdatedAt = new Date(deployment.updatedAt).getTime()

      if (rangeCutoff !== null && deploymentUpdatedAt < rangeCutoff) return false
      if (fromBoundary !== null && deploymentUpdatedAt < fromBoundary) return false
      if (toBoundary !== null && deploymentUpdatedAt > toBoundary) return false

      if (!normalizedSearch) return true

      const containerName = deployment.containerName ?? ''
      const image = deployment.containerImage ?? ''

      return (
        deployment.id.toLowerCase().includes(normalizedSearch)
        || deployment.environment.toLowerCase().includes(normalizedSearch)
        || deployment.status.toLowerCase().includes(normalizedSearch)
        || deployment.sourceType.toLowerCase().includes(normalizedSearch)
        || containerName.toLowerCase().includes(normalizedSearch)
        || image.toLowerCase().includes(normalizedSearch)
      )
    })
  }, [dateFrom, dateRange, dateTo, environmentFilter, searchTerm, serviceDeployments, sourceFilter, statusFilter])

  const deploymentRows = useMemo<DeploymentRowProjection[]>(() => {
    return filteredDeployments.map((deployment) => {
      const replicas = replicasByDeploymentId.get(deployment.id) ?? []
      return {
        deployment,
        replicas,
        metrics: aggregateDeploymentMetrics(replicas),
      }
    })
  }, [filteredDeployments, replicasByDeploymentId])

  const selectedDeployment = useMemo(() => {
    if (!selectedDeploymentId) return null

    const selected = deploymentsById.get(selectedDeploymentId)
    if (!selected) return null

    return filteredDeployments.some((deployment) => deployment.id === selected.id) ? selected : null
  }, [deploymentsById, filteredDeployments, selectedDeploymentId])

  const selectedDeploymentReplicas = useMemo(() => {
    if (!selectedDeployment) return []
    return replicasByDeploymentId.get(selectedDeployment.id) ?? []
  }, [replicasByDeploymentId, selectedDeployment])

  const selectedDeploymentMetrics = useMemo(() => {
    return aggregateDeploymentMetrics(selectedDeploymentReplicas)
  }, [selectedDeploymentReplicas])

  const selectedReplica = useMemo(() => {
    if (!selectedReplicaId) return null
    return selectedDeploymentReplicas.find((replica) => replica.id === selectedReplicaId) ?? null
  }, [selectedDeploymentReplicas, selectedReplicaId])

  const selectedReplicaLogs = useMemo<DockerContainerLogEntry[]>(() => {
    if (!selectedReplica) return []
    return getMockContainerLogs(selectedReplica.id)
  }, [selectedReplica])

  const selectedReplicaInspect = useMemo(() => {
    if (!selectedReplica) return null
    return getMockContainerInspectDetail(selectedReplica)
  }, [selectedReplica])

  const selectedReplicaHost = useMemo(() => {
    if (!selectedReplica) return null
    return resolveReplicaHost(selectedReplica.id, fleetServers)
  }, [fleetServers, selectedReplica])

  const providerPipeline = useMemo(() => {
    if (!selectedDeployment) return null
    const fallbackImage = `ghcr.io/mock/${projectId}/${serviceId}:latest`
    return getMockImagePullScanPipeline(selectedDeployment.containerImage ?? fallbackImage)
  }, [projectId, selectedDeployment, serviceId])

  const selectedReplicaBuilderLogs = useMemo<BuilderLogProjection[]>(() => {
    if (!selectedReplica || !providerPipeline || !selectedDeployment) return []

    return buildBuilderLogs(
      selectedDeployment.id,
      selectedReplica.name,
      providerPipeline.imageRef,
    ).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [providerPipeline, selectedDeployment, selectedReplica])

  const deploymentLogsSearch = useMemo(() => {
    if (!selectedDeployment) return null

    return createDeploymentLogsSearch(
      selectedDeployment.id,
      selectedDeploymentReplicas.map((replica) => replica.name),
    )
  }, [selectedDeployment, selectedDeploymentReplicas])

  const replicaLogsSearch = useMemo(() => {
    if (!selectedDeployment || !selectedReplica) return null

    return createReplicaLogsSearch(
      selectedDeployment.id,
      selectedReplica.id,
      selectedReplica.name,
    )
  }, [selectedDeployment, selectedReplica])

  const hasDeploymentSelection = selectedDeployment !== null
  const hasReplicaSelection = selectedReplica !== null

  const providerRawLines = useMemo(() => {
    return (providerPipeline?.pullLogs ?? []).map((line) => {
      return `[${formatDate(line.at)}] [${line.component}] [${line.level}] ${line.message}`
    })
  }, [providerPipeline?.pullLogs])

  const builderRawLines = useMemo(() => {
    return selectedReplicaBuilderLogs.map((line) => {
      return `[${formatDate(line.at)}] [${line.status}] [${line.progress.toFixed(0)}%] ${line.layerInstruction} — ${line.message}`
    })
  }, [selectedReplicaBuilderLogs])

  const runnerRawLines = useMemo(() => {
    return selectedReplicaLogs.map((line) => {
      return `[${formatDate(line.timestamp)}] [${line.stream}] [${line.level}] ${line.message}`
    })
  }, [selectedReplicaLogs])

  if (!project) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Project not found</AlertTitle>
        <AlertDescription>This project does not exist in the mock entities dataset.</AlertDescription>
      </Alert>
    )
  }

  if (!service) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Service not found</AlertTitle>
        <AlertDescription>This service does not exist in the selected project mock dataset.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <AuthDashboardProjectsProjectIdServicesServiceId.Link projectId={projectId} serviceId={serviceId}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to service
          </AuthDashboardProjectsProjectIdServicesServiceId.Link>
        </Button>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Service deployments</h1>
          <p className="text-sm text-muted-foreground">
            Filter deployments, inspect replica health + metrics, and follow provider/build/runner log workflow from one place.
          </p>
        </div>
      </div>

      <ServiceSectionNav projectId={projectId} serviceId={serviceId} active="deployments" />

      <div className="rounded-xl border border-border/60 bg-card/35 p-3 backdrop-blur-xl">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_170px_170px_140px_130px_130px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value)
              }}
              className="h-9 border-border/70 bg-background/70 pl-9"
              placeholder="Search id, image, env, status..."
            />
          </div>

          <select
            className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
            value={environmentFilter}
            onChange={(event) => {
              setEnvironmentFilter(event.target.value as 'all' | DeploymentLite['environment'])
            }}
          >
            <option value="all">All envs</option>
            {environmentValues.map((environment) => (
              <option key={environment} value={environment}>{environment}</option>
            ))}
          </select>

          <select
            className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as 'all' | DeploymentLite['status'])
            }}
          >
            <option value="all">All status</option>
            {statusValues.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>

          <select
            className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
            value={sourceFilter}
            onChange={(event) => {
              setSourceFilter(event.target.value as 'all' | DeploymentLite['sourceType'])
            }}
          >
            <option value="all">All sources</option>
            {sourceValues.map((source) => (
              <option key={source} value={source}>{source}</option>
            ))}
          </select>

          <select
            className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
            value={dateRange}
            onChange={(event) => {
              setDateRange(event.target.value as DateRangePreset)
            }}
          >
            <option value="all">Date: all</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
            <option value="30d">Last 30d</option>
          </select>

          <Input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value)
            }}
            className="h-9 border-border/70 bg-background/70"
            aria-label="From date"
          />

          <Input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value)
            }}
            className="h-9 border-border/70 bg-background/70"
            aria-label="To date"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{filteredDeployments.length} deployments</Badge>
          <Badge variant="outline">{selectedDeploymentReplicas.length} replicas in selection</Badge>
          <Badge variant="outline">{serviceContainers.length} replicas total</Badge>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="border-border/60 bg-card/45 backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Deployments list</CardTitle>
            <CardDescription>
              Click a deployment to inspect replica state, metrics, and workflow logs.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-2">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <DockerSelectionToggle
                        ariaLabel="Toggle deployment selection"
                        shape="round"
                        pressed={hasDeploymentSelection}
                        onPressedChange={(pressed) => {
                          if (pressed) {
                            const firstDeploymentId = deploymentRows[0]?.deployment.id ?? null
                            setSelectedDeploymentId(firstDeploymentId)
                            setSelectedReplicaId(null)
                            return
                          }

                          setSelectedDeploymentId(null)
                          setSelectedReplicaId(null)
                        }}
                      />
                    </TableHead>
                    <TableHead>Deployment</TableHead>
                    <TableHead>Env</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Replicas</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Logs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deploymentRows.map((row) => {
                    const isSelected = selectedDeployment?.id === row.deployment.id
                    const deploymentLogSearch = createDeploymentLogsSearch(
                      row.deployment.id,
                      row.replicas.map((replica) => replica.name),
                    )

                    return (
                      <TableRow
                        key={row.deployment.id}
                        className={cn('cursor-pointer hover:bg-muted/35', isSelected ? 'bg-primary/8' : undefined)}
                        onClick={() => {
                          setSelectedDeploymentId(row.deployment.id)
                          setSelectedReplicaId(null)
                        }}
                      >
                        <TableCell>
                          <DockerSelectionToggle
                            ariaLabel={`Select deployment ${shortId(row.deployment.id)}`}
                            shape="round"
                            pressed={isSelected}
                            onPressedChange={(pressed) => {
                              if (pressed) {
                                setSelectedDeploymentId(row.deployment.id)
                                setSelectedReplicaId(null)
                                return
                              }

                              setSelectedDeploymentId(null)
                              setSelectedReplicaId(null)
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">{shortId(row.deployment.id)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.deployment.environment}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={toBadgeVariant(row.deployment.status)}>{row.deployment.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{row.deployment.sourceType}</TableCell>
                        <TableCell className="text-xs">
                          {row.replicas.length} · {row.metrics.healthyReplicas} healthy
                        </TableCell>
                        <TableCell className="text-xs">{formatDate(row.deployment.updatedAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button asChild type="button" size="sm" variant="ghost" className="h-7" onClick={(event) => {
                            event.stopPropagation()
                          }}>
                            <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                              projectId={projectId}
                              serviceId={serviceId}
                              search={deploymentLogSearch}
                            >
                              Open logs
                            </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}

                  {deploymentRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                        No deployments match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/45 backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Deployment details</CardTitle>
            <CardDescription>Replica states, usage snapshots, and workflow trace logs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedDeployment ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-background/35 p-5 text-center">
                <p className="text-sm font-medium">No deployment selected</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Use the round checkbox in the list to select a deployment and unlock replicas, metrics, and workflow logs.
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {deploymentRows.length > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        const firstDeploymentId = deploymentRows[0]?.deployment.id ?? null
                        setSelectedDeploymentId(firstDeploymentId)
                        setSelectedReplicaId(null)
                      }}
                    >
                      Select latest deployment
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSearchTerm('')
                        setEnvironmentFilter('all')
                        setStatusFilter('all')
                        setSourceFilter('all')
                        setDateRange('all')
                        setDateFrom('')
                        setDateTo('')
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-border/60 bg-background/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs">deployment/{shortId(selectedDeployment.id)}</p>
                      <p className="text-sm text-muted-foreground">{selectedDeployment.containerImage ?? 'No image reference'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{selectedDeployment.environment}</Badge>
                      <Badge variant={toBadgeVariant(selectedDeployment.status)}>{selectedDeployment.status}</Badge>
                      <Badge variant="outline">{selectedDeployment.sourceType}</Badge>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                        projectId={projectId}
                        serviceId={serviceId}
                      >
                        Open logs workspace
                      </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                    </Button>

                    {deploymentLogsSearch ? (
                      <Button asChild size="sm" variant="outline">
                        <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                          projectId={projectId}
                          serviceId={serviceId}
                          search={deploymentLogsSearch}
                        >
                          Open deployment logs view
                        </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                      </Button>
                    ) : null}

                    {replicaLogsSearch ? (
                      <Button asChild size="sm" variant="outline">
                        <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                          projectId={projectId}
                          serviceId={serviceId}
                          search={replicaLogsSearch}
                        >
                          Open selected replica logs view
                        </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                      </Button>
                    ) : null}
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground">
                    Tip: deployment logs show provider/build pipeline context, while replica logs isolate runtime output for a single instance.
                  </p>
                </div>

                <Tabs
                  value={detailTab}
                  onValueChange={(value) => {
                    setDetailTab(value as 'overview' | 'replicas' | 'logs')
                  }}
                  className="space-y-3"
                >
                  <TabsList className="h-auto w-full justify-start gap-1 bg-transparent p-0">
                    <TabsTrigger value="overview" className="h-8">Overview</TabsTrigger>
                    <TabsTrigger value="replicas" className="h-8">Replicas</TabsTrigger>
                    <TabsTrigger value="logs" className="h-8">Logs</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2 text-xs">
                        <p className="text-muted-foreground">Replicas</p>
                        <p className="text-base font-semibold">
                          {selectedDeploymentReplicas.length} / {selectedDeploymentMetrics.runningReplicas} running
                        </p>
                      </div>
                      <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2 text-xs">
                        <p className="text-muted-foreground">Healthy</p>
                        <p className="text-base font-semibold">{selectedDeploymentMetrics.healthyReplicas}</p>
                      </div>
                      <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2 text-xs">
                        <p className="text-muted-foreground">Avg CPU / Mem</p>
                        <p className="text-base font-semibold">
                          {formatPercent(selectedDeploymentMetrics.avgCpu)} / {formatPercent(selectedDeploymentMetrics.avgMemory)}
                        </p>
                      </div>
                      <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2 text-xs">
                        <p className="text-muted-foreground">Peak CPU / Mem</p>
                        <p className="text-base font-semibold">
                          {formatPercent(selectedDeploymentMetrics.peakCpu)} / {formatPercent(selectedDeploymentMetrics.peakMemory)}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2 text-xs">
                      <p className="font-medium">Replica health snapshot</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedDeploymentReplicas.map((replica) => (
                          <Badge key={replica.id} variant={toBadgeVariant(replica.status)} className="text-[10px]">
                            {replica.name} · {replica.status}
                          </Badge>
                        ))}
                        {selectedDeploymentReplicas.length === 0 ? (
                          <p className="text-muted-foreground">No replicas attached to this deployment.</p>
                        ) : null}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="replicas" className="space-y-3">
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">Replicas in this deployment</h3>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">
                                <DockerSelectionToggle
                                  ariaLabel="Toggle replica selection"
                                  shape="round"
                                  pressed={hasReplicaSelection}
                                  onPressedChange={(pressed) => {
                                    if (pressed) {
                                      const firstReplicaId = selectedDeploymentReplicas[0]?.id ?? null
                                      setSelectedReplicaId(firstReplicaId)
                                      return
                                    }

                                    setSelectedReplicaId(null)
                                  }}
                                />
                              </TableHead>
                              <TableHead>Replica</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>CPU</TableHead>
                              <TableHead>Memory</TableHead>
                              <TableHead>Node</TableHead>
                              <TableHead className="text-right">Logs</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedDeploymentReplicas.map((replica) => {
                              const isSelectedReplica = selectedReplica?.id === replica.id
                              const metrics = buildReplicaMetrics(replica)
                              const host = resolveReplicaHost(replica.id, fleetServers)
                              const rowReplicaLogSearch = createReplicaLogsSearch(
                                selectedDeployment.id,
                                replica.id,
                                replica.name,
                              )

                              return (
                                <TableRow
                                  key={replica.id}
                                  className={cn('cursor-pointer hover:bg-muted/35', isSelectedReplica ? 'bg-primary/8' : undefined)}
                                  onClick={() => {
                                    setSelectedReplicaId(replica.id)
                                  }}
                                >
                                  <TableCell>
                                    <DockerSelectionToggle
                                      ariaLabel={`Select replica ${replica.name}`}
                                      shape="round"
                                      pressed={isSelectedReplica}
                                      onPressedChange={(pressed) => {
                                        if (pressed) {
                                          setSelectedReplicaId(replica.id)
                                          return
                                        }
                                        setSelectedReplicaId(null)
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium">{replica.name}</TableCell>
                                  <TableCell>
                                    <Badge variant={toBadgeVariant(replica.status)}>{replica.status}</Badge>
                                    <span className="ml-2 text-xs text-muted-foreground">{replica.health}</span>
                                  </TableCell>
                                  <TableCell className="text-xs">{formatPercent(metrics.currentCpu)}</TableCell>
                                  <TableCell className="text-xs">{formatPercent(metrics.currentMemory)}</TableCell>
                                  <TableCell className="text-xs">{host?.displayName ?? host?.serverUrl ?? 'node-unresolved'}</TableCell>
                                  <TableCell className="text-right">
                                    <Button asChild type="button" size="sm" variant="ghost" className="h-7" onClick={(event) => {
                                      event.stopPropagation()
                                    }}>
                                      <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                                        projectId={projectId}
                                        serviceId={serviceId}
                                        search={rowReplicaLogSearch}
                                      >
                                        Open logs
                                      </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              )
                            })}

                            {selectedDeploymentReplicas.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                                  No replicas available for this deployment.
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {selectedReplica ? (
                      <div className="rounded-md border border-border/60 bg-background/50 p-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">Replica runtime detail · {selectedReplica.name}</p>
                          {replicaLogsSearch ? (
                            <Button asChild size="sm" variant="outline" className="h-7">
                              <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                                projectId={projectId}
                                serviceId={serviceId}
                                search={replicaLogsSearch}
                              >
                                Open replica logs
                              </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                            </Button>
                          ) : null}
                        </div>
                        <p className="mt-2 text-muted-foreground">
                          Node: {selectedReplicaHost?.displayName ?? selectedReplicaHost?.serverUrl ?? 'unassigned'}
                        </p>
                        <p className="text-muted-foreground">
                          Network mode: {selectedReplicaInspect?.runtimeConfig.networkMode ?? 'unknown'} · Restart policy:{' '}
                          {selectedReplicaInspect?.runtimeConfig.restartPolicy ?? 'unknown'}
                        </p>
                        <p className="text-muted-foreground">
                          Compose file: {selectedReplicaInspect?.composeConfig?.composeFilePath ?? 'n/a'}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border/70 bg-background/35 p-4 text-center">
                        <p className="text-sm font-medium">No replica selected</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Choose a replica from the table to inspect runtime placement and scoped logs.
                        </p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="logs" className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">Raw logs</Badge>
                      <Badge variant="outline">deployment/{shortId(selectedDeployment.id)}</Badge>
                      {selectedReplica ? <Badge variant="outline">replica/{selectedReplica.name}</Badge> : null}
                      <div className="ml-auto flex flex-wrap gap-2">
                        {deploymentLogsSearch ? (
                          <Button asChild size="sm" variant="outline" className="h-7">
                            <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                              projectId={projectId}
                              serviceId={serviceId}
                              search={deploymentLogsSearch}
                            >
                              Open deployment logs page
                            </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                          </Button>
                        ) : null}
                        {replicaLogsSearch ? (
                          <Button asChild size="sm" variant="outline" className="h-7">
                            <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                              projectId={projectId}
                              serviceId={serviceId}
                              search={replicaLogsSearch}
                            >
                              Open replica logs page
                            </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <Tabs
                      value={logsTab}
                      onValueChange={(value) => {
                        setLogsTab(value as 'provider' | 'builder' | 'runner')
                      }}
                      className="space-y-2"
                    >
                      <TabsList className="h-auto w-full justify-start gap-1 bg-transparent p-0">
                        <TabsTrigger value="provider" className="h-8">Provider</TabsTrigger>
                        <TabsTrigger value="builder" className="h-8">Builder</TabsTrigger>
                        <TabsTrigger value="runner" className="h-8">Runner</TabsTrigger>
                      </TabsList>

                      <TabsContent value="provider">
                        <div className="rounded-md border border-border/60 bg-[#070b14]">
                          <ScrollArea className="h-80">
                            <div className="space-y-1 p-3 font-mono text-[11px] text-emerald-300">
                              {providerRawLines.map((line, index) => (
                                <p key={`provider-${String(index)}`} className="whitespace-pre-wrap wrap-break-word">{line}</p>
                              ))}
                              {providerRawLines.length === 0 ? (
                                <p className="text-slate-400">No provider pull logs available.</p>
                              ) : null}
                            </div>
                          </ScrollArea>
                        </div>
                      </TabsContent>

                      <TabsContent value="builder">
                        <div className="rounded-md border border-border/60 bg-[#070b14]">
                          <ScrollArea className="h-80">
                            <div className="space-y-1 p-3 font-mono text-[11px] text-cyan-300">
                              {builderRawLines.map((line, index) => (
                                <p key={`builder-${String(index)}`} className="whitespace-pre-wrap wrap-break-word">{line}</p>
                              ))}
                              {builderRawLines.length === 0 ? (
                                <p className="text-slate-400">
                                  {selectedReplica
                                    ? 'No builder logs available for this replica.'
                                    : 'Select a replica to inspect builder logs.'}
                                </p>
                              ) : null}
                            </div>
                          </ScrollArea>
                        </div>
                      </TabsContent>

                      <TabsContent value="runner">
                        <div className="rounded-md border border-border/60 bg-[#070b14]">
                          <ScrollArea className="h-80">
                            <div className="space-y-1 p-3 font-mono text-[11px] text-green-300">
                              {runnerRawLines.map((line, index) => (
                                <p key={`runner-${String(index)}`} className="whitespace-pre-wrap wrap-break-word">{line}</p>
                              ))}
                              {runnerRawLines.length === 0 ? (
                                <p className="text-slate-400">
                                  {selectedReplica
                                    ? 'No runner logs available for this replica.'
                                    : 'Select a replica to inspect runner logs.'}
                                </p>
                              ) : null}
                            </div>
                          </ScrollArea>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
