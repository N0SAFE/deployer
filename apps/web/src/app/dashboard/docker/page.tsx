'use client'

import Link from 'next/link'
import { AuthDashboardDockerActivity, AuthDashboardDockerContainers, AuthDashboardDockerImages, AuthDashboardDockerLogs, AuthDashboardDockerNetworks, AuthDashboardDockerRegistry, AuthDashboardDockerStacks, AuthDashboardDockerVolumes } from '@/routes'
import { useMemo } from 'react'
import { DockerContainerDetailModalTrigger } from './_components/container-detail-modal'
import { DockerInlineLoadingState, DockerTableLoadingRows } from './_components/docker-loading-states'
import {
  useDockerContainerList,
  useDockerImageList,
  useDockerFleetServers,
  useDockerRuntimeSnapshot,
  useDockerRuntimeSseState,
  useDockerServiceList,
} from '@/domains/docker/hooks'
import { useDockerLiveRefetch } from '@/domains/docker/use-docker-live'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Bot, Boxes } from 'lucide-react'
import type { DockerContainer } from '@repo/contracts-entities'
import { cn } from '@/lib/utils'
import { EnvironmentBadge, StatusBadge } from '@/components/dashboard'

const DOCKER_LIST_INPUT = {
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

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

interface ContainerProjection {
  id: string
  name: string
  image: string
  status: DockerContainer['status']
  environment: DockerContainer['environment']
  updatedAt: string
}

function fallbackImageRefFromId(imageId: string | null): string {
  if (!imageId) return 'unknown-image'
  if (imageId.startsWith('sha256:')) {
    return `sha256:${imageId.slice(7, 19)}`
  }
  return imageId.slice(0, 18)
}

export default function DashboardDockerPage() {
  const containerListQuery = useDockerContainerList(DOCKER_LIST_INPUT)
  const imageListQuery = useDockerImageList(DOCKER_LIST_INPUT)

  const serviceListQuery = useDockerServiceList(SERVICE_LIST_INPUT)

  const {
    data: fleetServersData,
    error: fleetServersError,
    isLoading: isFleetServersLoading,
  } = useDockerFleetServers()
  const runtimeSnapshotQuery = useDockerRuntimeSnapshot()
  const { status: runtimeSseStatus } = useDockerRuntimeSseState()

  useDockerLiveRefetch({
    on: { container: ['create', 'update', 'destroy', 'die', 'start', 'stop', 'restart', 'kill', 'pause', 'unpause', 'rename', 'attach', 'detach'] },
    onData: () => {
      void containerListQuery.refetch()
      void imageListQuery.refetch()
      void serviceListQuery.refetch()
    },
    debounceMs: 1000,
  })

  const { data: containerEntityData, error: containersError } = containerListQuery
  const { data: imageEntityData, error: imagesError } = imageListQuery
  const { data: serviceData, error: servicesError } = serviceListQuery

  const containerEntities = containerEntityData?.data ?? []
  const containerEntityById = useMemo(
    () => new Map(containerEntities.map((container) => [container.id, container])),
    [containerEntities],
  )
  const imageEntities = imageEntityData?.data ?? []
  const services = serviceData?.data ?? []
  const fleetServers = fleetServersData?.items ?? []
  const runtimeCatalog = runtimeSnapshotQuery.data

  const runtimeCatalogGroupCount = runtimeCatalog ? Object.keys(runtimeCatalog).length : 0
  const runtimeCatalogEntityCount = runtimeCatalog
    ? runtimeCatalog.containers.length
      + runtimeCatalog.images.length
      + runtimeCatalog.networks.length
      + runtimeCatalog.volumes.length
      + runtimeCatalog.registries.length
      + runtimeCatalog.stacks.length
    : 0

  const containers = useMemo<ContainerProjection[]>(() => {
    const imageById = new Map(imageEntities.map((image) => [image.id, image]))

    return containerEntities
      .map((container) => {
        const imageEntity = container.imageId ? imageById.get(container.imageId) : null
        const image = imageEntity
          ? `${imageEntity.registry}/${imageEntity.repository}${imageEntity.tag ? `:${imageEntity.tag}` : ''}`
          : fallbackImageRefFromId(container.imageId)

        return {
          id: container.id,
          name: container.name,
          image,
          status: container.status,
          environment: container.environment,
          updatedAt: container.updatedAt,
        }
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [containerEntities, imageEntities])

  const networkCount = useMemo(() => {
    return new Set(services.map((service) => service.projectId)).size
  }, [services])

  const hasErrors = containersError ?? imagesError ?? servicesError ?? fleetServersError
  const isOverviewLoading = containerListQuery.isLoading
    || imageListQuery.isLoading
    || serviceListQuery.isLoading
    || runtimeSnapshotQuery.isLoading
    || isFleetServersLoading
  const isContainerTableLoading = (containerListQuery.isLoading || imageListQuery.isLoading) && containers.length === 0

  return (
    <div className="space-y-6">
      <Alert className="border-border/60 bg-card/30">
        <Bot className="h-4 w-4" />
        <AlertTitle>Runtime-first Docker mode</AlertTitle>
        <AlertDescription>
          This view reads live Docker runtime inventory and stream state directly, with no deployment-table projection for container cards.
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

      {isOverviewLoading ? (
        <DockerInlineLoadingState label="Syncing Docker runtime overview from control plane sources…" />
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
        <div className="border-b border-border/60 bg-background/70 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Docker overview</h2>
              <Badge variant="secondary" className="border border-border/70">{containers.length}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Fleet nodes <span className="font-semibold text-foreground">{fleetServers.length}</span> · Runtime groups <span className="font-semibold text-foreground">{runtimeCatalogGroupCount}</span> · Runtime entities <span className="font-semibold text-foreground">{runtimeCatalogEntityCount}</span> · Projects <span className="font-semibold text-foreground">{networkCount}</span>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="border-b border-border/60 px-5 py-3">
            <h2 className="text-sm font-semibold">Recent container snapshots</h2>
            <p className="text-xs text-muted-foreground">Latest runtime container snapshots from Docker.</p>
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
                {isContainerTableLoading ? (
                  <DockerTableLoadingRows columns={5} rows={6} />
                ) : containers.slice(0, 12).map((container) => (
                  <TableRow key={container.id}>
                    <TableCell className="font-medium">
                      <DockerContainerDetailModalTrigger
                        id={container.id}
                        container={containerEntityById.get(container.id)}
                      >
                        {container.name}
                      </DockerContainerDetailModalTrigger>
                    </TableCell>
                    <TableCell className="font-mono text-xs break-all">{container.image}</TableCell>
                    <TableCell>
                      <StatusBadge status={container.status} />
                    </TableCell>
                    <TableCell><EnvironmentBadge environment={container.environment} /></TableCell>
                    <TableCell>{formatDate(container.updatedAt)}</TableCell>
                  </TableRow>
                ))}
                {!isContainerTableLoading && containers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No runtime containers found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">Fleet nodes <span className="font-semibold text-foreground">{fleetServers.length}</span></div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">Runtime stream <span className="font-semibold text-foreground">{runtimeSseStatus}</span></div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">Projects with services <span className="font-semibold text-foreground">{networkCount}</span></div>
          </div>

          <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Boxes className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Fleet nodes</h3>
                  <p className="text-xs text-muted-foreground">Live capacity and queue metrics from control-plane nodes.</p>
                </div>
              </div>
              <Badge variant="outline">{fleetServers.length} nodes</Badge>
            </div>

            {fleetServers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/70 bg-background/30 px-3 py-6 text-center text-xs text-muted-foreground">
                No fleet nodes registered yet.
              </p>
            ) : (
              <div className="space-y-2">
                {fleetServers.map((server) => (
                  <div key={server.nodeId} className="rounded-lg border border-border/60 bg-card/60 p-2.5">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn('size-2 shrink-0 rounded-full', server.healthy ? 'bg-emerald-400' : 'bg-rose-400')}
                          aria-hidden="true"
                        />
                        <p className="truncate text-xs font-medium">{server.displayName}</p>
                      </div>
                      <Badge variant={server.healthy ? 'outline' : 'destructive'} className="text-[10px]">
                        {server.healthy ? 'healthy' : 'degraded'}
                      </Badge>
                    </div>
                    <div className="grid gap-1 text-[11px] md:grid-cols-3">
                      <p className="font-mono text-muted-foreground">{shortId(server.nodeId)}</p>
                      <p>
                        <span className="text-muted-foreground">CPU:</span> {(server.maxCpuMillicores ?? 0) / 1000} cores ·{' '}
                        <span className="text-muted-foreground">RAM:</span> {((server.maxMemoryMb ?? 0) / 1024).toFixed(1)} GiB
                      </p>
                      <p>
                        <span className="text-muted-foreground">Queue:</span> {server.metrics?.queueDepth ?? 0}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
