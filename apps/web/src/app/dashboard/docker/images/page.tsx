'use client'

import { useMemo, useState } from 'react'
import { z } from 'zod'
import { Boxes } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@deployer/ui/components/data-table/data-table'
import { useSafeQueryParamStatesFromZod } from '@deployer/use-safe-query-param-states-from-zod'
import { EmptyState, FilteredEmptyState, StatStrip, StatStripItem } from '@/components/dashboard'
import { AuthDashboardDockerImages } from '@/routes/index'
import { useDockerDeploymentList, useDockerImageEventsStream, useDockerImageList } from '@/domains/docker/hooks'
import { DockerCreateContainerModal } from '../_components/docker-create-container-modal'
import { DockerEngineError } from '../_components/docker-engine-error'
import { DockerPageSkeleton } from '../_components/docker-loading-states'
import { DockerImageDetailModal } from '../_components/docker-image-detail-modal'
import { ImageActionTagMenu } from './_components/image-action-tag-menu'
import { ImagesToolbar } from './_components/images-toolbar'
import { createImageColumns, createImageSubRowColumns, createImageTableFetchData } from './columns'
import { buildImageGroupRows, formatBytes, formatDate, type ImageGroupRow, type TagSelectionOption } from './models'
import { applyImageFilters, buildImageActiveFilterChips, mapImageSortByToTableSort } from './filter-config'

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

export default AuthDashboardDockerImages.Route(function DashboardDockerImagesPage() {
  const [listQuery, setListQuery] = useSafeQueryParamStatesFromZod(IMAGE_LIST_QUERY_SCHEMA)
  const [inspectImageId, setInspectImageId] = useState<string | null>(null)
  const [runImageRef, setRunImageRef] = useState<string | null>(null)
  const [createModalMode, setCreateModalMode] = useState<'run' | 'pull-scan'>('run')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const deploymentQuery = useDockerDeploymentList(DEPLOYMENT_LIST_INPUT)
  const imageQuery = useDockerImageList(DEPLOYMENT_LIST_INPUT)
  useDockerImageEventsStream({ query: {} })
  const deployments = useMemo(() => deploymentQuery.data?.data ?? [], [deploymentQuery.data])
  const imageEntities = useMemo(() => imageQuery.data?.data ?? [], [imageQuery.data])

  const { q: searchTerm, view: savedView, sortBy, sortDirection } = listQuery
  const imageGroups = useMemo<ImageGroupRow[]>(() => buildImageGroupRows(deployments, imageEntities), [deployments, imageEntities])
  const filteredGroups = useMemo(() => applyImageFilters(imageGroups, { q: searchTerm, view: savedView }), [imageGroups, savedView, searchTerm])

  const tagOptions = (group: ImageGroupRow): TagSelectionOption[] => group.subRows
    .filter((tag) => tag.tag !== '<untagged>')
    .map((tag) => ({
      value: tag.imageRef,
      label: tag.tag,
      description: `${tag.shortId} • ${formatBytes(tag.sizeBytes)} • last seen ${formatDate(tag.lastSeenAt)}`,
    }))

  const pullTagOptionsByRepository = useMemo(
    () => new Map(imageGroups.map((group) => [group.repositoryKey, tagOptions(group)])),
    [imageGroups],
  )

  const openCreate = (mode: 'run' | 'pull-scan', imageRef: string | null) => {
    setCreateModalMode(mode)
    setRunImageRef(imageRef)
    setIsCreateModalOpen(true)
  }

  const imageColumns = useMemo(() => createImageColumns({
    ActionMenu: ImageActionTagMenu,
    getPullOptions: (repositoryKey) => pullTagOptionsByRepository.get(repositoryKey) ?? [],
    buildTagOptions: (group) => group.subRows.map((tag) => ({
      value: tag.imageRef,
      label: tag.tag,
      description: `${tag.shortId} • ${formatBytes(tag.sizeBytes)} • last seen ${formatDate(tag.lastSeenAt)}`,
    })),
    onRunSelect: (ref) => { openCreate('run', ref) },
    onPullSelect: (ref) => { openCreate('pull-scan', ref) },
  }), [pullTagOptionsByRepository])

  const imageSubRowColumns = useMemo(() => createImageSubRowColumns({ onOpenImageDetail: setInspectImageId }), [])
  const imageTableFetchData = useMemo(() => createImageTableFetchData(filteredGroups), [filteredGroups])
  const tableSortBy = mapImageSortByToTableSort(sortBy)

  const failedImages = filteredGroups.filter((group) => group.failed > 0).length
  const isInitialLoading = (deploymentQuery.isLoading || imageQuery.isLoading) && imageGroups.length === 0
  const loadError = imageQuery.error ?? deploymentQuery.error
  const isRefreshing = imageQuery.isFetching || deploymentQuery.isFetching
  const filtering = searchTerm.trim() !== '' || savedView !== 'all'

  const refresh = () => {
    void imageQuery.refetch()
    void deploymentQuery.refetch()
    toast.success('Refreshing image inventory')
  }

  if (isInitialLoading) return <DockerPageSkeleton label="Loading images from this node's engine…" columns={5} />

  return (
    <div className="space-y-4">
      {loadError ? <DockerEngineError what="images" error={loadError} onRetry={refresh} isRetrying={isRefreshing} /> : null}

      <section className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
        <ImagesToolbar
          filters={{ q: searchTerm, view: savedView, sortBy, sortDirection }}
          onChange={(patch) => { setListQuery({ ...patch, page: 1 }) }}
          onPull={() => { openCreate('pull-scan', null) }}
          onRefresh={refresh}
          isRefreshing={isRefreshing}
          chips={buildImageActiveFilterChips({ q: searchTerm, view: savedView, sortBy, sortDirection })}
          exportRows={filteredGroups.map((group) => ({
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

        <div className="p-4">
          {imageGroups.length === 0 && !loadError ? (
            <EmptyState
              icon={Boxes}
              title="No images on this node"
              description="Images appear after a pull, build or deployment. Pull one to get started."
              action={{ label: 'Pull image', onClick: () => { openCreate('pull-scan', null) } }}
            />
          ) : filteredGroups.length === 0 && filtering ? (
            <FilteredEmptyState label="No images match these filters." onClear={() => { setListQuery({ q: '', view: 'all', page: 1 }) }} />
          ) : (
            <div className="[&_.table-container]:max-h-[calc(100vh-27rem)] [&_.table-container]:overflow-auto">
              <DataTable
                key={`images-table-${tableSortBy}-${sortDirection}`}
                getColumns={() => imageColumns}
                getSubRowColumns={() => imageSubRowColumns}
                fetchDataFn={imageTableFetchData}
                fetchByIdsFn={() => Promise.resolve<ImageGroupRow[]>([])}
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
                idField="rowId"
                pageSizeOptions={[10, 20, 50, 100]}
                onRowClick={() => undefined}
                subRowsConfig={{
                  enabled: true,
                  mode: 'custom-columns',
                  subRowsField: 'subRows',
                  showSubRowHeaders: false,
                  hideExpandIconWhenSingle: false,
                }}
                config={{
                  enableRowSelection: false,
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
            </div>
          )}

          <StatStrip bare className="mt-3">
            <StatStripItem label="Showing" value={filteredGroups.length} hint={filtering ? `of ${String(imageGroups.length)}` : undefined} />
            <StatStripItem label="With failed deployments" value={failedImages} tone={failedImages > 0 ? 'danger' : undefined} />
            <StatStripItem label="Used by deployments" value={filteredGroups.reduce((sum, group) => sum + group.usageCount, 0)} />
          </StatStrip>
          <p className="mt-2 text-xs text-muted-foreground">Removing and pruning images is not available from the dashboard yet; use the node&apos;s Docker CLI.</p>
        </div>
      </section>

      {inspectImageId ? (
        <DockerImageDetailModal
          id={inspectImageId}
          open
          initialTab="overview"
          onRunImage={(imageRef) => { openCreate('run', imageRef) }}
          onOpenChange={(open) => { if (!open) setInspectImageId(null) }}
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
            toast.success(`Container ${payload.name} prepared`, { description: `From image ${payload.image}` })
          }
        }}
      />
    </div>
  )
})
