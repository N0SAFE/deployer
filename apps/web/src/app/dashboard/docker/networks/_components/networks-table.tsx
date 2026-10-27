'use client'

import { Network as NetworkIcon } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import type { DockerNetwork } from '@deployer/contracts-entities'
import { EmptyState, FilteredEmptyState } from '@/components/dashboard'
import { DockerCopyButton } from '../../_components/docker-copy-button'
import { DockerRelativeTime } from '../../_components/docker-relative-time'
import { DockerTableSkeleton } from '../../_components/docker-loading-states'
import { DockerNetworkDetailModalTrigger } from '../../_components/docker-network-detail-modal'
import { shortId } from '../../_utils/format'
import { isBuiltInNetwork } from '../_utils/networks'

export function NetworksTable({ rows, isLoading, hasFilters, totalCount, onClearFilters }: {
  rows: readonly DockerNetwork[]
  isLoading: boolean
  /** True when a search/view filter is applied: decides empty vs filtered-empty. */
  hasFilters: boolean
  totalCount: number
  onClearFilters: () => void
}) {
  if (isLoading) return <DockerTableSkeleton columns={6} label="Loading networks from this node…" />
  if (totalCount === 0) {
    return (
      <EmptyState
        icon={NetworkIcon}
        title="No networks on this node"
        description="Docker normally always has bridge, host and none. An empty list usually means the engine could not be read."
      />
    )
  }
  if (rows.length === 0 && hasFilters) return <FilteredEmptyState label="No networks match these filters." onClear={onClearFilters} />

  return (
    <Table stickyHeader>
      <TableHeader>
        <TableRow>
          <TableHead>Network</TableHead>
          <TableHead>Driver</TableHead>
          <TableHead>Subnet</TableHead>
          <TableHead className="text-right">Containers</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Inspect</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((network) => (
          <TableRow key={network.id}>
            <TableCell>
              <div className="flex flex-wrap items-center gap-2">
                <DockerNetworkDetailModalTrigger id={network.id} className="font-mono text-sm font-medium underline-offset-4 hover:underline">
                  {network.name}
                </DockerNetworkDetailModalTrigger>
                {isBuiltInNetwork(network.name) ? <Badge variant="outline" title="Docker creates this network and does not allow removing it">built-in</Badge> : null}
                {network.internal ? <Badge variant="outline" title="Containers on an internal network cannot reach the outside world">internal</Badge> : null}
              </div>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <code className="font-mono" title={network.id}>{shortId(network.id)}</code>
                <DockerCopyButton value={network.id} label="network ID" />
              </span>
            </TableCell>
            <TableCell>
              <span className="font-mono text-xs">{network.driver}</span>
              <span className="ml-1 text-xs text-muted-foreground">{network.scope}</span>
            </TableCell>
            <TableCell className="font-mono text-xs">{network.subnet ?? <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="text-right tabular-nums">
              {network.containerIds.length > 0 ? network.containerIds.length : <span className="text-muted-foreground">unused</span>}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground"><DockerRelativeTime value={network.createdAt} /></TableCell>
            <TableCell>
              <DockerNetworkDetailModalTrigger id={network.id} className="inline-flex h-8 items-center rounded-md border border-border/60 px-3 text-sm hover:bg-muted hover:no-underline">
                Inspect
              </DockerNetworkDetailModalTrigger>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
