'use client'

import { useMemo, useState } from 'react'
import { DockerSavedViewSelect } from '../_components/docker-operations-controls'
import { DockerActiveFilterChips, DockerColumnSettings, DockerExportActions, DockerSelectionToggle } from '../_components/docker-page-utilities'
import { DockerContainerDetailModalTrigger } from '../_components/docker-container-detail-modal'
import { DockerCreateContainerModal } from '../_components/docker-create-container-modal'
import { DockerImageDetailModalTrigger } from '../_components/docker-image-detail-modal'
import { useDockerContainerList, useDockerDeploymentList, useDockerImageList } from '@/domains/docker/mock-hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Plus, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react'
import type { DockerContainer, DockerDeploymentSnapshot } from '@repo/contracts-entities'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const DEPLOYMENT_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

interface ContainerProjection {
  id: string
  name: string
  image: string
  imageId: string | null
  status: DockerContainer['status']
  health: DockerContainer['health']
  environment: DockerContainer['environment']
  serviceId: string
  healthCheckUrl: string | null
  domainUrl: string | null
  updatedAt: string
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
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

function newestByServiceId(deployments: DockerDeploymentSnapshot[]): Map<string, DockerDeploymentSnapshot> {
  const map = new Map<string, DockerDeploymentSnapshot>()
  for (const deployment of deployments) {
    const existing = map.get(deployment.serviceId)
    if (!existing || new Date(deployment.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
      map.set(deployment.serviceId, deployment)
    }
  }
  return map
}

function normalizeImageRef(imageRef: string): string {
  return imageRef.trim().split('@')[0] ?? imageRef.trim()
}

export default function DashboardDockerContainersPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'status' | 'environment'>('updated')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [environmentFilter, setEnvironmentFilter] = useState<'all' | NonNullable<DockerContainer['environment']>>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | DockerContainer['status']>('all')
  const [savedView, setSavedView] = useState<'all' | 'failed' | 'active' | 'production'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    Container: true,
    Image: true,
    Status: true,
    Environment: true,
    Service: true,
    'Health URL': true,
    Logs: true,
    Shell: true,
    Updated: true,
  })

  const { data } = useDockerDeploymentList(DEPLOYMENT_LIST_INPUT)
  const { data: containerEntityData } = useDockerContainerList(DEPLOYMENT_LIST_INPUT)
  const { data: imageEntityData } = useDockerImageList(DEPLOYMENT_LIST_INPUT)
  const deployments = useMemo(() => data?.data ?? [], [data?.data])
  const containerEntities = useMemo(() => containerEntityData?.data ?? [], [containerEntityData?.data])
  const imageEntities = useMemo(() => imageEntityData?.data ?? [], [imageEntityData?.data])

  const containers = useMemo<ContainerProjection[]>(() => {
    const latestDeploymentByServiceId = newestByServiceId(deployments)
    const imageById = new Map(imageEntities.map((image) => [image.id, image]))
    const imageIdByRef = new Map(
      imageEntities.map((image) => [
        `${image.registry}/${image.repository}${image.tag ? `:${image.tag}` : ''}`,
        image.id,
      ]),
    )

    return containerEntities
      .map((container) => {
        const deployment = latestDeploymentByServiceId.get(container.serviceId)
        const imageEntity = container.imageId ? imageById.get(container.imageId) : null
        const image = imageEntity
          ? `${imageEntity.registry}/${imageEntity.repository}${imageEntity.tag ? `:${imageEntity.tag}` : ''}`
          : (deployment?.containerImage ?? 'unresolved-image')
        const imageIdFromRef = imageIdByRef.get(normalizeImageRef(image)) ?? null

        const updatedAt =
          deployment && new Date(deployment.updatedAt).getTime() > new Date(container.updatedAt).getTime()
            ? deployment.updatedAt
            : container.updatedAt

        return {
          id: container.id,
          name: container.name,
          image,
          imageId: imageIdFromRef ?? container.imageId,
          status: container.status,
          health: container.health,
          environment: container.environment ?? deployment?.environment ?? null,
          serviceId: container.serviceId,
          healthCheckUrl: deployment?.healthCheckUrl ?? null,
          domainUrl: deployment?.domainUrl ?? null,
          updatedAt,
        }
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [containerEntities, deployments, imageEntities])

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
    const normalizedSearch = searchTerm.trim().toLowerCase()

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

    return filtered.sort((a, b) => {
      const multiplier = sortDirection === 'asc' ? 1 : -1
      if (sortBy === 'name') return a.name.localeCompare(b.name) * multiplier
      if (sortBy === 'status') return a.status.localeCompare(b.status) * multiplier
      if (sortBy === 'environment') return (a.environment ?? '').localeCompare(b.environment ?? '') * multiplier
      return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * multiplier
    })
  }, [containers, environmentFilter, savedView, searchTerm, statusFilter, sortBy, sortDirection])

  const allVisibleSelected = filteredContainers.length > 0 && filteredContainers.every((container) => selectedIds.has(container.id))
  const selectedVisibleCount = filteredContainers.filter((container) => selectedIds.has(container.id)).length
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < filteredContainers.length
  const healthyCount = filteredContainers.filter((container) => container.status === 'running' && container.health === 'healthy').length
  const failedCount = filteredContainers.filter((container) => container.status === 'dead' || container.status === 'exited' || container.health === 'unhealthy').length

  const selectedContainers = filteredContainers.filter((container) => selectedIds.has(container.id))

  const runSelectionAction = (label: 'Stop' | 'Pause' | 'Restart' | 'Remove') => {
    if (selectedIds.size === 0) return
    setActionFeedback(`${label} queued for ${String(selectedIds.size)} container${selectedIds.size > 1 ? 's' : ''}.`)
    toast.success(`${label} queued`, {
      description: `${String(selectedIds.size)} container${selectedIds.size > 1 ? 's' : ''} selected.`,
    })
    if (label === 'Remove') {
      setSelectedIds(new Set())
    }
  }

  return (
    <>
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
        <div className="border-b border-border/60 bg-background/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Containers</h2>
              <Badge variant="secondary" className="border border-border/70">{filteredContainers.length}</Badge>
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
            </div>

            <div className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(260px,1fr)_170px_170px_180px_110px_auto_auto_auto_auto]">
              <div className="relative min-w-65">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value)
                  }}
                  className="h-9 border-border/70 bg-background/70 pl-9"
                  placeholder="Search containers..."
                />
              </div>

              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as 'all' | DockerContainer['status'])
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
                  setEnvironmentFilter(event.target.value as 'all' | NonNullable<DockerContainer['environment']>)
                }}
              >
                <option value="all">All environments</option>
                {environments.map((environment) => (
                  <option key={environment} value={environment}>{environment}</option>
                ))}
              </select>

              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value as 'updated' | 'name' | 'status' | 'environment')
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
                  setSortDirection(event.target.value as 'asc' | 'desc')
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
                onClick={() => {
                  setRefreshTick((previous) => previous + 1)
                  setActionFeedback(`Refreshed view #${String(refreshTick + 1)}`)
                  toast.success('Container inventory refreshed', {
                    description: `Refresh #${String(refreshTick + 1)} completed.`,
                  })
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DockerSavedViewSelect
              storageKey="docker:containers:saved-view"
              value={savedView}
              onChange={(value) => {
                setSavedView(value as 'all' | 'failed' | 'active' | 'production')
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
                ...(savedView !== 'all' ? [{ key: 'saved-view', label: 'view', value: savedView }] : []),
              ]}
            />
            <div className="ml-auto">
              <DockerExportActions
                filenameBase="docker-containers"
                rows={filteredContainers.map((container) => ({
                  id: container.id,
                  name: container.name,
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
        <div className={cn("flex flex-wrap items-center gap-2 px-4 py-2 text-xs", {"bg-primary/5": selectedIds.size > 0})}>
          {selectedIds.size > 0 ? (
            <>
              <Badge variant="secondary">{selectedIds.size} selected</Badge>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => {
                setSelectedIds(new Set())
                toast.info('Selection cleared')
              }}>Clear</Button>
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => {runSelectionAction('Stop')}}>Stop</Button>
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => {runSelectionAction('Pause')}}>Pause</Button>
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => {runSelectionAction('Restart')}}>Restart</Button>
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => {runSelectionAction('Remove')}}>Remove</Button>
              <span className="ml-auto text-muted-foreground">{selectedContainers.length} visible in current filter</span>
            </>
          ) : <>
              <Button size="sm" variant="ghost" className="h-7 px-2 invisible"></Button>
              <span className="ml-auto text-muted-foreground">No containers selected</span></>}
        </div>

        {actionFeedback ? (
          <div className="border-b border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">{actionFeedback}</div>
        ) : null}

        <div className="overflow-x-auto px-2 pb-2">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">
                <div className="flex h-7 items-center gap-1">
                  <DockerSelectionToggle
                    ariaLabel="Select all visible containers"
                    pressed={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    onPressedChange={(pressed) => {
                      if (pressed) {
                        setSelectedIds(new Set(filteredContainers.map((container) => container.id)))
                      } else {
                        setSelectedIds(new Set())
                      }
                    }}
                  />
                  <Separator orientation="vertical" className="h-full bg-border/80" />
                </div>
              </TableHead>
              {visibleColumns.Container ? <TableHead>Container</TableHead> : null}
              {visibleColumns.Image ? <TableHead>Image</TableHead> : null}
              {visibleColumns.Status ? <TableHead>Status</TableHead> : null}
              {visibleColumns.Environment ? <TableHead>Environment</TableHead> : null}
              {visibleColumns.Service ? <TableHead>Service</TableHead> : null}
              {visibleColumns['Health URL'] ? <TableHead>Health URL</TableHead> : null}
              {visibleColumns.Logs ? <TableHead>Logs</TableHead> : null}
              {visibleColumns.Shell ? <TableHead>Shell</TableHead> : null}
              {visibleColumns.Updated ? <TableHead>Updated</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredContainers.map((container) => (
              <TableRow key={container.id} className={selectedIds.has(container.id) ? 'bg-primary/5' : ''}>
                <TableCell>
                  <div className="flex h-7 items-center gap-1">
                    <DockerSelectionToggle
                      ariaLabel={`Select container ${container.name}`}
                      pressed={selectedIds.has(container.id)}
                      onPressedChange={(pressed) => {
                        setSelectedIds((previous) => {
                          const next = new Set(previous)
                          if (pressed) {
                            next.add(container.id)
                          } else {
                            next.delete(container.id)
                          }
                          return next
                        })
                      }}
                    />
                    <Separator orientation="vertical" className="h-full bg-border/80" />
                  </div>
                </TableCell>
                {visibleColumns.Container ? <TableCell className="font-medium">
                  <DockerContainerDetailModalTrigger id={container.id}>
                    {container.name}
                  </DockerContainerDetailModalTrigger>
                </TableCell> : null}
                {visibleColumns.Image ? <TableCell className="font-mono text-xs break-all">
                  {container.imageId ? (
                    <DockerImageDetailModalTrigger id={container.imageId}>
                      {container.image}
                    </DockerImageDetailModalTrigger>
                  ) : (
                    container.image
                  )}
                </TableCell> : null}
                {visibleColumns.Status ? <TableCell>
                  <Badge variant={toBadgeVariant(container.status)}>{container.status}</Badge>
                  <span className="ml-2 text-xs text-muted-foreground">{container.health}</span>
                </TableCell> : null}
                {visibleColumns.Environment ? <TableCell>{container.environment ?? '—'}</TableCell> : null}
                {visibleColumns.Service ? <TableCell className="font-mono text-xs">{shortId(container.serviceId)}</TableCell> : null}
                {visibleColumns['Health URL'] ? <TableCell className="text-xs break-all">{container.healthCheckUrl ?? container.domainUrl ?? '—'}</TableCell> : null}
                {visibleColumns.Logs ? <TableCell>
                  <DockerContainerDetailModalTrigger
                    id={container.id}
                    initialTab="logs"
                    className="inline-flex h-7 items-center rounded border border-border/60 px-2 text-xs hover:bg-muted hover:no-underline"
                  >
                    Logs
                  </DockerContainerDetailModalTrigger>
                </TableCell> : null}
                {visibleColumns.Shell ? <TableCell>
                  <DockerContainerDetailModalTrigger
                    id={container.id}
                    initialTab="terminal"
                    className="inline-flex h-7 items-center rounded border border-border/60 px-2 text-xs hover:bg-muted hover:no-underline"
                  >
                    Shell
                  </DockerContainerDetailModalTrigger>
                </TableCell> : null}
                {visibleColumns.Updated ? <TableCell>{formatDate(container.updatedAt)}</TableCell> : null}
              </TableRow>
            ))}
            {filteredContainers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  No containers match your filters.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
          </Table>
        </div>

        <div className="space-y-3 border-t border-border/60 p-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Visible</p>
              <p className="text-base font-semibold">{filteredContainers.length}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Selected</p>
              <p className="text-base font-semibold">{selectedIds.size}</p>
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

          <DockerColumnSettings
            title="Column settings"
            columns={visibleColumns}
            onToggle={(column, visible) => {
              setVisibleColumns((previous) => ({ ...previous, [column]: visible }))
            }}
          />

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
        toast.success(`Container ${payload.name} created`, {
          description: `${payload.image} • pull ${payload.pullScanSummary.pullStatus} • scan ${payload.pullScanSummary.scanStatus}`,
        })
      }}
    />
  </>
  )
}
