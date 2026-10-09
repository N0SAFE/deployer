'use client'

import { AuthDashboardCluster, AuthDashboardDockerContainers, AuthDashboardNodesDiagnostics, AuthDashboardProjects } from '@/routes'
import { useMemo } from 'react'
import { DockerContainerDetailModalTrigger } from './_components/container-detail-modal'
import { DockerTableLoadingRows } from './_components/docker-loading-states'
import { DockerEngineError } from './_components/docker-engine-error'
import { DockerRelativeTime } from './_components/docker-relative-time'
import {
  useDockerContainerList,
  useDockerImageList,
  useDockerRuntimeSnapshot,
  useDockerRuntimeSseState,
  useDockerServiceList,
} from '@/domains/docker/hooks'
import { useDockerLiveRefetch } from '@/domains/docker/use-docker-live'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Boxes, Server } from 'lucide-react'
import type { DockerContainer } from '@repo/contracts-entities'
import { EmptyState, EnvironmentBadge, StatStrip, StatStripItem, StatusBadge, type StatusTone } from '@/components/dashboard'
import type { DockerRuntimeSseState } from '@/domains/docker/hooks'

/**
 * Live-state tones for the runtime event stream. A bare word like "disconnected"
 * reads as neutral text; the same word in a status tone reads as a problem, which
 * is what it is — the page stops updating when the stream drops.
 */
const RUNTIME_STREAM_TONES: Record<DockerRuntimeSseState['status'], StatusTone> = {
  connected: 'live',
  connecting: 'pending',
  disconnected: 'danger',
  error: 'danger',
}

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

  const { data: containerEntityData } = containerListQuery
  const { data: imageEntityData } = imageListQuery
  const { data: serviceData } = serviceListQuery

  const containerEntities = useMemo(() => containerEntityData?.data ?? [], [containerEntityData])
  const containerEntityById = useMemo(
    () => new Map(containerEntities.map((container) => [container.id, container])),
    [containerEntities],
  )
  const imageEntities = useMemo(() => imageEntityData?.data ?? [], [imageEntityData])
  const services = useMemo(() => serviceData?.data ?? [], [serviceData])
  const runtimeCatalog = runtimeSnapshotQuery.data

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

  const projectCount = useMemo(() => new Set(services.map((service) => service.projectId)).size, [services])
  const runningCount = containers.filter((c) => c.status === 'running').length

  const firstError = containerListQuery.error ?? imageListQuery.error ?? serviceListQuery.error ?? runtimeSnapshotQuery.error
  const isContainerTableLoading = (containerListQuery.isLoading || imageListQuery.isLoading) && containers.length === 0
  const retryAll = () => {
    void containerListQuery.refetch()
    void imageListQuery.refetch()
    void serviceListQuery.refetch()
    void runtimeSnapshotQuery.refetch()
  }

  return (
    <div className="space-y-6">
      {firstError ? (
        <DockerEngineError what="the engine overview" error={firstError} onRetry={retryAll} isRetrying={containerListQuery.isFetching} />
      ) : null}

      <p className="text-sm text-muted-foreground">
        Shown here: containers and images as Docker reports them on this node. Not shown: swarm services (see{' '}
        <AuthDashboardCluster.Link className="font-medium underline">Cluster</AuthDashboardCluster.Link>) and application
        deployments (see <AuthDashboardProjects.Link className="font-medium underline">Projects</AuthDashboardProjects.Link>).
        Peer connectivity is under{' '}
        <AuthDashboardNodesDiagnostics.Link className="font-medium underline">Nodes → Peer diagnostics</AuthDashboardNodesDiagnostics.Link>.
      </p>

      <StatStrip>
        <StatStripItem icon={Boxes} label="Containers" value={containerListQuery.isLoading ? '…' : containers.length} hint={`${String(runningCount)} running`} />
        <StatStripItem label="Images" value={imageListQuery.isLoading ? '…' : imageEntities.length} />
        <StatStripItem label="Networks / volumes" value={runtimeCatalog ? `${String(runtimeCatalog.networks.length)} / ${String(runtimeCatalog.volumes.length)}` : '…'} />
        <StatStripItem icon={Server} label="Live updates" value={runtimeSseStatus} tone={RUNTIME_STREAM_TONES[runtimeSseStatus]} hint={runtimeSseStatus === 'connected' ? undefined : 'lists refresh slower while disconnected'} />
        <StatStripItem label="Projects with services" value={projectCount} />
      </StatStrip>

      <section className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Recently changed containers</h2>
            <p className="text-xs text-muted-foreground">The 12 most recently updated containers on this node.</p>
          </div>
          <AuthDashboardDockerContainers.Link className="text-sm font-medium underline">All containers</AuthDashboardDockerContainers.Link>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
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
                    <DockerContainerDetailModalTrigger id={container.id} container={containerEntityById.get(container.id)}>
                      {container.name}
                    </DockerContainerDetailModalTrigger>
                  </TableCell>
                  <TableCell className="font-mono text-xs break-all">{container.image}</TableCell>
                  <TableCell><StatusBadge status={container.status} /></TableCell>
                  <TableCell><EnvironmentBadge environment={container.environment} /></TableCell>
                  <TableCell><DockerRelativeTime value={container.updatedAt} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!isContainerTableLoading && containers.length === 0 && !firstError ? (
            <EmptyState
              compact
              icon={Boxes}
              title="No containers on this node"
              description="Containers appear here once something runs on this node's Docker engine, for example after a deployment."
            />
          ) : null}
        </div>
      </section>
    </div>
  )
}
