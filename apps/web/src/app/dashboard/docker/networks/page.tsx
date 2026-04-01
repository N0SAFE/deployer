'use client'

import { useMemo, useState } from 'react'
import { DockerBatchOperationsBar, DockerSavedViewSelect } from '../_components/docker-operations-controls'
import { DockerActiveFilterChips, DockerColumnSettings, DockerExportActions, DockerSelectionToggle } from '../_components/docker-page-utilities'
import { DockerNetworkDetailModalTrigger } from '../_components/docker-network-detail-modal'
import { useDockerFleetServers, useDockerNetworkList } from '@/domains/docker/mock-hooks'
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

const NETWORK_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

interface NetworkProjection {
  id: string
  name: string
  projectId: string
  serviceCount: number
  activeServiceCount: number
  exposedDomains: string[]
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

export default function DashboardDockerNetworksPage() {
  const [isCreateNetworkOpen, setIsCreateNetworkOpen] = useState(false)
  const [newNetworkName, setNewNetworkName] = useState('')
  const [newNetworkProjectId, setNewNetworkProjectId] = useState('manual-project')
  const [newNetworkDriver, setNewNetworkDriver] = useState<'bridge' | 'overlay' | 'host'>('bridge')
  const [newNetworkSubnet, setNewNetworkSubnet] = useState('172.28.0.0/16')
  const [localNetworks, setLocalNetworks] = useState<NetworkProjection[]>([])
  const [savedView, setSavedView] = useState<'all' | 'bridge' | 'with-containers'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'services' | 'project'>('services')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    Network: true,
    Project: true,
    Services: true,
    Active: true,
    Domains: true,
  })
  const { data: networkData } = useDockerNetworkList(NETWORK_LIST_INPUT)
  const { data: fleetServersData } = useDockerFleetServers()

  const networkEntities = networkData?.data ?? []
  const fleetServers = fleetServersData?.items ?? []

  const networks = useMemo<NetworkProjection[]>(() => {
    const fromApi = networkEntities
      .map((network) => ({
        id: network.id,
        name: network.name,
        projectId: network.labels.projectId ?? network.id,
        serviceCount: network.containerIds.length,
        activeServiceCount: network.containerIds.length,
        exposedDomains: [],
      }))
      .sort((a, b) => b.serviceCount - a.serviceCount)

    return [...localNetworks, ...fromApi]
  }, [localNetworks, networkEntities])

  function resetCreateNetworkForm(): void {
    setNewNetworkName('')
    setNewNetworkProjectId('manual-project')
    setNewNetworkDriver('bridge')
    setNewNetworkSubnet('172.28.0.0/16')
  }

  function createNetwork(): void {
    const safeName = newNetworkName.trim()
    if (!safeName) {
      toast.error('Network name is required')
      return
    }

    const duplicate = networks.some((network) => network.name.toLowerCase() === safeName.toLowerCase())
    if (duplicate) {
      toast.error('Network name already exists')
      return
    }

    const created: NetworkProjection = {
      id: `net-local-${Math.random().toString(36).slice(2, 10)}`,
      name: safeName,
      projectId: newNetworkProjectId.trim() || 'manual-project',
      serviceCount: 0,
      activeServiceCount: 0,
      exposedDomains: newNetworkSubnet.trim() ? [newNetworkSubnet.trim()] : [],
    }

    setLocalNetworks((previous) => [created, ...previous])
    setActionFeedback(`Created network ${safeName} (${newNetworkDriver})`)
    toast.success('Network created', {
      description: safeName,
    })
    resetCreateNetworkForm()
    setIsCreateNetworkOpen(false)
  }

  const filteredNetworks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = networks.filter((network) => {
      if (savedView === 'bridge' && !network.name.includes('bridge')) return false
      if (savedView === 'with-containers' && network.serviceCount === 0) return false
      if (!query) return true
      return network.name.toLowerCase().includes(query) || network.projectId.toLowerCase().includes(query)
    })

    return filtered.sort((a, b) => {
      const multiplier = sortDirection === 'asc' ? 1 : -1
      if (sortBy === 'name') return a.name.localeCompare(b.name) * multiplier
      if (sortBy === 'project') return a.projectId.localeCompare(b.projectId) * multiplier
      return (a.serviceCount - b.serviceCount) * multiplier
    })
  }, [networks, savedView, searchTerm, sortBy, sortDirection])

  const allVisibleSelected = filteredNetworks.length > 0 && filteredNetworks.every((network) => selectedIds.has(network.id))
  const selectedVisibleCount = filteredNetworks.filter((network) => selectedIds.has(network.id)).length
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < filteredNetworks.length

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
        <div className="border-b border-border/60 bg-background/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Networks</h2>
              <Badge variant="secondary" className="border border-border/70">{filteredNetworks.length}</Badge>
            </div>

            <div className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(260px,1fr)_190px_160px_110px_auto_auto_auto]">
              <div className="relative min-w-65">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value)
                  }}
                  placeholder="Search networks..."
                  className="h-9 border-border/70 bg-background/70 pl-9"
                />
              </div>

              <DockerSavedViewSelect
                storageKey="docker:networks:saved-view"
                value={savedView}
                onChange={(value) => {
                  setSavedView(value as 'all' | 'bridge' | 'with-containers')
                }}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'bridge', label: 'Bridge' },
                  { value: 'with-containers', label: 'With containers' },
                ]}
              />

              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value as 'name' | 'services' | 'project')
                }}
              >
                <option value="services">Sort: Services</option>
                <option value="name">Sort: Name</option>
                <option value="project">Sort: Project</option>
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
                setActionFeedback('Network prune queued for unused networks.')
                toast.success('Prune queued for unused networks')
              }}>
                <Trash2 className="h-3.5 w-3.5" />
                Prune
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => {
                setActionFeedback('Network topology refreshed.')
                toast.success('Network topology refreshed')
              }}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
              <Button type="button" size="sm" className="h-9 gap-1.5" onClick={() => setIsCreateNetworkOpen(true)}>
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
                filenameBase="docker-networks"
                rows={filteredNetworks.map((network) => ({
                  id: network.id,
                  name: network.name,
                  projectId: network.projectId,
                  serviceCount: network.serviceCount,
                  activeServiceCount: network.activeServiceCount,
                  domainCount: network.exposedDomains.length,
                }))}
              />
            </div>
          </div>
        </div>

        {actionFeedback ? <div className="border-b border-border/60 bg-muted/20 px-4 py-2 text-xs text-muted-foreground">{actionFeedback}</div> : null}

        <div className="p-4">

          <DockerBatchOperationsBar
            selectedCount={selectedIds.size}
            resourceLabel="networks"
            onAction={(action) => {
              setActionFeedback(`${action} queued for ${String(selectedIds.size)} network${selectedIds.size > 1 ? 's' : ''}.`)
              toast.success(`${action} queued`, {
                description: `${String(selectedIds.size)} network${selectedIds.size > 1 ? 's' : ''}`,
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
                      ariaLabel="Select all visible networks"
                      pressed={allVisibleSelected}
                      indeterminate={someVisibleSelected}
                      onPressedChange={(pressed) => {
                        if (pressed) {
                          setSelectedIds(new Set(filteredNetworks.map((network) => network.id)))
                        } else {
                          setSelectedIds(new Set())
                        }
                      }}
                    />
                    <Separator orientation="vertical" className="h-full bg-border/80" />
                  </div>
                </TableHead>
                {visibleColumns.Network ? <TableHead>Network</TableHead> : null}
                {visibleColumns.Project ? <TableHead>Project</TableHead> : null}
                {visibleColumns.Services ? <TableHead>Services</TableHead> : null}
                {visibleColumns.Active ? <TableHead>Active</TableHead> : null}
                {visibleColumns.Domains ? <TableHead>Domains</TableHead> : null}
                <TableHead className="w-45">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredNetworks.map((network) => (
                <TableRow key={network.id}>
                  <TableCell>
                    <div className="flex h-7 items-center gap-1">
                      <DockerSelectionToggle
                        ariaLabel={`Select network ${network.name}`}
                        pressed={selectedIds.has(network.id)}
                        onPressedChange={(pressed) => {
                          setSelectedIds((previous) => {
                            const next = new Set(previous)
                            if (pressed) {
                              next.add(network.id)
                            } else {
                              next.delete(network.id)
                            }
                            return next
                          })
                        }}
                      />
                      <Separator orientation="vertical" className="h-full bg-border/80" />
                    </div>
                  </TableCell>
                  {visibleColumns.Network ? <TableCell className="font-mono text-xs">
                    <DockerNetworkDetailModalTrigger id={network.id}>
                      {network.name}
                    </DockerNetworkDetailModalTrigger>
                  </TableCell> : null}
                  {visibleColumns.Project ? <TableCell className="font-mono text-xs">{shortId(network.projectId)}</TableCell> : null}
                  {visibleColumns.Services ? <TableCell>{network.serviceCount}</TableCell> : null}
                  {visibleColumns.Active ? <TableCell>{network.activeServiceCount}</TableCell> : null}
                  {visibleColumns.Domains ? <TableCell>{network.exposedDomains.length}</TableCell> : null}
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <DockerNetworkDetailModalTrigger id={network.id} className="inline-flex h-7 items-center rounded border border-border/60 px-2 text-[11px] hover:bg-muted hover:no-underline">
                        Inspect
                      </DockerNetworkDetailModalTrigger>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => {
                        setActionFeedback(`Connect queued for network ${network.name}.`)
                        toast.success('Connect queued', {
                          description: network.name,
                        })
                      }}>
                        Connect
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredNetworks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No network projections yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {fleetServers.slice(0, 3).map((server) => (
              <div key={server.nodeId} className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
                <p className="truncate font-mono text-[11px]">{server.serverUrl}</p>
                <div className="mt-1 flex items-center justify-between">
                  <Badge variant={toBadgeVariant(server.status)}>{server.status}</Badge>
                  <span className="text-muted-foreground">queue {server.metrics?.queueDepth ?? '—'}</span>
                </div>
              </div>
            ))}
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

      <Dialog open={isCreateNetworkOpen} onOpenChange={setIsCreateNetworkOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create network</DialogTitle>
            <DialogDescription>Create a new network projection and make it available for connect/inspect actions.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 text-sm">
            <div className="space-y-1.5">
              <label htmlFor="create-network-name" className="text-xs text-muted-foreground">Network name</label>
              <Input
                id="create-network-name"
                value={newNetworkName}
                onChange={(event) => setNewNetworkName(event.target.value)}
                placeholder="e.g. app-frontend-net"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="create-network-project" className="text-xs text-muted-foreground">Project ID</label>
                <Input
                  id="create-network-project"
                  value={newNetworkProjectId}
                  onChange={(event) => setNewNetworkProjectId(event.target.value)}
                  placeholder="project-main"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="create-network-driver" className="text-xs text-muted-foreground">Driver</label>
                <select
                  id="create-network-driver"
                  className="h-9 w-full rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                  value={newNetworkDriver}
                  onChange={(event) => setNewNetworkDriver(event.target.value as 'bridge' | 'overlay' | 'host')}
                >
                  <option value="bridge">bridge</option>
                  <option value="overlay">overlay</option>
                  <option value="host">host</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="create-network-subnet" className="text-xs text-muted-foreground">Subnet / CIDR</label>
              <Input
                id="create-network-subnet"
                value={newNetworkSubnet}
                onChange={(event) => setNewNetworkSubnet(event.target.value)}
                placeholder="172.28.0.0/16"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsCreateNetworkOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={createNetwork}>Create network</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
