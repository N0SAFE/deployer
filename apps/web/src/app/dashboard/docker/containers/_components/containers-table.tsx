'use client'

import type { DockerContainer } from '@repo/contracts-entities'
import { Checkbox } from '@repo/ui/components/shadcn/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { EnvironmentBadge, FilteredEmptyState } from '@/components/dashboard'
import { cn } from '@/lib/utils'
import { DockerContainerDetailModalTrigger } from '../../_components/container-detail-modal'
import { DockerCopyableId } from '../../_components/docker-copy-button'
import { DockerImageDetailModalTrigger } from '../../_components/docker-image-detail-modal'
import { DockerRelativeTime } from '../../_components/docker-relative-time'
import { shortId } from '../../_utils/format'
import { CONTAINER_COLUMNS, type ContainerColumn } from '../columns'
import type { ContainerAction, ContainerRow, ContainerSortKey } from '../_models/container-list.model'
import { ContainerRowActions } from './container-row-actions'
import { ContainerStatusCell } from './container-status-cell'

const COLUMN_COUNT = CONTAINER_COLUMNS.length + 2

function SortableHead({ column, sortBy, sortDirection, onSort }: {
  column: ContainerColumn
  sortBy: ContainerSortKey
  sortDirection: 'asc' | 'desc'
  onSort: (key: ContainerSortKey) => void
}) {
  const { sortKey } = column
  if (!sortKey) return <TableHead className={column.className}>{column.label}</TableHead>
  const active = sortBy === sortKey
  const Icon = !active ? ArrowUpDown : sortDirection === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead
      className={column.className}
      aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={cn('inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60', active ? 'text-foreground' : 'text-muted-foreground')}
        onClick={() => { onSort(sortKey) }}
      >
        {column.label}
        <Icon className="size-3" aria-hidden />
      </button>
    </TableHead>
  )
}

/**
 * The containers table: sticky header, sortable columns, row selection, and status/ids/ports
 * rendered the way the rest of Node engine does (badge, monospace + copy, relative time).
 * It scrolls inside its own container, never the page.
 */
export function ContainersTable({
  rows,
  entityById,
  selectedIds,
  sortBy,
  sortDirection,
  actionsDisabled,
  onSort,
  onToggleRow,
  onToggleAll,
  onStateChange,
  onAction,
  onClearFilters,
}: {
  rows: readonly ContainerRow[]
  entityById: ReadonlyMap<string, DockerContainer>
  selectedIds: ReadonlySet<string>
  sortBy: ContainerSortKey
  sortDirection: 'asc' | 'desc'
  actionsDisabled: boolean
  onSort: (key: ContainerSortKey) => void
  onToggleRow: (id: string, selected: boolean) => void
  onToggleAll: (selected: boolean) => void
  onStateChange: () => void
  onAction: (action: ContainerAction, rows: ContainerRow[]) => void
  onClearFilters: () => void
}) {
  const selectedOnPage = rows.filter((row) => selectedIds.has(row.id)).length
  const allSelected = rows.length > 0 && selectedOnPage === rows.length

  return (
    <Table stickyHeader containerClassName="max-h-[65vh]" aria-label="Containers on this node">
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label="Select all containers on this page"
              checked={allSelected ? true : selectedOnPage > 0 ? 'indeterminate' : false}
              onCheckedChange={(checked) => { onToggleAll(checked === true) }}
            />
          </TableHead>
          {CONTAINER_COLUMNS.map((column) => (
            <SortableHead key={column.id} column={column} sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
          ))}
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={COLUMN_COUNT}>
              <FilteredEmptyState label="No containers match these filters." onClear={onClearFilters} />
            </TableCell>
          </TableRow>
        ) : null}
        {rows.map((row) => {
          const entity = entityById.get(row.id)
          return (
            <TableRow key={row.id} data-state={selectedIds.has(row.id) ? 'selected' : undefined}>
              <TableCell>
                <Checkbox
                  aria-label={`Select ${row.name}`}
                  checked={selectedIds.has(row.id)}
                  onCheckedChange={(checked) => { onToggleRow(row.id, checked === true) }}
                />
              </TableCell>
              <TableCell>
                <div className="space-y-0.5">
                  <DockerContainerDetailModalTrigger id={row.id} container={entity} onContainerStateChange={onStateChange}>
                    <span className="font-medium">{row.name}</span>
                  </DockerContainerDetailModalTrigger>
                  <div><DockerCopyableId value={row.id} short={shortId(row.id, 12)} label="container ID" /></div>
                </div>
              </TableCell>
              <TableCell>
                <span className="break-all font-mono text-xs">
                  {row.imageId ? (
                    <DockerImageDetailModalTrigger id={row.imageId}>{row.image}</DockerImageDetailModalTrigger>
                  ) : row.image}
                </span>
              </TableCell>
              <TableCell><ContainerStatusCell row={row} /></TableCell>
              <TableCell>
                {row.ports.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  <ul className="space-y-0.5">
                    {row.ports.map((port) => <li key={port} className="font-mono text-xs">{port}</li>)}
                  </ul>
                )}
              </TableCell>
              <TableCell>
                {row.environment ? <EnvironmentBadge environment={row.environment} /> : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                <DockerCopyableId value={row.serviceId} short={shortId(row.serviceId, 8)} label="service ID" />
              </TableCell>
              <TableCell className="text-right text-muted-foreground"><DockerRelativeTime value={row.updatedAt} /></TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <ContainerRowActions row={row} entity={entity} onStateChange={onStateChange} onAction={onAction} disabled={actionsDisabled} />
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
