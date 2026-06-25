'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { z } from 'zod'
import { DockerBatchOperationsBar, DockerSavedViewSelect } from '../_components/docker-operations-controls'
import { DockerInlineLoadingState } from '../_components/docker-loading-states'
import {
  DockerActiveFilterChips,
  DockerExportActions,
} from '../_components/docker-page-utilities'
import { DockerContainerDetailModalTrigger } from '../_components/container-detail-modal'
import { DockerCreateContainerModal } from '../_components/docker-create-container-modal'
import { DockerImageDetailModalTrigger } from '../_components/docker-image-detail-modal'
import {
  useDockerContainerGroupedList,
  useDockerRunContainerAction,
  useDockerRuntimeSseState,
} from '@/domains/docker/hooks'
import { useDockerLiveContainers, useDockerLiveImages } from '@/domains/docker/use-docker-live'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { DataTable } from '@repo/ui/components/data-table/data-table'
import { AlertTriangle, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react'
import type { DockerContainer } from '@repo/contracts-entities'
import { cn } from '@/lib/utils'
import { useSafeQueryStatesFromZod } from '@repo/use-safe-query-param-states-from-zod'
import { toast } from 'sonner'
import {
  createContainerColumns,
  createContainerTableFetchData,
  toContainerTableRows,
  type ContainerProjection,
  type ContainerInstanceProjection,
} from './columns'
import { AuthDashboardDockerContainers } from '@/routes/index';

const DOCKER_CONTAINER_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

const CONTAINER_LIST_QUERY_SCHEMA = z.object({
  q: z.string().default(''),
  view: z.enum(['all', 'failed', 'active', 'production']).default('all'),
  status: z.string().default('all'),
  environment: z.string().default('all'),
  ownership: z.enum(['all', 'deployment_service', 'orphan']).default('all'),
  sortBy: z.enum(['updated', 'name', 'status', 'environment']).default('updated'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(20),
})

function shortId(id: string): string {
  return id.slice(0, 8)
}

function toBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.toLowerCase()
  if (normalized === 'running' || normalized === 'healthy') return 'default'
  if (normalized === 'dead' || normalized === 'exited' || normalized === 'failed' || normalized === 'error') return 'destructive'
  if (normalized === 'restarting' || normalized === 'created' || normalized === 'starting') {
    return 'secondary'
  }
  return 'outline'
}

function fallbackImageRefFromId(imageId: string | null): string {
  if (!imageId) return 'unknown-image'
  if (imageId.startsWith('sha256:')) {
    return `sha256:${imageId.slice(7, 19)}`
  }
  return imageId.slice(0, 18)
}

function deriveRuntimeUrlFromPorts(ports: DockerContainer['ports']): string | null {
  const published = ports.find((port) => port.hostPort !== null)
  if (!published || published.hostPort === null) {
    return null
  }

  const protocol = published.protocol === 'udp' ? 'udp' : 'http'
  return `${protocol}://localhost:${String(published.hostPort)}`
}




export default AuthDashboardDockerContainers.Route(function DashboardDockerContainersPage({
  
}) {
  const [listQuery, setListQuery] = useSafeQueryStatesFromZod(CONTAINER_LIST_QUERY_SCHEMA)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedContainerRows, setSelectedContainerRows] = useState<ContainerProjection[]>([])
  const selectedContainerRowsSignatureRef = useRef('')

  const searchTerm = listQuery.q ?? ''
  const sortBy = listQuery.sortBy ?? 'updated'
  const sortDirection = listQuery.sortDirection ?? 'desc'
  const environmentFilter = listQuery.environment ?? 'all'
  const statusFilter = listQuery.status ?? 'all'
  const ownershipFilter = listQuery.ownership ?? 'all'
  const savedView = listQuery.view ?? 'all'
  const containerListInput = useMemo(() => {
    if (ownershipFilter === 'all') {
      return DOCKER_CONTAINER_LIST_INPUT
    }

    return {
      query: {
        ...DOCKER_CONTAINER_LIST_INPUT.query,
        filter: {
          managedBy: {
            operator: 'eq' as const,
            value: ownershipFilter,
          },
        },
      },
    }
  }, [ownershipFilter])

  // In-memory live store for containers, driven by the docker runtime SSE
  // stream and reconciled every minute via the `docker.containers.list`
  // endpoint. The legacy `useContainerLiveUpdate` + `cooldownMs: 900` and
  // the `useDockerRuntimeRefetchOnStream` patterns are no longer needed
  // here: events are batched and applied to the in-memory store directly,
  // and a full snapshot is fetched periodically to heal any drift.
  const liveContainers = useDockerLiveContainers({
    debounceMs: 200,
    reconcileIntervalMs: 60_000,
  })
  const containerEntities = liveContainers.data
  const containerEntityById = liveContainers.byId

  // Diagnostics (shared daemon groups, etc.) still come from the grouped
  // endpoint. The flat list we use for rendering no longer exposes them
  // directly, so we keep a lightweight grouped query just for the banner.
  const groupedContainerQuery = useDockerContainerGroupedList(containerListInput)
  const groupedContainerDiagnostics = groupedContainerQuery.data?.diagnostics

  const runContainerActionMutation = useDockerRunContainerAction()
  const runtimeSseState = useDockerRuntimeSseState()

  // Track the distinct imageIds referenced by the current container set so
  // the image list query only fetches the registry/repository metadata that
  // is actually used in the view. Additional imageIds (e.g. ones revealed
  // by hover/click actions) are appended to the list dynamically.
  const [hoveredImageIds, setHoveredImageIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )

  // The image list hook is filter-based: it always reconciles the full
  // snapshot every minute and only refetches on "list-changing" image
  // actions (create/update/destroy/delete/pull). The custom list limit
  // logic is now obsolete — the hook always returns the full inventory
  // up to its server-side cap. We still let the user "register" images
  // they care about via hover/click so future per-image optimisations
  // (e.g. lazy inspect) can prioritise them.
  const liveImages = useDockerLiveImages({
    debounceMs: 500,
    reconcileIntervalMs: 60_000,
  })
  const imageEntities = useMemo(() => liveImages.data, [liveImages.data])
  const imageEntityById = liveImages.byId
  const handleContainerStateChange = useCallback(() => {
    void liveContainers.refetch()
  }, [liveContainers])

  // Register a docker image as "wanted" (in addition to the visible
  // containers) when the user mouses over its cell. This causes the
  // image list query to grow its limit just enough to cover this id, so
  // the registry/repository metadata becomes available without ever
  // preloading the full 100-image inventory.
  const handleImageHover = useCallback((imageId: string | null | undefined) => {
    if (!imageId) {
      return
    }
    setHoveredImageIds((prev) => {
      if (prev.has(imageId)) {
        return prev
      }
      const next = new Set(prev)
      next.add(imageId)
      return next
    })
  }, [])

  const containers = useMemo<ContainerProjection[]>(() => {
    const imageById = new Map(imageEntities.map((image) => [image.id, image]))
    return containerEntities
      .map<ContainerProjection | null>((container) => {
        const imageEntity = container.imageId ? imageById.get(container.imageId) : null
        const image = imageEntity
          ? `${imageEntity.registry}/${imageEntity.repository}${imageEntity.tag ? `:${imageEntity.tag}` : ''}`
          : fallbackImageRefFromId(container.imageId)

        const instance: ContainerInstanceProjection = {
          instanceKey: container.id,
          id: container.id,
          name: container.name,
          status: container.status,
          health: container.health,
          environment: container.environment,
          updatedAt: container.updatedAt,
          serviceId: container.serviceId,
        }

        return {
          id: container.id,
          hash: container.id,
          name: container.name,
          image,
          imageId: container.imageId,
          status: container.status,
          health: container.health,
          environment: container.environment,
          serviceId: container.serviceId,
          healthCheckUrl: deriveRuntimeUrlFromPorts(container.ports),
          domainUrl: null,
          updatedAt: container.updatedAt,
          instanceCount: 1,
          instanceIds: [container.id],
          instances: [instance],
        }
      })
      .filter((container): container is ContainerProjection => container !== null)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [containerEntities, imageEntities])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      return
    }

    const duplicateGroups = containers.filter((container) => container.instanceCount > 1)
    const totalInstances = containers.reduce((acc, container) => acc + container.instanceCount, 0)

    console.info('[docker:containers] grouping diagnostics', {
      totalGroups: containers.length,
      duplicateGroups: duplicateGroups.length,
      totalInstances,
      sampleDuplicateGroups: duplicateGroups.slice(0, 5).map((container) => ({
        name: container.name,
        hash: container.hash,
        instanceCount: container.instanceCount,
      })),
    })
  }, [containers])

  const environments = useMemo(() => {
    return Array.from(
      new Set(
        containers
          .map((container) => container.environment)
          .filter((environment): environment is NonNullable<DockerContainer['environment']> => environment !== null),
      ),
    )
  }, [containers])

  const statuses = useMemo(() => {
    return Array.from(new Set(containers.map((container) => container.status)))
  }, [containers])

  const filteredContainers = useMemo(() => {
    const normalizedSearch = typeof searchTerm === 'string'
      ? searchTerm.trim().toLowerCase()
      : ''

    const filtered = containers.filter((container) => {
      if (savedView === 'failed' && !(container.status === 'dead' || container.status === 'exited' || container.health === 'unhealthy')) return false
      if (savedView === 'active' && container.status !== 'running') return false
      if (savedView === 'production' && container.environment !== 'production') return false
      if (environmentFilter !== 'all' && container.environment !== environmentFilter) {
        return false
      }
      if (statusFilter !== 'all' && container.status !== statusFilter) {
        return false
      }
      if (!normalizedSearch) {
        return true
      }

      return (
        container.name.toLowerCase().includes(normalizedSearch)
        || container.image.toLowerCase().includes(normalizedSearch)
        || container.serviceId.toLowerCase().includes(normalizedSearch)
        || container.status.toLowerCase().includes(normalizedSearch)
      )
    })

    return filtered
  }, [containers, environmentFilter, savedView, searchTerm, statusFilter])

  const isInitialLoading = (liveContainers.data.length === 0 || liveImages.data.length === 0)
    && liveContainers.status !== 'error'
    && liveImages.status !== 'error'

  const containerTableRows = useMemo(() => toContainerTableRows(filteredContainers), [filteredContainers])

  const containerColumns = useMemo(() => createContainerColumns({
    getStatusVariant: toBadgeVariant,
    renderNameCell: (container) => (
      <div className='font-medium'>
        <DockerContainerDetailModalTrigger
          id={container.id}
          container={containerEntityById.get(container.id)}
          onContainerStateChange={handleContainerStateChange}
        >
          {container.name}
        </DockerContainerDetailModalTrigger>
        {container.instanceCount > 1 ? (
          <Badge variant='outline' className='ml-2 text-[10px]'>
            {container.instanceCount} instances
          </Badge>
        ) : null}
      </div>
    ),
    renderImageCell: (container) => (
      <span
        className='font-mono text-xs break-all'
        onMouseEnter={() => {handleImageHover(container.imageId)}}
      >
        {container.imageId ? (
          <DockerImageDetailModalTrigger id={container.imageId}>
            {container.image}
          </DockerImageDetailModalTrigger>
        ) : container.image}
      </span>
    ),
    renderActionsCell: (container) => (
      <div className='flex items-center gap-1.5'>
        <DockerContainerDetailModalTrigger
          id={container.id}
          container={containerEntityById.get(container.id)}
          onContainerStateChange={handleContainerStateChange}
          initialTab='logs'
          className='inline-flex h-7 items-center rounded border border-border/60 px-2 text-xs hover:bg-muted hover:no-underline'
        >
          Logs
        </DockerContainerDetailModalTrigger>
        <DockerContainerDetailModalTrigger
          id={container.id}
          container={containerEntityById.get(container.id)}
          onContainerStateChange={handleContainerStateChange}
          initialTab='terminal'
          className='inline-flex h-7 items-center rounded border border-border/60 px-2 text-xs hover:bg-muted hover:no-underline'
        >
          Shell
        </DockerContainerDetailModalTrigger>
      </div>
    ),
  }), [containerEntityById, handleContainerStateChange, handleImageHover])

  const containerTableFetchData = useMemo(() => createContainerTableFetchData(containerTableRows), [containerTableRows])

  const healthyCount = filteredContainers.filter((container) => container.status === 'running' && container.health === 'healthy').length
  const failedCount = filteredContainers.filter((container) => container.status === 'dead' || container.status === 'exited' || container.health === 'unhealthy').length

  const selectedContainers = selectedContainerRows
  const sharedDaemonGroups = groupedContainerDiagnostics?.sharedDaemonGroups ?? []
  const hasSharedDaemonAcrossNodes = groupedContainerDiagnostics?.hasSharedDaemonAcrossNodes ?? false

  const runSelectionAction = useCallback((action: 'start' | 'stop' | 'restart' | 'update' | 'remove') => {
    if (selectedContainers.length === 0) return

    if (action === 'update') {
      setActionFeedback('Update check scheduled for selected containers.')
      toast.info('Update checks are not wired yet', {
        description: 'Use row selection from DataTable to enable this action.',
      })
      return
    }

    const selectedInstanceIds = Array.from(
      new Set(selectedContainers.flatMap((container) => container.instanceIds)),
    )

    if (selectedInstanceIds.length === 0) {
      setActionFeedback('No container instances available for this action.')
      return
    }

    const label = action.charAt(0).toUpperCase() + action.slice(1)
    setActionFeedback(`${label} in progress for ${String(selectedInstanceIds.length)} container instance${selectedInstanceIds.length > 1 ? 's' : ''}...`)

    void Promise.allSettled(
      selectedInstanceIds.map((containerId) => runContainerActionMutation.mutateAsync({
        containerId,
        action,
      })),
    ).then(async (results) => {
      const successCount = results.filter((result) => result.status === 'fulfilled').length
      const failureCount = results.length - successCount

      await liveContainers.refetch()

      if (successCount > 0) {
        toast.success(`${label} completed`, {
          description: `${String(successCount)} succeeded${failureCount > 0 ? `, ${String(failureCount)} failed` : ''}.`,
        })
      }

      if (failureCount > 0) {
        const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        const message = firstFailure?.reason instanceof Error
          ? firstFailure.reason.message
          : String(firstFailure?.reason ?? 'Unknown error')

        toast.error(`${label} partially failed`, {
          description: message,
        })
      }

      setActionFeedback(`${label}: ${String(successCount)} succeeded${failureCount > 0 ? `, ${String(failureCount)} failed` : ''}.`)

      if (action === 'remove' && successCount > 0) {
        // Selection handled by DataTable internal state.
      }
    })
  }, [liveContainers, runContainerActionMutation, selectedContainers])

  const syncSelectedRows = useCallback((rows: ContainerProjection[]) => {
    const nextSignature = rows
      .map((row) => row.hash)
      .sort()
      .join('|')

    if (nextSignature === selectedContainerRowsSignatureRef.current) {
      return
    }

    selectedContainerRowsSignatureRef.current = nextSignature
    setSelectedContainerRows(rows)
  }, [])

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) {
      return
    }

    setIsRefreshing(true)

    try {
      await Promise.all([
        liveContainers.refetch(),
        liveImages.refetch(),
      ])

      setRefreshTick((previous) => previous + 1)
      setActionFeedback(`Refreshed view #${String(refreshTick + 1)}`)
      toast.success('Container inventory refreshed', {
        description: `Refresh #${String(refreshTick + 1)} completed.`,
      })
    } catch {
      toast.error('Container refresh failed', {
        description: 'Could not fetch latest runtime data.',
      })
    } finally {
      setIsRefreshing(false)
    }
  }, [liveContainers, liveImages, isRefreshing, refreshTick])

  return (
    <>
    <div className="flex h-full min-h-0 flex-col gap-6">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
        <div className="border-b border-border/60 bg-background/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Containers</h2>
              <Badge variant="secondary" className="border border-border/70">{filteredContainers.length}</Badge>
              <span
                className={cn('h-2 w-2 rounded-full', {
                  'bg-emerald-400': runtimeSseState.status === 'connected',
                  'bg-amber-400': runtimeSseState.status === 'connecting',
                  'bg-rose-400': runtimeSseState.status === 'error',
                  'bg-muted-foreground': runtimeSseState.status === 'disconnected',
                })}
              />
              <Badge variant="outline" className="text-[10px]">
                stream: {runtimeSseState.status}
              </Badge>
            </div>

            <div className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(260px,1fr)_170px_170px_170px_180px_110px_auto_auto_auto_auto]">
              <div className="relative min-w-65">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  value={searchTerm}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setListQuery({ q: event.target.value, page: 1 })
                  }}
                  className="h-9 border-border/70 bg-background/70 pl-9"
                  placeholder="Search containers..."
                />
              </div>

              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={statusFilter}
                onChange={(event) => {
                  setListQuery({ status: event.target.value, page: 1 })
                }}
              >
                <option value="all">All statuses</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>

              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={environmentFilter}
                onChange={(event) => {
                  setListQuery({ environment: event.target.value, page: 1 })
                }}
              >
                <option value="all">All environments</option>
                {environments.map((environment) => (
                  <option key={environment} value={environment}>{environment}</option>
                ))}
              </select>

              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={ownershipFilter}
                onChange={(event) => {
                  setListQuery({ ownership: event.target.value as 'all' | DockerContainer['managedBy'], page: 1 })
                }}
              >
                <option value="all">All ownership</option>
                <option value="deployment_service">Managed</option>
                <option value="orphan">Orphan</option>
              </select>

              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={sortBy}
                onChange={(event) => {
                  setListQuery({ sortBy: event.target.value as 'updated' | 'name' | 'status' | 'environment', page: 1 })
                }}
              >
                <option value="updated">Sort: Updated</option>
                <option value="name">Sort: Name</option>
                <option value="status">Sort: Status</option>
                <option value="environment">Sort: Environment</option>
              </select>

              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={sortDirection}
                onChange={(event) => {
                  setListQuery({ sortDirection: event.target.value as 'asc' | 'desc', page: 1 })
                }}
              >
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>

              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => {
                setIsCreateModalOpen(true)
                toast.info('Container create wizard opened')
              }}>
                <Plus className="h-3.5 w-3.5" />
                Create
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => {
                  setActionFeedback('Update check scheduled for visible containers.')
                  toast.info('Update check scheduled', {
                    description: `${String(filteredContainers.length)} visible container${filteredContainers.length > 1 ? 's' : ''}.`,
                  })
                }}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Check updates
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => {
                  setActionFeedback('Prune simulation completed.')
                  toast.success('Prune simulation completed')
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Prune
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                disabled={isRefreshing}
                onClick={() => {
                  void handleRefresh()
                }}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', { 'animate-spin': isRefreshing })} />
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DockerSavedViewSelect
              storageKey="docker:containers:saved-view"
              value={savedView}
              onChange={(value) => {
                setListQuery({ view: value as 'all' | 'failed' | 'active' | 'production', page: 1 })
              }}
              options={[
                { value: 'all', label: 'Saved view: All' },
                { value: 'active', label: 'Saved view: Active only' },
                { value: 'failed', label: 'Saved view: Failed only' },
                { value: 'production', label: 'Saved view: Production only' },
              ]}
            />
            <DockerActiveFilterChips
              chips={[
                ...(searchTerm ? [{ key: 'search', label: 'search', value: searchTerm }] : []),
                ...(environmentFilter !== 'all' ? [{ key: 'environment', label: 'env', value: environmentFilter }] : []),
                ...(statusFilter !== 'all' ? [{ key: 'status', label: 'status', value: statusFilter }] : []),
                ...(ownershipFilter !== 'all' ? [{ key: 'ownership', label: 'ownership', value: ownershipFilter }] : []),
                ...(savedView !== 'all' ? [{ key: 'saved-view', label: 'view', value: savedView }] : []),
              ]}
            />
            <div className="ml-auto">
              <DockerExportActions
                filenameBase="docker-containers"
                rows={filteredContainers.map((container) => ({
                  id: container.id,
                  hash: container.hash,
                  name: container.name,
                  instances: container.instanceCount,
                  image: container.image,
                  status: container.status,
                  environment: container.environment,
                  serviceId: container.serviceId,
                  updatedAt: container.updatedAt,
                }))}
              />
            </div>
          </div>
        </div>
        <div className='px-4 py-2 text-xs'>
          <DockerBatchOperationsBar
            selectedCount={selectedContainers.length}
            resourceLabel="containers"
            onAction={(action) => {
              runSelectionAction(action)
            }}
            onClearSelection={() => {
              selectedContainerRowsSignatureRef.current = ''
              setSelectedContainerRows([])
              toast.info('Selection cleared')
            }}
          />
          {selectedContainers.length > 0 ? (
            <span className="text-muted-foreground">{selectedContainers.length} visible in current filter</span>
          ) : (
            <span className="text-muted-foreground">No containers selected</span>
          )}
        </div>

        {actionFeedback ? (
          <div className="border-b border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">{actionFeedback}</div>
        ) : null}

        {hasSharedDaemonAcrossNodes ? (
          <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <div>
                <p className="font-medium text-amber-200">
                  Shared Docker daemon detected across mesh nodes.
                </p>
                <p className="mt-0.5 text-amber-100/90">
                  {sharedDaemonGroups.map((group) => (
                    <span key={group.daemonId} className="mr-3 inline-block">
                      daemon {shortId(group.daemonId)} seen by {group.nodeIds.map((nodeId) => shortId(nodeId)).join(', ')}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {isInitialLoading ? (
          <div className="px-4 py-3">
            <DockerInlineLoadingState label="Loading containers from runtime inventory…" />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 px-2 pb-2 [&_.table-container]:max-h-[calc(100vh-29rem)] [&_.table-container]:overflow-y-auto">
          <DataTable
            getColumns={() => containerColumns}
            getSubRowColumns={() => []}
            fetchDataFn={containerTableFetchData}
            fetchByIdsFn={async () => []}
            exportConfig={{
              entityName: 'docker-containers',
              headers: ['name', 'image', 'status', 'health', 'environment', 'serviceId', 'updatedAt'],
              columnMapping: {
                name: 'Container',
                image: 'Image',
                status: 'Status',
                health: 'Health',
                environment: 'Environment',
                serviceId: 'Service',
                updatedAt: 'Updated',
              },
              columnWidths: [{ wch: 24 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 24 }],
              enableCsv: true,
              enableExcel: true,
            }}
            idField='rowId'
            pageSizeOptions={[10, 20, 50, 100]}
            renderToolbarContent={({ selectedRows }: { selectedRows: ContainerProjection[] }) => {
              syncSelectedRows(selectedRows)
              return null
            }}
            onRowClick={() => undefined}
            subRowsConfig={{ enabled: false, mode: 'same-columns' }}
            config={{
              enableRowSelection: true,
              enableClickRowSelect: false,
              enableDateFilter: false,
              enableColumnFilters: false,
              enableColumnVisibility: true,
              enableSearch: true,
              enableExport: true,
              enableUrlState: false,
              enableColumnResizing: true,
              enableKeyboardNavigation: true,
              defaultSortBy: 'updatedAt',
              defaultSortOrder: 'desc',
              searchPlaceholder: 'Search containers, image, service…',
              columnResizingTableId: 'docker-containers-enhanced-table',
              size: 'sm',
            }}
          />
        </div>

        <div className="space-y-3 border-t border-border/60 p-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Visible</p>
              <p className="text-base font-semibold">{filteredContainers.length}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Selected</p>
              <p className="text-base font-semibold">{selectedContainers.length}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Healthy</p>
              <p className="text-base font-semibold">{healthyCount}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Failed</p>
              <p className="text-base font-semibold">{failedCount}</p>
            </div>
          </div>

        </div>
      </section>
    </div>

    <DockerCreateContainerModal
      open={isCreateModalOpen}
      onOpenChange={setIsCreateModalOpen}
      onCreated={(payload) => {
        setActionFeedback(
          `Create flow completed for ${payload.name} (${payload.image}) · pull=${payload.pullScanSummary.pullStatus} · scan=${payload.pullScanSummary.scanStatus}`,
        )
        void liveContainers.refetch()
        void liveImages.refetch()
        toast.success(`Container ${payload.name} created`, {
          description: `${payload.image} • pull ${payload.pullScanSummary.pullStatus} • scan ${payload.pullScanSummary.scanStatus}`,
        })
      }}
    />
  </>
  )
}
)