'use client'

import { useMemo, useState } from 'react'
import { DockerBatchOperationsBar, DockerSavedViewSelect } from '../_components/docker-operations-controls'
import { DockerRegistryDetailModalTrigger } from '../_components/docker-registry-detail-modal'
import { DockerActiveFilterChips, DockerColumnSettings, DockerExportActions, DockerSelectionToggle } from '../_components/docker-page-utilities'
import { useDockerDeploymentList, useDockerRegistryList } from '@/domains/docker/mock-hooks'
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
import { Plus, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'

const DEPLOYMENT_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

interface RegistryProjection {
  id: string
  registry: string
  repositoryCount: number
  imageCount: number
  lastSeenAt: string
  repositories: string[]
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function parseImageReference(image: string): { registry: string; repository: string } {
  const [withoutDigestRaw] = image.split('@')
  const withoutDigest = withoutDigestRaw ?? ''
  const tagSeparator = withoutDigest.lastIndexOf(':')
  const slashSeparator = withoutDigest.lastIndexOf('/')
  const withoutTag = tagSeparator > slashSeparator ? withoutDigest.slice(0, tagSeparator) : withoutDigest
  const segments = withoutTag.split('/')

  const first = segments[0] ?? ''
  const hasRegistry = first.includes('.') || first.includes(':') || first === 'localhost'

  if (hasRegistry) {
    return {
      registry: first,
      repository: segments.slice(1).join('/') || 'unknown',
    }
  }

  return {
    registry: 'docker.io',
    repository: segments.join('/') || 'unknown',
  }
}

export default function DashboardDockerRegistryPage() {
  const [isManageRegistryOpen, setIsManageRegistryOpen] = useState(false)
  const [newRegistryHost, setNewRegistryHost] = useState('')
  const [newRegistryRepositories, setNewRegistryRepositories] = useState('library/nginx')
  const [newRegistryAuthMode, setNewRegistryAuthMode] = useState<'token' | 'basic' | 'anonymous'>('token')
  const [localRegistryCatalog, setLocalRegistryCatalog] = useState<RegistryProjection[]>([])
  const [savedView, setSavedView] = useState<'all' | 'high-usage' | 'multi-repo'>('all')
  const [sortBy, setSortBy] = useState<'images' | 'registry' | 'repositories' | 'lastSeen'>('images')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    Registry: true,
    Repositories: true,
    'Images in use': true,
    'Last seen': true,
  })
  const { data: deploymentData } = useDockerDeploymentList(DEPLOYMENT_LIST_INPUT)
  const { data: registryEntityData } = useDockerRegistryList(DEPLOYMENT_LIST_INPUT)
  const deployments = deploymentData?.data ?? []
  const registryEntities = registryEntityData?.data ?? []

  const registryCatalog = useMemo<RegistryProjection[]>(() => {
    const registryIdByName = new Map(registryEntities.map((registry) => [registry.name, registry.id]))
    const grouped = new Map<string, RegistryProjection>()

    for (const deployment of deployments) {
      const image = deployment.containerImage ?? 'unresolved-image'
      const parsed = parseImageReference(image)
      const existing = grouped.get(parsed.registry)

      if (!existing) {
        grouped.set(parsed.registry, {
          id: registryIdByName.get(parsed.registry) ?? parsed.registry,
          registry: parsed.registry,
          repositoryCount: 1,
          imageCount: 1,
          lastSeenAt: deployment.updatedAt,
          repositories: [parsed.repository],
        })
        continue
      }

      existing.imageCount += 1
      if (!existing.repositories.includes(parsed.repository)) {
        existing.repositories.push(parsed.repository)
        existing.repositoryCount = existing.repositories.length
      }
      if (new Date(deployment.updatedAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
        existing.lastSeenAt = deployment.updatedAt
      }
    }

    const derived = Array.from(grouped.values()).sort((a, b) => b.imageCount - a.imageCount)
    return [...localRegistryCatalog, ...derived]
  }, [deployments, localRegistryCatalog, registryEntities])

  function resetManageRegistryForm(): void {
    setNewRegistryHost('')
    setNewRegistryRepositories('library/nginx')
    setNewRegistryAuthMode('token')
  }

  function createRegistryProjection(): void {
    const host = newRegistryHost.trim().toLowerCase()
    if (!host) {
      toast.error('Registry host is required')
      return
    }

    const exists = registryCatalog.some((registry) => registry.registry.toLowerCase() === host)
    if (exists) {
      toast.error('Registry already exists in catalog')
      return
    }

    const repositories = newRegistryRepositories
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    const normalizedRepositories = repositories.length > 0 ? repositories : ['library/nginx']
    const now = new Date().toISOString()
    const created: RegistryProjection = {
      id: `registry-local-${Math.random().toString(36).slice(2, 10)}`,
      registry: host,
      repositoryCount: normalizedRepositories.length,
      imageCount: normalizedRepositories.length,
      lastSeenAt: now,
      repositories: normalizedRepositories,
    }

    setLocalRegistryCatalog((previous) => [created, ...previous])
    setActionFeedback(`Registry ${host} configured (${newRegistryAuthMode})`)
    toast.success('Registry configured', {
      description: host,
    })
    resetManageRegistryForm()
    setIsManageRegistryOpen(false)
  }

  const filteredRegistryCatalog = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = registryCatalog.filter((registry) => {
      if (savedView === 'high-usage' && registry.imageCount < 2) return false
      if (savedView === 'multi-repo' && registry.repositoryCount < 2) return false
      if (!query) return true
      return registry.registry.toLowerCase().includes(query)
    })

    return filtered.sort((a, b) => {
      const multiplier = sortDirection === 'asc' ? 1 : -1
      if (sortBy === 'registry') return a.registry.localeCompare(b.registry) * multiplier
      if (sortBy === 'repositories') return (a.repositoryCount - b.repositoryCount) * multiplier
      if (sortBy === 'lastSeen') return (new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime()) * multiplier
      return (a.imageCount - b.imageCount) * multiplier
    })
  }, [registryCatalog, savedView, searchTerm, sortBy, sortDirection])

  const allVisibleSelected = filteredRegistryCatalog.length > 0 && filteredRegistryCatalog.every((registry) => selectedIds.has(registry.id))
  const selectedVisibleCount = filteredRegistryCatalog.filter((registry) => selectedIds.has(registry.id)).length
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < filteredRegistryCatalog.length

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
        <div className="border-b border-border/60 bg-background/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Registry</h2>
              <Badge variant="secondary" className="border border-border/70">{filteredRegistryCatalog.length}</Badge>
            </div>

            <div className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(260px,1fr)_200px_180px_110px_auto_auto]">
              <div className="relative min-w-65">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value)
                  }}
                  placeholder="Search registry host..."
                  className="h-9 border-border/70 bg-background/70 pl-9"
                />
              </div>

              <DockerSavedViewSelect
                storageKey="docker:registry:saved-view"
                value={savedView}
                onChange={(value) => {
                  setSavedView(value as 'all' | 'high-usage' | 'multi-repo')
                }}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'high-usage', label: 'High usage' },
                  { value: 'multi-repo', label: 'Multi repository' },
                ]}
              />

              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value as 'images' | 'registry' | 'repositories' | 'lastSeen')
                }}
              >
                <option value="images">Sort: Images</option>
                <option value="repositories">Sort: Repositories</option>
                <option value="lastSeen">Sort: Last seen</option>
                <option value="registry">Sort: Registry</option>
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
                setActionFeedback('Registry view refreshed.')
                toast.success('Registry view refreshed')
              }}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
              <Button type="button" size="sm" className="h-9 gap-1.5" onClick={() => setIsManageRegistryOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Manage
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
                filenameBase="docker-registries"
                rows={filteredRegistryCatalog.map((registry) => ({
                  id: registry.id,
                  registry: registry.registry,
                  repositoryCount: registry.repositoryCount,
                  repositories: registry.repositories.join('; '),
                  imageCount: registry.imageCount,
                  lastSeenAt: registry.lastSeenAt,
                }))}
              />
            </div>
          </div>
        </div>

        {actionFeedback ? <div className="border-b border-border/60 bg-muted/20 px-4 py-2 text-xs text-muted-foreground">{actionFeedback}</div> : null}

        <div className="p-4">

          <DockerBatchOperationsBar
            selectedCount={selectedIds.size}
            resourceLabel="registries"
            onAction={(action) => {
              setActionFeedback(`${action} queued for ${String(selectedIds.size)} registr${selectedIds.size > 1 ? 'ies' : 'y'}.`)
              toast.success(`${action} queued`, {
                description: `${String(selectedIds.size)} registr${selectedIds.size > 1 ? 'ies' : 'y'}`,
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
                <TableHead className="w-10">
                  <div className="flex h-7 items-center gap-1">
                    <DockerSelectionToggle
                      ariaLabel="Select all visible registries"
                      pressed={allVisibleSelected}
                      indeterminate={someVisibleSelected}
                      onPressedChange={(pressed) => {
                        if (pressed) {
                          setSelectedIds(new Set(filteredRegistryCatalog.map((registry) => registry.id)))
                        } else {
                          setSelectedIds(new Set())
                        }
                      }}
                    />
                    <Separator orientation="vertical" className="h-full bg-border/80" />
                  </div>
                </TableHead>
                {visibleColumns.Registry ? <TableHead>Registry</TableHead> : null}
                {visibleColumns.Repositories ? <TableHead>Repositories</TableHead> : null}
                {visibleColumns['Images in use'] ? <TableHead>Images in use</TableHead> : null}
                {visibleColumns['Last seen'] ? <TableHead>Last seen</TableHead> : null}
                <TableHead className="w-48">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRegistryCatalog.map((registry) => (
                <TableRow key={registry.registry}>
                  <TableCell>
                    <div className="flex h-7 items-center gap-1">
                      <DockerSelectionToggle
                        ariaLabel={`Select registry ${registry.registry}`}
                        pressed={selectedIds.has(registry.id)}
                        onPressedChange={(pressed) => {
                          setSelectedIds((previous) => {
                            const next = new Set(previous)
                            if (pressed) {
                              next.add(registry.id)
                            } else {
                              next.delete(registry.id)
                            }
                            return next
                          })
                        }}
                      />
                      <Separator orientation="vertical" className="h-full bg-border/80" />
                    </div>
                  </TableCell>
                  {visibleColumns.Registry ? <TableCell className="font-medium">
                    <DockerRegistryDetailModalTrigger id={registry.id}>
                      {registry.registry}
                    </DockerRegistryDetailModalTrigger>
                  </TableCell> : null}
                  {visibleColumns.Repositories ? <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {registry.repositories.slice(0, 3).map((repository) => (
                        <Badge key={repository} variant="outline" className="font-mono text-[10px]">
                          {repository}
                        </Badge>
                      ))}
                      {registry.repositories.length > 3 ? (
                        <Badge variant="secondary">+{registry.repositories.length - 3}</Badge>
                      ) : null}
                    </div>
                  </TableCell> : null}
                  {visibleColumns['Images in use'] ? <TableCell>{registry.imageCount}</TableCell> : null}
                  {visibleColumns['Last seen'] ? <TableCell>{formatDate(registry.lastSeenAt)}</TableCell> : null}
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <DockerRegistryDetailModalTrigger id={registry.id} className="inline-flex h-7 items-center rounded border border-border/60 px-2 text-[11px] hover:bg-muted hover:no-underline">
                        Inspect
                      </DockerRegistryDetailModalTrigger>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => {
                        setActionFeedback(`Pull queued for ${registry.registry}.`)
                        toast.success('Pull queued', {
                          description: registry.registry,
                        })
                      }}>
                        Pull
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => {
                        setActionFeedback(`Copy queued for ${registry.registry}.`)
                        toast.success('Copy queued', {
                          description: registry.registry,
                        })
                      }}>
                        Copy
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredRegistryCatalog.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No registry metadata found yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
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

      <Dialog open={isManageRegistryOpen} onOpenChange={setIsManageRegistryOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage registry</DialogTitle>
            <DialogDescription>Add a registry endpoint to the catalog and make it immediately available in this table.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 text-sm">
            <div className="space-y-1.5">
              <label htmlFor="manage-registry-host" className="text-xs text-muted-foreground">Registry host</label>
              <Input
                id="manage-registry-host"
                value={newRegistryHost}
                onChange={(event) => setNewRegistryHost(event.target.value)}
                placeholder="ghcr.io"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="manage-registry-repositories" className="text-xs text-muted-foreground">Seed repositories (comma separated)</label>
              <Input
                id="manage-registry-repositories"
                value={newRegistryRepositories}
                onChange={(event) => setNewRegistryRepositories(event.target.value)}
                placeholder="org/app, org/worker"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="manage-registry-auth" className="text-xs text-muted-foreground">Auth mode</label>
              <select
                id="manage-registry-auth"
                className="h-9 w-full rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={newRegistryAuthMode}
                onChange={(event) => setNewRegistryAuthMode(event.target.value as 'token' | 'basic' | 'anonymous')}
              >
                <option value="token">token</option>
                <option value="basic">basic</option>
                <option value="anonymous">anonymous</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsManageRegistryOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={createRegistryProjection}>Save registry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
