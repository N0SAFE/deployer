'use client'

import { HardDrive } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import type { DockerVolume } from '@deployer/contracts-entities'
import { EmptyState, FilteredEmptyState } from '@/components/dashboard'
import { DockerCopyButton } from '../../_components/docker-copy-button'
import { DockerRelativeTime } from '../../_components/docker-relative-time'
import { DockerTableSkeleton } from '../../_components/docker-loading-states'
import { DockerVolumeDetailModalTrigger } from '../../_components/docker-volume-detail-modal'
import { formatBytes, shortId } from '../../_utils/format'
import { isVolumeInUse } from '../_utils/volumes'

const LINK_BUTTON = 'inline-flex h-8 items-center rounded-md border border-border/60 px-3 text-sm hover:bg-muted hover:no-underline'

export function VolumesTable({ rows, isLoading, hasFilters, totalCount, onClearFilters }: {
  rows: readonly DockerVolume[]
  isLoading: boolean
  hasFilters: boolean
  totalCount: number
  onClearFilters: () => void
}) {
  if (isLoading) return <DockerTableSkeleton columns={6} label="Loading volumes from this node…" />
  if (totalCount === 0) {
    return (
      <EmptyState
        icon={HardDrive}
        title="No volumes on this node"
        description="Named volumes appear here once a container creates or mounts one. Anonymous volumes are listed too."
      />
    )
  }
  if (rows.length === 0 && hasFilters) return <FilteredEmptyState label="No volumes match these filters." onClear={onClearFilters} />

  return (
    <Table stickyHeader>
      <TableHeader>
        <TableRow>
          <TableHead>Volume</TableHead>
          <TableHead>Mountpoint</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Used by</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((volume) => {
          const inUse = isVolumeInUse(volume)
          return (
            <TableRow key={volume.id}>
              <TableCell>
                <DockerVolumeDetailModalTrigger id={volume.id} className="font-mono text-sm font-medium underline-offset-4 hover:underline">
                  <span className="break-all">{volume.name}</span>
                </DockerVolumeDetailModalTrigger>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>{volume.driver}</span>
                  <code className="font-mono" title={volume.id}>{volume.id.length > 20 ? shortId(volume.id, 12) : volume.id}</code>
                  <DockerCopyButton value={volume.id} label="volume ID" />
                </div>
              </TableCell>
              <TableCell>
                {volume.mountpoint ? (
                  <span className="inline-flex items-center gap-1">
                    <code className="max-w-56 truncate font-mono text-xs" title={volume.mountpoint}>{volume.mountpoint}</code>
                    <DockerCopyButton value={volume.mountpoint} label="mountpoint" />
                  </span>
                ) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums" title={volume.sizeBytes === null ? 'The engine did not report a size for this volume' : undefined}>
                {formatBytes(volume.sizeBytes)}
              </TableCell>
              <TableCell>
                {inUse ? (
                  <Badge variant="default" title="Removing a volume that containers use would break them">
                    {volume.usedByContainerIds.length} container{volume.usedByContainerIds.length === 1 ? '' : 's'}
                  </Badge>
                ) : <Badge variant="outline">unused</Badge>}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground"><DockerRelativeTime value={volume.updatedAt} /></TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1.5">
                  <DockerVolumeDetailModalTrigger id={volume.id} className={LINK_BUTTON}>Inspect</DockerVolumeDetailModalTrigger>
                  <DockerVolumeDetailModalTrigger id={volume.id} initialTab="files" className={LINK_BUTTON}>Browse</DockerVolumeDetailModalTrigger>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
