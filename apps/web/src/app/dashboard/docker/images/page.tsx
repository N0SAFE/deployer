'use client'

import { Fragment, useMemo, useState } from 'react'
import { DockerBatchOperationsBar, DockerSavedViewSelect } from '../_components/docker-operations-controls'
import { DockerCreateContainerModal } from '../_components/docker-create-container-modal'
import {
  DockerActiveFilterChips,
  DockerColumnSettings,
  DockerExpandedTableRow,
  DockerExpandableRowToggle,
  DockerExportActions,
  DockerSelectionToggle,
} from '../_components/docker-page-utilities'
import { DockerImageDetailModal } from '../_components/docker-image-detail-modal'
import { useDockerDeploymentList, useDockerImageList, useDockerRegistryList } from '@/domains/docker/mock-hooks'
import { getMockRegistryRepositories } from '@/mocks/platform/entities/docker.large.mock'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@repo/ui/components/shadcn/command'
import { Input } from '@repo/ui/components/shadcn/input'
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/shadcn/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Download, Loader2, Play, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Separator } from '@repo/ui/components/shadcn/separator'

const DEPLOYMENT_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

interface ImageTagProjection {
  id: string
  imageRef: string
  tag: string
  shortId: string
  sizeBytes: number | null
  createdAt: string
  lastSeenAt: string
  usageCount: number
  successful: number
  failed: number
}

interface ImageGroupProjection {
  id: string
  repositoryKey: string
  repositoryLabel: string
  tags: ImageTagProjection[]
  tagsCount: number
  totalSizeBytes: number
  usageCount: number
  successful: number
  failed: number
  lastSeenAt: string
}

interface TagSelectionOption {
  value: string
  label: string
  description: string
}

interface ImageActionTagMenuProps {
  title: string
  icon: 'run' | 'pull'
  options: TagSelectionOption[]
  loading?: boolean
  emptyMessage: string
  onSelect: (value: string) => void
}

function ImageActionTagMenu({ title, icon, options, loading = false, emptyMessage, onSelect }: ImageActionTagMenuProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={title}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon === 'run' ? <Play className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">{title}</div>
          <CommandInput placeholder="Search tag..." />
          <CommandList className="max-h-72 overflow-auto">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.description}`}
                  onSelect={() => {
                    onSelect(option.value)
                    setOpen(false)
                  }}
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[11px]">{option.label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{option.description}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value < 1024) return `${(String(value))} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function DashboardDockerImagesPage() {
  const [savedView, setSavedView] = useState<'all' | 'failed' | 'popular'>('all')
  const [sortBy, setSortBy] = useState<'usage' | 'name' | 'failed' | 'lastSeen'>('usage')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedRepositories, setExpandedRepositories] = useState<Set<string>>(new Set())
  const [inspectImageId, setInspectImageId] = useState<string | null>(null)
  const [runImageRef, setRunImageRef] = useState<string | null>(null)
  const [createModalMode, setCreateModalMode] = useState<'run' | 'pull-scan'>('run')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    Image: true,
    Tags: true,
    Size: true,
    Updated: true,
  })
  const { data: deploymentData } = useDockerDeploymentList(DEPLOYMENT_LIST_INPUT)
  const { data: imageEntityData } = useDockerImageList(DEPLOYMENT_LIST_INPUT)
  const { data: registryEntityData, isLoading: isRegistryLoading } = useDockerRegistryList(DEPLOYMENT_LIST_INPUT)
  const deployments = deploymentData?.data ?? []
  const imageEntities = imageEntityData?.data ?? []
  const registryEntities = registryEntityData?.data ?? []

  const imageGroups = useMemo<ImageGroupProjection[]>(() => {
    const deploymentStatsByImageRef = new Map<string, { usage: number; successful: number; failed: number }>()

    for (const deployment of deployments) {
      const imageRef = deployment.containerImage ?? 'unresolved-image'
      const stats = deploymentStatsByImageRef.get(imageRef) ?? { usage: 0, successful: 0, failed: 0 }
      stats.usage += 1
      if (deployment.status === 'success') stats.successful += 1
      if (deployment.status === 'failed') stats.failed += 1
      deploymentStatsByImageRef.set(imageRef, stats)
    }

    const grouped = new Map<string, ImageGroupProjection>()

    for (const image of imageEntities) {
      const repositoryKey = `${image.registry}/${image.repository}`
      const tag = image.tag ?? 'latest'
      const imageRef = `${repositoryKey}:${tag}`
      const stats = deploymentStatsByImageRef.get(imageRef)
      const tagProjection: ImageTagProjection = {
        id: image.id,
        imageRef,
        tag,
        shortId: image.id.slice(0, 12),
        sizeBytes: image.sizeBytes,
        createdAt: image.createdAt,
        lastSeenAt: image.lastSeenAt,
        usageCount: stats?.usage ?? 0,
        successful: stats?.successful ?? 0,
        failed: stats?.failed ?? 0,
      }

      const existing = grouped.get(repositoryKey)
      if (!existing) {
        grouped.set(repositoryKey, {
          id: image.id,
          repositoryKey,
          repositoryLabel: image.repository,
          tags: [tagProjection],
          tagsCount: 1,
          totalSizeBytes: image.sizeBytes ?? 0,
          usageCount: tagProjection.usageCount,
          successful: tagProjection.successful,
          failed: tagProjection.failed,
          lastSeenAt: tagProjection.lastSeenAt,
        })
        continue
      }

      existing.tags.push(tagProjection)
      existing.tagsCount += 1
      existing.totalSizeBytes += image.sizeBytes ?? 0
      existing.usageCount += tagProjection.usageCount
      existing.successful += tagProjection.successful
      existing.failed += tagProjection.failed

      if (new Date(tagProjection.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
        existing.lastSeenAt = tagProjection.lastSeenAt
      }
    }

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        tags: [...group.tags].sort((a, b) => {
          if (a.tag === 'latest') return -1
          if (b.tag === 'latest') return 1
          return a.tag.localeCompare(b.tag)
        }),
      }))
      .sort((a, b) => b.usageCount - a.usageCount)
  }, [deployments, imageEntities])

  const filteredGroups = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    const filtered = imageGroups.filter((group) => {
      if (savedView === 'failed' && group.failed === 0) return false
      if (savedView === 'popular' && group.usageCount < 2) return false
      if (!query) return true
      return group.repositoryKey.toLowerCase().includes(query) || group.tags.some((tag) => tag.tag.toLowerCase().includes(query))
    })

    return filtered.sort((a, b) => {
      const multiplier = sortDirection === 'asc' ? 1 : -1
      if (sortBy === 'name') return a.repositoryKey.localeCompare(b.repositoryKey) * multiplier
      if (sortBy === 'failed') return (a.failed - b.failed) * multiplier
      if (sortBy === 'lastSeen') return (new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime()) * multiplier
      return (a.usageCount - b.usageCount) * multiplier
    })
  }, [imageGroups, savedView, searchTerm, sortBy, sortDirection])

  const pullTagOptionsByRepository = useMemo(() => {
    const byRepository = new Map<string, TagSelectionOption[]>()

    for (const group of imageGroups) {
      const [registryHost, ...repositoryParts] = group.repositoryKey.split('/')
      const repositoryPath = repositoryParts.join('/')
      if (!registryHost || !repositoryPath) {
        byRepository.set(group.repositoryKey, [])
        continue
      }

      const registry = registryEntities.find((entry) => entry.name === registryHost)
      if (!registry) {
        byRepository.set(group.repositoryKey, [])
        continue
      }

      const repoDetails = getMockRegistryRepositories(registry)
      const matchedRepo = repoDetails.find((entry) => entry.repository === repositoryPath)
      const options = (matchedRepo?.tags ?? []).map((tag) => {
        const imageRef = `${group.repositoryKey}:${tag.name}`
        return {
          value: imageRef,
          label: tag.name,
          description: `${tag.size} • pushed ${formatDate(tag.pushedAt)}`,
        }
      })

      byRepository.set(group.repositoryKey, options)
    }

    return byRepository
  }, [imageGroups, registryEntities])

  const allVisibleSelected = filteredGroups.length > 0 && filteredGroups.every((group) => selectedIds.has(group.id))
  const selectedVisibleCount = filteredGroups.filter((group) => selectedIds.has(group.id)).length
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < filteredGroups.length
  const failedImages = filteredGroups.filter((group) => group.failed > 0).length
  const tableColumnCount = 1 + (visibleColumns.Image ? 1 : 0) + (visibleColumns.Tags ? 1 : 0) + (visibleColumns.Size ? 1 : 0) + (visibleColumns.Updated ? 1 : 0) + 1

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
      <div className="border-b border-border/60 bg-background/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Images</h2>
            <Badge variant="secondary" className="border border-border/70">{filteredGroups.length}</Badge>
          </div>

          <div className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(260px,1fr)_180px_170px_120px_auto_auto_auto]">
            <div className="relative min-w-65">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value)
                }}
                placeholder="Search images..."
                className="h-9 border-border/70 bg-background/70 pl-9"
              />
            </div>

            <DockerSavedViewSelect
              storageKey="docker:images:saved-view"
              value={savedView}
              onChange={(value) => {
                setSavedView(value as 'all' | 'failed' | 'popular')
              }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'failed', label: 'Failed' },
                { value: 'popular', label: 'Popular' },
              ]}
            />

            <select
              className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as 'usage' | 'name' | 'failed' | 'lastSeen')
              }}
            >
              <option value="usage">Sort: Usage</option>
              <option value="name">Sort: Name</option>
              <option value="failed">Sort: Failed</option>
              <option value="lastSeen">Sort: Last seen</option>
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
              setSelectedIds(new Set())
              setActionFeedback('Prune queued for selected image set.')
              toast.success('Prune queued for selected images')
            }}>
              <Trash2 className="h-3.5 w-3.5" />
              Prune
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => {
                setCreateModalMode('pull-scan')
                setRunImageRef(null)
                setIsCreateModalOpen(true)
                toast.info('Pull & scan flow opened', {
                  description: 'Choose an image to pull layers and run security scan.',
                })
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Pull
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => {
              setActionFeedback('Image inventory refreshed.')
              toast.success('Image inventory refreshed')
            }}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
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
              filenameBase="docker-images"
              rows={filteredGroups.map((group) => ({
                id: group.id,
                repository: group.repositoryKey,
                tags: group.tagsCount,
                totalSizeBytes: group.totalSizeBytes,
                usageCount: group.usageCount,
                successful: group.successful,
                failed: group.failed,
                lastSeenAt: group.lastSeenAt,
              }))}
            />
          </div>
        </div>
      </div>

      {actionFeedback ? <div className="border-b border-border/60 bg-muted/20 px-4 py-2 text-xs text-muted-foreground">{actionFeedback}</div> : null}

      <div className="p-4">

        <DockerBatchOperationsBar
          selectedCount={selectedIds.size}
          resourceLabel="images"
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
                    ariaLabel="Select all visible images"
                    pressed={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    onPressedChange={(pressed) => {
                      if (pressed) {
                        setSelectedIds(new Set(filteredGroups.map((group) => group.id)))
                      } else {
                        setSelectedIds(new Set())
                      }
                    }}
                  />
                  <Separator orientation="vertical" className="h-full bg-border/80" />
                </div>
              </TableHead>
              {visibleColumns.Image ? <TableHead>Image</TableHead> : null}
              {visibleColumns.Tags ? <TableHead>Tags</TableHead> : null}
              {visibleColumns.Size ? <TableHead>Size</TableHead> : null}
              {visibleColumns.Updated ? <TableHead>Updated</TableHead> : null}
              <TableHead className="w-52.5">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredGroups.map((group) => {
              const isExpanded = expandedRepositories.has(group.repositoryKey)
              return (
                <Fragment key={group.repositoryKey}>
                  <TableRow>
                    <TableCell>
                      <div className="flex h-7 items-center gap-1">
                        <DockerSelectionToggle
                          ariaLabel={`Select image ${group.repositoryKey}`}
                          pressed={selectedIds.has(group.id)}
                          onPressedChange={(pressed) => {
                            setSelectedIds((previous) => {
                              const next = new Set(previous)
                              if (pressed) {
                                next.add(group.id)
                              } else {
                                next.delete(group.id)
                              }
                              return next
                            })
                          }}
                        />
                        <Separator orientation="vertical" className="h-full bg-border/80" />
                        <DockerExpandableRowToggle
                          expanded={isExpanded}
                          ariaLabel={isExpanded ? 'Collapse image tags' : 'Expand image tags'}
                          onToggle={() => {
                            setExpandedRepositories((previous) => {
                              const next = new Set(previous)
                              if (next.has(group.repositoryKey)) {
                                next.delete(group.repositoryKey)
                              } else {
                                next.add(group.repositoryKey)
                              }
                              return next
                            })
                          }}
                        />
                      </div>
                    </TableCell>
                    {visibleColumns.Image ? (
                      <TableCell className="font-mono text-xs break-all">{group.repositoryKey}</TableCell>
                    ) : null}
                    {visibleColumns.Tags ? <TableCell><Badge variant="outline">{group.tagsCount}</Badge></TableCell> : null}
                    {visibleColumns.Size ? <TableCell>{formatBytes(group.totalSizeBytes)}</TableCell> : null}
                    {visibleColumns.Updated ? <TableCell>{formatDate(group.lastSeenAt)}</TableCell> : null}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <ImageActionTagMenu
                          title="Run container from pulled tags"
                          icon="run"
                          options={group.tags.map((tag) => ({
                            value: tag.imageRef,
                            label: tag.tag,
                            description: `${tag.shortId} • ${formatBytes(tag.sizeBytes)} • last seen ${formatDate(tag.lastSeenAt)}`,
                          }))}
                          emptyMessage="No pulled tags available"
                          onSelect={(selectedImageRef) => {
                            setCreateModalMode('run')
                            setRunImageRef(selectedImageRef)
                            setIsCreateModalOpen(true)
                            toast.info('Run setup opened', {
                              description: selectedImageRef,
                            })
                          }}
                        />
                        <ImageActionTagMenu
                          title="Pull tag from registry"
                          icon="pull"
                          loading={isRegistryLoading}
                          options={pullTagOptionsByRepository.get(group.repositoryKey) ?? []}
                          emptyMessage={isRegistryLoading ? 'Loading tags from registry…' : 'No registry tags found for this repository'}
                          onSelect={(selectedImageRef) => {
                            setCreateModalMode('pull-scan')
                            setRunImageRef(selectedImageRef)
                            setIsCreateModalOpen(true)
                            toast.info('Pull & scan opened', {
                              description: selectedImageRef,
                            })
                          }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>

                  <DockerExpandedTableRow expanded={isExpanded} colSpan={tableColumnCount} cellClassName="p-0">
                        <div className="px-3 py-2">
                          <div className="overflow-x-auto rounded border border-border/60">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/40">
                                <tr>
                                  <th className="px-3 py-2 text-left font-medium">Tag</th>
                                  <th className="px-3 py-2 text-left font-medium">ID</th>
                                  <th className="px-3 py-2 text-left font-medium">Size</th>
                                  <th className="px-3 py-2 text-left font-medium">Created</th>
                                  <th className="px-3 py-2 text-left font-medium">Used by</th>
                                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.tags.map((tag) => (
                                  <tr
                                    key={tag.id}
                                    className="cursor-pointer border-t border-border/50 transition-colors hover:bg-muted/40"
                                    onClick={() => {setInspectImageId(tag.id)}}
                                  >
                                    <td className="px-3 py-2 font-medium">{tag.tag}</td>
                                    <td className="px-3 py-2 font-mono text-muted-foreground">{tag.shortId}</td>
                                    <td className="px-3 py-2">{formatBytes(tag.sizeBytes)}</td>
                                    <td className="px-3 py-2 text-muted-foreground">{formatDate(tag.createdAt)}</td>
                                    <td className="px-3 py-2">
                                      {tag.usageCount > 0 ? `${String(tag.usageCount)} container${tag.usageCount > 1 ? 's' : ''}` : 'unused'}
                                    </td>
                                    <td className="px-3 py-2" onClick={(event) => {event.stopPropagation()}}>
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          title="Run image"
                                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                          onClick={() => {
                                            setCreateModalMode('run')
                                            setRunImageRef(tag.imageRef)
                                            setIsCreateModalOpen(true)
                                            toast.info('Run setup opened', {
                                              description: tag.imageRef,
                                            })
                                          }}
                                        >
                                          <Play className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          title="Export image"
                                          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                          onClick={() => {
                                            setActionFeedback(`Export queued for ${tag.imageRef}`)
                                            toast.success('Export queued', {
                                              description: tag.imageRef,
                                            })
                                          }}
                                        >
                                          <Download className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                  </DockerExpandedTableRow>
                </Fragment>
              )
            })}
            {filteredGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={tableColumnCount} className="py-8 text-center text-muted-foreground">
                  No image metadata is available yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        </div>

        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Visible</p>
              <p className="text-base font-semibold">{filteredGroups.length}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Selected</p>
              <p className="text-base font-semibold">{selectedIds.size}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Failed refs</p>
              <p className="text-base font-semibold">{failedImages}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Total usage</p>
              <p className="text-base font-semibold">{filteredGroups.reduce((sum, group) => sum + group.usageCount, 0)}</p>
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
      </div>
      </section>

      {inspectImageId ? (
        <DockerImageDetailModal
          id={inspectImageId}
          open={inspectImageId !== null}
          onRunImage={(imageRef) => {
            setCreateModalMode('run')
            setRunImageRef(imageRef)
            setIsCreateModalOpen(true)
          }}
          onOpenChange={(open) => {
            if (!open) setInspectImageId(null)
          }}
        />
      ) : null}

      <DockerCreateContainerModal
        open={isCreateModalOpen}
        onOpenChange={(open) => {
          setIsCreateModalOpen(open)
          if (!open) {
            setRunImageRef(null)
            setCreateModalMode('run')
          }
        }}
        prefilledImage={runImageRef ?? undefined}
        autoPull={createModalMode === 'pull-scan'}
        skipPullTab={createModalMode === 'run'}
        pullScanOnly={createModalMode === 'pull-scan'}
        onCreated={(payload) => {
          if (createModalMode === 'run') {
            setActionFeedback(`Run flow completed for image ${payload.image} as container ${payload.name}.`)
            toast.success(`Container ${payload.name} prepared`, {
              description: `From image ${payload.image}`,
            })
          }
        }}
      />
    </div>
  )
}
