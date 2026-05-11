'use client'

import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { z } from 'zod'
import { DockerSavedViewSelect } from '../_components/docker-operations-controls'
import { DockerInlineLoadingState } from '../_components/docker-loading-states'
import { DockerCreateContainerModal } from '../_components/docker-create-container-modal'
import {
  DockerActiveFilterChips,
  DockerExportActions,
} from '../_components/docker-page-utilities'
import { DockerImageDetailModal } from '../_components/docker-image-detail-modal'
import {
  useDockerDeploymentList,
  useDockerImageEventsStream,
  useDockerImageList,
} from '@/domains/docker/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@repo/ui/components/shadcn/command'
import { Input } from '@repo/ui/components/shadcn/input'
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/shadcn/popover'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Download, Loader2, Play, RefreshCw, Search, Shield, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@repo/ui/components/data-table/data-table'
import { useSafeQueryStatesFromZod } from '@/utils/useSafeQueryStatesFromZod'
import {
  createImageColumns,
  createImageSubRowColumns,
  createImageTableFetchData,
} from './columns'
import {
  buildImageGroupRows,
  formatBytes,
  formatDate,
  type ImageGroupRow,
  type TagSelectionOption,
} from './models'
import {
  applyImageFilters,
  buildImageActiveFilterChips,
  imageFilterConfig,
  mapImageSortByToTableSort,
} from './filter-config'

const DEPLOYMENT_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

const IMAGE_LIST_QUERY_SCHEMA = z.object({
  q: z.string().default(''),
  view: z.enum(['all', 'failed', 'popular']).default('all'),
  sortBy: z.enum(['usage', 'name', 'failed', 'lastSeen']).default('usage'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(20),
})

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
        <Command className="w-full">
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">{title}</div>
          <CommandInput className="h-9" placeholder="Search tag..." />
          <CommandList className="max-h-72 overflow-auto">
            <CommandEmpty className="py-3 text-xs text-muted-foreground">{emptyMessage}</CommandEmpty>
            <CommandGroup className="p-1">
              {options.map((option) => (
                <CommandItem
                  className="px-2 py-1.5"
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

function ImagesTableLoadingSkeleton() {
  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-5 gap-3 px-2'>
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-full' />
        <Skeleton className='h-6 w-full' />
      </div>
      <div className='space-y-2'>
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={`image-table-loading-row-${String(index)}`} className='grid grid-cols-5 gap-3 rounded-md border border-border/40 p-3'>
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-14' />
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-4 w-32' />
            <Skeleton className='h-4 w-16 justify-self-end' />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DashboardDockerImagesPage() {
  const [listQuery, setListQuery] = useSafeQueryStatesFromZod(IMAGE_LIST_QUERY_SCHEMA)
  const [inspectImageId, setInspectImageId] = useState<string | null>(null)
  const [inspectInitialTab, setInspectInitialTab] = useState<'overview' | 'layers' | 'security' | 'labels'>('overview')
  const [runImageRef, setRunImageRef] = useState<string | null>(null)
  const [createModalMode, setCreateModalMode] = useState<'run' | 'pull-scan'>('run')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [selectedImageRows, setSelectedImageRows] = useState<ImageGroupRow[]>([])
  const selectedImageRowsSignatureRef = useRef('')
  const { data: deploymentData, isLoading: isDeploymentLoading } = useDockerDeploymentList(DEPLOYMENT_LIST_INPUT)
  const { data: imageEntityData, isLoading: isImageLoading } = useDockerImageList(DEPLOYMENT_LIST_INPUT)
  useDockerImageEventsStream({ query: {} })
  const deployments = deploymentData?.data ?? []
  const imageEntities = imageEntityData?.data ?? []

  const searchTerm = listQuery.q
  const savedView = listQuery.view
  const sortBy = listQuery.sortBy
  const sortDirection = listQuery.sortDirection

  const imageGroups = useMemo<ImageGroupRow[]>(() => buildImageGroupRows(deployments, imageEntities), [deployments, imageEntities])

  const filteredGroups = useMemo(() => applyImageFilters(imageGroups, {
    q: searchTerm,
    view: savedView,
  }), [imageGroups, savedView, searchTerm])

  const imageTableRows = filteredGroups

  const pullTagOptionsByRepository = useMemo(() => {
    const byRepository = new Map<string, TagSelectionOption[]>()

    for (const group of imageGroups) {
      const options = group.subRows
        .filter((tag) => tag.tag !== '<untagged>')
        .map((tag) => ({
          value: tag.imageRef,
          label: tag.tag,
          description: `${tag.shortId} • ${formatBytes(tag.sizeBytes)} • last seen ${formatDate(tag.lastSeenAt)}`,
        }))

      byRepository.set(group.repositoryKey, options)
    }

    return byRepository
  }, [imageGroups])

  const imageColumns = useMemo(() => createImageColumns({
    ActionMenu: ImageActionTagMenu,
    getPullOptions: (repositoryKey) => pullTagOptionsByRepository.get(repositoryKey) ?? [],
    buildTagOptions: (group) => group.subRows.map((tag) => ({
      value: tag.imageRef,
      label: tag.tag,
      description: `${tag.shortId} • ${formatBytes(tag.sizeBytes)} • last seen ${formatDate(tag.lastSeenAt)}`,
    })),
    onRunSelect: (selectedImageRef) => {
      setCreateModalMode('run')
      setRunImageRef(selectedImageRef)
      setIsCreateModalOpen(true)
      toast.info('Run setup opened', {
        description: selectedImageRef,
      })
    },
    onPullSelect: (selectedImageRef) => {
      setCreateModalMode('pull-scan')
      setRunImageRef(selectedImageRef)
      setIsCreateModalOpen(true)
      toast.info('Pull & scan opened', {
        description: selectedImageRef,
      })
    },
  }), [pullTagOptionsByRepository])

  const imageSubRowColumns = useMemo(() => createImageSubRowColumns({
    onOpenImageDetail: (imageId) => {
      setInspectImageId(imageId)
      setInspectInitialTab('overview')
    },
  }), [])

  const imageTableFetchData = useMemo(() => createImageTableFetchData(imageTableRows), [imageTableRows])
  const tableSortBy = mapImageSortByToTableSort(sortBy)

  const failedImages = filteredGroups.filter((group) => group.failed > 0).length
  const isInitialLoading = (isDeploymentLoading || isImageLoading) && imageGroups.length === 0
  const isSyncing = isDeploymentLoading || isImageLoading

  const syncSelectedRows = useCallback((rows: ImageGroupRow[]) => {
    const nextSignature = rows
      .map((row) => row.rowId)
      .sort()
      .join('|')

    if (nextSignature === selectedImageRowsSignatureRef.current) {
      return
    }

    selectedImageRowsSignatureRef.current = nextSignature
    setSelectedImageRows(rows)
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
      <div className="border-b border-border/60 bg-background/70 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Images</h2>
            <Badge variant="secondary" className="border border-border/70">{filteredGroups.length}</Badge>
            <Badge variant="outline" className="text-[10px]">
              {isSyncing ? 'syncing…' : 'synced'}
            </Badge>
          </div>

          <div className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(260px,1fr)_180px_170px_120px_auto_auto_auto]">
            <div className="relative min-w-65">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={searchTerm}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setListQuery({ q: event.target.value, page: 1 })
                }}
                placeholder="Search images..."
                className="h-9 border-border/70 bg-background/70 pl-9"
              />
            </div>

            <DockerSavedViewSelect
              storageKey="docker:images:saved-view"
              value={savedView}
              onChange={(value) => {
                  setListQuery({ view: value as 'all' | 'failed' | 'popular', page: 1 })
              }}
              options={[...imageFilterConfig.savedViewOptions]}
            />

            <select
              className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
              value={sortBy}
              onChange={(event) => {
                setListQuery({ sortBy: event.target.value as 'usage' | 'name' | 'failed' | 'lastSeen', page: 1 })
              }}
            >
              {imageFilterConfig.sortByOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <select
              className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
              value={sortDirection}
              onChange={(event) => {
                setListQuery({ sortDirection: event.target.value as 'asc' | 'desc', page: 1 })
              }}
            >
              {imageFilterConfig.sortDirectionOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => {
              if (selectedImageRows.length === 0) {
                toast.info('Select at least one image row first')
                return
              }

              setActionFeedback(`Prune queued for ${String(selectedImageRows.length)} selected image group${selectedImageRows.length > 1 ? 's' : ''}.`)
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
              selectedImageRowsSignatureRef.current = ''
              setSelectedImageRows([])
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
            chips={buildImageActiveFilterChips({
              q: searchTerm,
              view: savedView,
              sortBy,
              sortDirection,
            })}
          />
          <div className="ml-auto">
            <DockerExportActions
              filenameBase="docker-images"
              rows={filteredGroups.map((group) => ({
                id: group.rowId,
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

      {isInitialLoading ? (
        <div className='px-4 py-3'>
          <DockerInlineLoadingState
            label='Loading image catalog from runtime and deployment usage…'
            className='transition-opacity duration-200'
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 p-4 [&_.table-container]:max-h-[calc(100vh-27rem)] [&_.table-container]:overflow-y-auto">

        {isInitialLoading ? (
          <ImagesTableLoadingSkeleton />
        ) : (
          <DataTable
            key={`images-table-${tableSortBy}-${sortDirection}`}
          getColumns={() => imageColumns}
          getSubRowColumns={() => imageSubRowColumns}
          fetchDataFn={imageTableFetchData}
          fetchByIdsFn={async () => []}
          exportConfig={{
            entityName: 'docker-images',
            headers: ['repositoryKey', 'tagsCount', 'totalSizeBytes', 'usageCount', 'failed', 'lastSeenAt'],
            columnMapping: {
              repositoryKey: 'Image',
              tagsCount: 'Tags',
              totalSizeBytes: 'Size (bytes)',
              usageCount: 'Usage',
              failed: 'Failed',
              lastSeenAt: 'Updated',
            },
            columnWidths: [{ wch: 40 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 24 }],
            enableCsv: true,
            enableExcel: true,
          }}
          idField='rowId'
          pageSizeOptions={[10, 20, 50, 100]}
          renderToolbarContent={({ selectedRows }: { selectedRows: ImageGroupRow[] }) => {
            syncSelectedRows(selectedRows)
            return null
          }}
          onRowClick={() => undefined}
          subRowsConfig={{
            enabled: true,
            mode: 'custom-columns',
            subRowsField: 'subRows',
            showSubRowHeaders: false,
            hideExpandIconWhenSingle: false,
          }}
          config={{
            enableRowSelection: true,
            enableClickRowSelect: false,
            enableDateFilter: false,
            enableColumnFilters: false,
            enableColumnVisibility: true,
            enableSearch: false,
            enableExport: true,
            enableUrlState: false,
            enableColumnResizing: true,
            enableKeyboardNavigation: true,
              defaultSortBy: tableSortBy,
              defaultSortOrder: sortDirection,
            searchPlaceholder: 'Search images or tags…',
            columnResizingTableId: 'docker-images-enhanced-table',
            size: 'sm',
          }}
        />
        )}

        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Visible</p>
              <p className="text-base font-semibold">{filteredGroups.length}</p>
            </div>
            <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Selected</p>
              <p className="text-base font-semibold">{selectedImageRows.length}</p>
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
        </div>
      </div>
      </section>

      {inspectImageId ? (
        <DockerImageDetailModal
          id={inspectImageId}
          open={inspectImageId !== null}
          initialTab={inspectInitialTab}
          onRunImage={(imageRef) => {
            setCreateModalMode('run')
            setRunImageRef(imageRef)
            setIsCreateModalOpen(true)
          }}
          onOpenChange={(open) => {
            if (!open) {
              setInspectImageId(null)
              setInspectInitialTab('overview')
            }
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
