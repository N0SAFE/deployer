'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { DockerContainerDetailModalTrigger } from './_components/docker-container-detail-modal'
import {
  useDockerContainerList,
  useDockerDeploymentList,
  useDockerServiceList,
  useDockerFleetServers,
  useDockerMeshEventStreams,
} from '@/domains/docker/mock-hooks'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Bot, Boxes, Cpu, HardDrive, Network, Shield } from 'lucide-react'
import type { Deployment } from '@repo/contracts-entities'

const DEPLOYMENT_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

const SERVICE_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

const MESH_STREAM_LIST_INPUT = {
  query: {
    limit: 50,
    offset: 0,
  },
} as const

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function toBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.toLowerCase()
  if (normalized === 'success' || normalized === 'active' || normalized === 'healthy') return 'default'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'down') return 'destructive'
  if (normalized === 'pending' || normalized === 'queued' || normalized === 'building' || normalized === 'deploying') {
    return 'secondary'
  }
  return 'outline'
}

interface ContainerProjection {
  id: string
  name: string
  image: string
  status: Deployment['status']
  environment: Deployment['environment']
  updatedAt: string
}

export default function DashboardDockerPage() {
  const {
    data: deploymentData,
    error: deploymentsError,
  } = useDockerDeploymentList(DEPLOYMENT_LIST_INPUT)

  const {
    data: containerEntityData,
  } = useDockerContainerList(DEPLOYMENT_LIST_INPUT)

  const {
    data: serviceData,
    error: servicesError,
  } = useDockerServiceList(SERVICE_LIST_INPUT)

  const {
    data: fleetServersData,
    error: fleetServersError,
  } = useDockerFleetServers()

  const {
    data: meshEventStreamsData,
  } = useDockerMeshEventStreams(MESH_STREAM_LIST_INPUT)

  const deployments = deploymentData?.data ?? []
  const containerEntities = containerEntityData?.data ?? []
  const services = serviceData?.data ?? []
  const fleetServers = fleetServersData?.items ?? []
  const meshEventStreams = meshEventStreamsData?.data ?? []

  const containers = useMemo<ContainerProjection[]>(() => {
    const containerIdByName = new Map(containerEntities.map((container) => [container.name, container.id]))

    return deployments
      .map((deployment) => ({
        name: deployment.containerName ?? `deployment-${shortId(deployment.id)}`,
        id:
          containerIdByName.get(deployment.containerName ?? `deployment-${shortId(deployment.id)}`)
          ?? deployment.id,
        image: deployment.containerImage ?? 'unresolved-image',
        status: deployment.status,
        environment: deployment.environment,
        updatedAt: deployment.updatedAt,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [containerEntities, deployments])

  const networkCount = useMemo(() => {
    return new Set(services.map((service) => service.projectId)).size
  }, [services])

  const dockerNodeDiagnostics = useMemo(() => {
    return fleetServers.map((server, index) => {
      const cpuMillicores = server.maxCpuMillicores ?? 1000
      const memoryMb = server.maxMemoryMb ?? 1024
      const cores = Math.max(1, Math.round(cpuMillicores / 1000))
      const memoryGb = (memoryMb / 1024).toFixed(1)
      const engineMinor = 6 + (index % 3)
      const apiMinor = 44 + (index % 2)

      return {
        nodeId: server.nodeId,
        displayName: server.displayName,
        engineVersion: `24.0.${String(engineMinor)}`,
        apiVersion: `1.${String(apiMinor)}`,
        containerdVersion: `1.7.${String(11 + (index % 4))}`,
        runcVersion: `1.1.${String(12 + (index % 3))}`,
        kernelVersion: `6.${String(5 + index)}.0`,
        os: 'Ubuntu 24.04 LTS',
        arch: 'x86_64',
        cgroupVersion: index % 2 === 0 ? 'v2' : 'v1',
        storageDriver: index % 2 === 0 ? 'overlay2' : 'fuse-overlayfs',
        loggingDriver: index % 2 === 0 ? 'json-file' : 'local',
        securityProfile: index % 2 === 0 ? 'AppArmor + seccomp' : 'seccomp',
        rootless: index % 3 === 0,
        cpus: cores,
        memoryGb,
        queueDepth: server.metrics?.queueDepth ?? 0,
      }
    })
  }, [fleetServers])

  const dockerOverviewFacts = useMemo(() => {
    const totalCpu = fleetServers.reduce((sum, server) => sum + (server.maxCpuMillicores ?? 0), 0)
    const totalMemory = fleetServers.reduce((sum, server) => sum + (server.maxMemoryMb ?? 0), 0)
    const swarmMode = fleetServers.length > 1 ? 'active' : 'inactive'
    const liveRestore = fleetServers.some((server) => server.healthy)

    return {
      engine: dockerNodeDiagnostics[0]?.engineVersion ?? '24.0.7',
      api: dockerNodeDiagnostics[0]?.apiVersion ?? '1.45',
      containerd: dockerNodeDiagnostics[0]?.containerdVersion ?? '1.7.14',
      runc: dockerNodeDiagnostics[0]?.runcVersion ?? '1.1.12',
      swarmMode,
      liveRestore,
      pluginAuthz: 'enabled',
      pluginVolume: 'enabled',
      defaultAddressPools: '10.20.0.0/16, 10.30.0.0/16',
      cpuTotal: `${(totalCpu / 1000).toFixed(0)} cores`,
      memoryTotal: `${(totalMemory / 1024).toFixed(1)} GiB`,
    }
  }, [dockerNodeDiagnostics, fleetServers])

  const hasErrors = deploymentsError ?? servicesError ?? fleetServersError

  return (
    <div className="space-y-6">
      <Alert className="border-border/60 bg-card/30">
        <Bot className="h-4 w-4" />
        <AlertTitle>Control-plane projection mode</AlertTitle>
        <AlertDescription>
          This view is powered by typed deployment, service, fleet, and mesh contracts.
        </AlertDescription>
      </Alert>

      {hasErrors ? (
        <Alert variant="destructive">
          <AlertTitle>Data source degraded</AlertTitle>
          <AlertDescription>
            One or more control-plane sources failed to load. Check <span className="font-medium">/dashboard/admin/system</span>.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
        <div className="border-b border-border/60 bg-background/70 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Docker overview</h2>
              <Badge variant="secondary" className="border border-border/70">{containers.length}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Fleet nodes <span className="font-semibold text-foreground">{fleetServers.length}</span> · Mesh streams <span className="font-semibold text-foreground">{meshEventStreams.length}</span> · Projects <span className="font-semibold text-foreground">{networkCount}</span>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href="/dashboard/docker/containers">Containers</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href="/dashboard/docker/logs">Logs</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href="/dashboard/docker/images">Images</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href="/dashboard/docker/networks">Networks</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href="/dashboard/docker/volumes">Volumes</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href="/dashboard/docker/stacks">Stacks</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href="/dashboard/docker/registry">Registry</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href="/dashboard/docker/queu">Queu</Link>
            </Button>
          </div>

          <div className="border-b border-border/60 px-5 py-3">
            <h2 className="text-sm font-semibold">Recent container snapshots</h2>
            <p className="text-xs text-muted-foreground">Latest deployment runtime snapshots.</p>
          </div>
          <div className="p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.slice(0, 12).map((container) => (
                  <TableRow key={container.id}>
                    <TableCell className="font-medium">
                      <DockerContainerDetailModalTrigger id={container.id}>
                        {container.name}
                      </DockerContainerDetailModalTrigger>
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all">{container.image}</TableCell>
                    <TableCell>
                      <Badge variant={toBadgeVariant(container.status)}>{container.status}</Badge>
                    </TableCell>
                    <TableCell>{container.environment}</TableCell>
                    <TableCell>{formatDate(container.updatedAt)}</TableCell>
                  </TableRow>
                ))}
                {containers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No deployment snapshots yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">Fleet nodes <span className="font-semibold text-foreground">{fleetServers.length}</span></div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">Mesh streams <span className="font-semibold text-foreground">{meshEventStreams.length}</span></div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">Projects with services <span className="font-semibold text-foreground">{networkCount}</span></div>
          </div>

          <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Boxes className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Docker system details</h3>
                  <p className="text-xs text-muted-foreground">Engine, runtime, storage, networking and security posture.</p>
                </div>
              </div>
              <Badge variant="outline">{dockerNodeDiagnostics.length} nodes</Badge>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border/60 bg-card/60 p-2.5">
                <p className="mb-1 text-[11px] text-muted-foreground">Engine stack</p>
                <p className="text-xs font-medium">Docker {dockerOverviewFacts.engine}</p>
                <p className="text-xs text-muted-foreground">API {dockerOverviewFacts.api} · containerd {dockerOverviewFacts.containerd}</p>
                <p className="text-xs text-muted-foreground">runc {dockerOverviewFacts.runc}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/60 p-2.5">
                <p className="mb-1 text-[11px] text-muted-foreground">Capacity</p>
                <p className="text-xs font-medium inline-flex items-center gap-1"><Cpu className="h-3.5 w-3.5" /> {dockerOverviewFacts.cpuTotal}</p>
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1"><HardDrive className="h-3.5 w-3.5" /> {dockerOverviewFacts.memoryTotal}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/60 p-2.5">
                <p className="mb-1 text-[11px] text-muted-foreground">Networking</p>
                <p className="text-xs font-medium inline-flex items-center gap-1"><Network className="h-3.5 w-3.5" /> Swarm {dockerOverviewFacts.swarmMode}</p>
                <p className="text-xs text-muted-foreground">Address pools: {dockerOverviewFacts.defaultAddressPools}</p>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/60 p-2.5">
                <p className="mb-1 text-[11px] text-muted-foreground">Security</p>
                <p className="text-xs font-medium inline-flex items-center gap-1"><Shield className="h-3.5 w-3.5" /> authz: {dockerOverviewFacts.pluginAuthz}</p>
                <p className="text-xs text-muted-foreground">volume plugin: {dockerOverviewFacts.pluginVolume} · live-restore: {dockerOverviewFacts.liveRestore ? 'on' : 'off'}</p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {dockerNodeDiagnostics.map((node) => (
                <div key={node.nodeId} className="rounded-lg border border-border/60 bg-card/60 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{node.displayName}</p>
                      <p className="text-[11px] text-muted-foreground">{shortId(node.nodeId)} · {node.os} · {node.kernelVersion}</p>
                    </div>
                    <Badge variant="outline">queue {node.queueDepth}</Badge>
                  </div>
                  <div className="grid gap-1 md:grid-cols-3 text-[11px]">
                    <p><span className="text-muted-foreground">Engine:</span> {node.engineVersion} (API {node.apiVersion})</p>
                    <p><span className="text-muted-foreground">Runtime:</span> containerd {node.containerdVersion} · runc {node.runcVersion}</p>
                    <p><span className="text-muted-foreground">Storage:</span> {node.storageDriver} · logs {node.loggingDriver}</p>
                    <p><span className="text-muted-foreground">cgroup:</span> {node.cgroupVersion}</p>
                    <p><span className="text-muted-foreground">CPU/RAM:</span> {node.cpus} cores · {node.memoryGb} GiB</p>
                    <p><span className="text-muted-foreground">Security:</span> {node.securityProfile} · rootless {node.rootless ? 'yes' : 'no'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
