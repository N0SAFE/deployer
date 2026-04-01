'use client'

import { useMemo, useState } from 'react'
import { DockerBatchOperationsBar, DockerSavedViewSelect } from '../_components/docker-operations-controls'
import { DockerVolumeDetailModalTrigger } from '../_components/docker-volume-detail-modal'
import { DockerActiveFilterChips, DockerColumnSettings, DockerExportActions, DockerSelectionToggle } from '../_components/docker-page-utilities'
import { useDockerVolumeList } from '@/domains/docker/mock-hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
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
import { Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

const VOLUME_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

interface VolumeProjection {
  id: string
  name: string
  serviceName: string
  projectId: string
  storageLimit: string
  isActive: boolean
  updatedAt: string
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

export default function DashboardDockerVolumesPage() {
  const [isCreateVolumeOpen, setIsCreateVolumeOpen] = useState(false)
  const [newVolumeName, setNewVolumeName] = useState('')
  const [newVolumeDriver, setNewVolumeDriver] = useState('local')
  const [newVolumeProjectId, setNewVolumeProjectId] = useState('manual-project')
  const [newVolumeServiceId, setNewVolumeServiceId] = useState('manual-service')
  const [newVolumeSizeMb, setNewVolumeSizeMb] = useState('')
  const [localVolumes, setLocalVolumes] = useState<VolumeProjection[]>([])
  const [savedView, setSavedView] = useState<'all' | 'active' | 'inactive'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'updated' | 'state'>('updated')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    Volume: true,
    Service: true,
    Project: true,
    'Storage limit': true,
    State: true,
    Updated: true,
  })
  const { data: volumeData } = useDockerVolumeList(VOLUME_LIST_INPUT)
  const volumeEntities = volumeData?.data ?? []

  const volumes = useMemo<VolumeProjection[]>(() => {
    const fromApi = volumeEntities.map((volume) => ({
      id: volume.id,
      name: volume.name,
      serviceName: volume.labels.serviceId ?? 'n/a',
      projectId: volume.labels.projectId ?? 'n/a',
      storageLimit: volume.sizeBytes === null ? 'unspecified' : `${volume.sizeBytes} bytes`,
      isActive: volume.usedByContainerIds.length > 0,
      updatedAt: volume.updatedAt,
    }))

    return [...localVolumes, ...fromApi]
  }, [localVolumes, volumeEntities])

  function resetCreateVolumeForm(): void {
    setNewVolumeName('')
    setNewVolumeDriver('local')
    setNewVolumeProjectId('manual-project')
    setNewVolumeServiceId('manual-service')
    setNewVolumeSizeMb('')
  }

  function createVolume(): void {
    const safeName = newVolumeName.trim()
    if (!safeName) {
      toast.error('Volume name is required')
      return
    }

    const duplicate = volumes.some((volume) => volume.name.toLowerCase() === safeName.toLowerCase())
    if (duplicate) {
      toast.error('Volume name already exists')
      return
    }

    const parsedMb = Number(newVolumeSizeMb)
    const hasSize = Number.isFinite(parsedMb) && parsedMb > 0
    const storageLimit = hasSize ? `${String(Math.round(parsedMb * 1024 * 1024))} bytes` : 'unspecified'

    const now = new Date().toISOString()
    const created: VolumeProjection = {
      id: `vol-local-${Math.random().toString(36).slice(2, 10)}`,
      name: safeName,
      serviceName: newVolumeServiceId.trim() || 'manual-service',
      projectId: newVolumeProjectId.trim() || 'manual-project',
      storageLimit,
      isActive: false,
      updatedAt: now,
    }

    setLocalVolumes((previous) => [created, ...previous])
    setActionFeedback(`Created volume ${safeName} (${newVolumeDriver})`)
    toast.success('Volume created', {
      description: safeName,
    })
    resetCreateVolumeForm()
    setIsCreateVolumeOpen(false)
  }

  const filteredVolumes = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = volumes.filter((volume) => {
      if (savedView === 'active' && !volume.isActive) return false
      if (savedView === 'inactive' && volume.isActive) return false
      if (!query) return true
      return volume.name.toLowerCase().includes(query) || volume.serviceName.toLowerCase().includes(query)
    })

    return filtered.sort((a, b) => {
      const multiplier = sortDirection === 'asc' ? 1 : -1
      if (sortBy === 'name') return a.name.localeCompare(b.name) * multiplier
      if (sortBy === 'state') return (Number(a.isActive) - Number(b.isActive)) * multiplier
      return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * multiplier
    })
  }, [savedView, searchTerm, volumes, sortBy, sortDirection])

  const allVisibleSelected = filteredVolumes.length > 0 && filteredVolumes.every((volume) => selectedIds.has(volume.id))
  const selectedVisibleCount = filteredVolumes.filter((volume) => selectedIds.has(volume.id)).length
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < filteredVolumes.length
  const activeVolumes = filteredVolumes.filter((volume) => volume.isActive).length

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
      <div className="border-b border-border/60 bg-background/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Volumes</h2>
            <Badge variant="secondary" className="border border-border/70">{filteredVolumes.length}</Badge>
          </div>

          <div className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(260px,1fr)_180px_160px_110px_auto_auto_auto]">
            <div className="relative min-w-65">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value)
                }}
                placeholder="Search volumes..."
                className="h-9 border-border/70 bg-background/70 pl-9"
              />
            </div>

            <DockerSavedViewSelect
              storageKey="docker:volumes:saved-view"
              value={savedView}
              onChange={(value) => {
                setSavedView(value as 'all' | 'active' | 'inactive')
              }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />

            <select
              className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as 'name' | 'updated' | 'state')
              }}
            >
              <option value="updated">Sort: Updated</option>
              <option value="name">Sort: Name</option>
              <option value="state">Sort: State</option>
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
              setActionFeedback('Volume prune queued for unused volumes.')
              toast.success('Prune queued for unused volumes')
            }}>
              <Trash2 className="h-3.5 w-3.5" />
              Prune
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => {
              setActionFeedback('Volume metrics refreshed.')
              toast.success('Volume metrics refreshed')
            }}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button type="button" size="sm" className="h-9 gap-1.5" onClick={() => setIsCreateVolumeOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Create
            </Button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DockerActiveFilterChips
            chips={[
              ...(searchTerm ? [{ key: 'search', label: 'search', value: searchTerm }] : []),
              ...(savedView !== 'all' ? [{ key: 'saved-view', label: 'view', value: savedView }] : []),
            ]}
          />
          <div className="ml-auto">
            <DockerExportActions
              filenameBase="docker-volumes"
              rows={filteredVolumes.map((volume) => ({
                id: volume.id,
                name: volume.name,
                serviceName: volume.serviceName,
                projectId: volume.projectId,
                storageLimit: volume.storageLimit,
                state: volume.isActive ? 'active' : 'inactive',
                updatedAt: volume.updatedAt,
              }))}
            />
          </div>
        </div>
      </div>

      {actionFeedback ? <div className="border-b border-border/60 bg-muted/20 px-4 py-2 text-xs text-muted-foreground">{actionFeedback}</div> : null}

      <div className="p-4">

        <DockerBatchOperationsBar
          selectedCount={selectedIds.size}
          resourceLabel="volumes"
          onAction={(action) => {
            setActionFeedback(`${action} queued for ${String(selectedIds.size)} volume${selectedIds.size > 1 ? 's' : ''}.`)
            toast.success(`${action} queued`, {
              description: `${String(selectedIds.size)} volume${selectedIds.size > 1 ? 's' : ''}`,
            })
          }}
          onClearSelection={() => {
            setSelectedIds(new Set())
          }}
        />

        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">
                <div className="flex h-7 items-center gap-1">
                  <DockerSelectionToggle
                    ariaLabel="Select all visible volumes"
                    pressed={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    onPressedChange={(pressed) => {
                      if (pressed) {
                        setSelectedIds(new Set(filteredVolumes.map((volume) => volume.id)))
                      } else {
                        setSelectedIds(new Set())
                      }
                    }}
                  />
                  <Separator orientation="vertical" className="h-full bg-border/80" />
                </div>
              </TableHead>
              {visibleColumns.Volume ? <TableHead>Volume</TableHead> : null}
              {visibleColumns.Service ? <TableHead>Service</TableHead> : null}
              {visibleColumns.Project ? <TableHead>Project</TableHead> : null}
              {visibleColumns['Storage limit'] ? <TableHead>Storage limit</TableHead> : null}
              {visibleColumns.State ? <TableHead>State</TableHead> : null}
              {visibleColumns.Updated ? <TableHead>Updated</TableHead> : null}
              <TableHead className="w-48">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredVolumes.map((volume) => (
              <TableRow key={volume.id}>
                <TableCell>
                  <div className="flex h-7 items-center gap-1">
                    <DockerSelectionToggle
                      ariaLabel={`Select volume ${volume.name}`}
                      pressed={selectedIds.has(volume.id)}
                      onPressedChange={(pressed) => {
                        setSelectedIds((previous) => {
                          const next = new Set(previous)
                          if (pressed) {
                            next.add(volume.id)
                          } else {
                            next.delete(volume.id)
                          }
                          return next
                        })
                      }}
                    />
                    <Separator orientation="vertical" className="h-full bg-border/80" />
                  </div>
                </TableCell>
                {visibleColumns.Volume ? <TableCell className="font-mono text-xs">
                  <DockerVolumeDetailModalTrigger id={volume.id}>
                    {volume.name}
                  </DockerVolumeDetailModalTrigger>
                </TableCell> : null}
                {visibleColumns.Service ? <TableCell className="font-medium">{volume.serviceName}</TableCell> : null}
                {visibleColumns.Project ? <TableCell className="font-mono text-xs">{shortId(volume.projectId)}</TableCell> : null}
                {visibleColumns['Storage limit'] ? <TableCell>{volume.storageLimit}</TableCell> : null}
                {visibleColumns.State ? <TableCell>
                  <Badge variant={volume.isActive ? 'default' : 'outline'}>
                    {volume.isActive ? 'active' : 'inactive'}
                  </Badge>
                </TableCell> : null}
                {visibleColumns.Updated ? <TableCell>{formatDate(volume.updatedAt)}</TableCell> : null}
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    <DockerVolumeDetailModalTrigger id={volume.id} className="inline-flex h-7 items-center rounded border border-border/60 px-2 text-[11px] hover:bg-muted hover:no-underline">
                      Inspect
                    </DockerVolumeDetailModalTrigger>
                    <DockerVolumeDetailModalTrigger
                      id={volume.id}
                      initialTab="files"
                      className="inline-flex h-7 items-center rounded border border-border/60 px-2 text-[11px] hover:bg-muted hover:no-underline"
                    >
                      Browse
                    </DockerVolumeDetailModalTrigger>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => {
                      setActionFeedback(`Clone queued for volume ${volume.name}.`)
                      toast.success('Clone queued', {
                        description: volume.name,
                      })
                    }}>
                      Clone
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredVolumes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No volumes discovered from service configuration.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
            <p className="text-muted-foreground">Visible</p>
            <p className="text-base font-semibold">{filteredVolumes.length}</p>
          </div>
          <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
            <p className="text-muted-foreground">Selected</p>
            <p className="text-base font-semibold">{selectedIds.size}</p>
          </div>
          <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
            <p className="text-muted-foreground">Active</p>
            <p className="text-base font-semibold">{activeVolumes}</p>
          </div>
          <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
            <p className="text-muted-foreground">Inactive</p>
            <p className="text-base font-semibold">{filteredVolumes.length - activeVolumes}</p>
          </div>
        </div>

        <div className="mt-3">
          <DockerColumnSettings
            title="Column settings"
            columns={visibleColumns}
            onToggle={(column, visible) => {
              setVisibleColumns((previous) => ({ ...previous, [column]: visible }))
            }}
          />
        </div>
      </div>
      </section>

      <Dialog open={isCreateVolumeOpen} onOpenChange={setIsCreateVolumeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create volume</DialogTitle>
            <DialogDescription>Provision a new volume entry and make it available in the table immediately.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 text-sm">
            <div className="space-y-1.5">
              <label htmlFor="create-volume-name" className="text-xs text-muted-foreground">Volume name</label>
              <Input
                id="create-volume-name"
                value={newVolumeName}
                onChange={(event) => setNewVolumeName(event.target.value)}
                placeholder="e.g. postgres-data"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="create-volume-driver" className="text-xs text-muted-foreground">Driver</label>
                <select
                  id="create-volume-driver"
                  className="h-9 w-full rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                  value={newVolumeDriver}
                  onChange={(event) => setNewVolumeDriver(event.target.value)}
                >
                  <option value="local">local</option>
                  <option value="nfs">nfs</option>
                  <option value="tmpfs">tmpfs</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="create-volume-size" className="text-xs text-muted-foreground">Initial size (MB, optional)</label>
                <Input
                  id="create-volume-size"
                  type="number"
                  min="0"
                  value={newVolumeSizeMb}
                  onChange={(event) => setNewVolumeSizeMb(event.target.value)}
                  placeholder="1024"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="create-volume-project" className="text-xs text-muted-foreground">Project ID</label>
                <Input
                  id="create-volume-project"
                  value={newVolumeProjectId}
                  onChange={(event) => setNewVolumeProjectId(event.target.value)}
                  placeholder="project-main"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="create-volume-service" className="text-xs text-muted-foreground">Service ID</label>
                <Input
                  id="create-volume-service"
                  value={newVolumeServiceId}
                  onChange={(event) => setNewVolumeServiceId(event.target.value)}
                  placeholder="service-db"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => {
              setIsCreateVolumeOpen(false)
            }}>
              Cancel
            </Button>
            <Button type="button" onClick={createVolume}>Create volume</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
