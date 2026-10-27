'use client'

import { ArrowRight, Server } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AuthDashboardNetworkMesh, AuthDashboardNodesNodeId } from '@/routes'
import { cn } from '@/lib/utils'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { EmptyState, FilteredEmptyState } from '@/components/dashboard'
import { Age } from '../../network/_components/network-copy'
import { CopyButton } from '../../network/_components/copy-button'
import { PresenceBadge } from './presence-badge'
import type { NodePresence } from '../_utils/node-presence'

export interface NodeRow {
  nodeId: string
  displayName: string | null
  serverUrl: string
  status: string
  lastSeenAt: string | null
  maxCpuMillicores: number | null
  maxMemoryMb: number | null
  cpuUsage: number | null
  memoryUsage: number | null
  presence: NodePresence
}

export function nodeLabel(row: { displayName: string | null; nodeId: string }): string {
  return row.displayName === null || row.displayName === '' ? row.nodeId.slice(0, 8) : row.displayName
}

function formatMemory(mb: number | null): string {
  if (mb == null) return 'no limit'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${String(mb)} MB`
}

function pct(value: number | null): string {
  return value == null ? '—' : `${String(Math.round(value * 100))}%`
}

/** Registry status other than `active` is worth saying; `active` only means "not revoked". */
function RegistryStatus({ status }: { status: string }) {
  if (status === 'active') return <span className="text-xs text-muted-foreground">registered</span>
  return <Badge variant="outline" className="font-normal">{status}</Badge>
}

export function NodesTable({
  rows,
  totalCount,
  onClearFilter,
}: {
  rows: readonly NodeRow[]
  totalCount: number
  onClearFilter: () => void
}) {
  const router = useRouter()
  if (totalCount === 0) {
    return (
      <EmptyState
        icon={Server}
        title="No nodes registered yet"
        description="A node appears here once it joins the mesh. Use a join path from Network → Mesh to add one."
        action={{ label: 'Add a node', onClick: () => { router.push(AuthDashboardNetworkMesh()) } }}
      />
    )
  }
  if (rows.length === 0) {
    return <FilteredEmptyState label="No node matches the selected filter." onClear={onClearFilter} />
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Node</TableHead>
          <TableHead>Presence</TableHead>
          <TableHead>Registry</TableHead>
          <TableHead className="text-right">CPU</TableHead>
          <TableHead className="text-right">Memory</TableHead>
          <TableHead>Last seen</TableHead>
          <TableHead className="text-right">Open</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const dim = row.presence === 'offline' || row.presence === 'stale'
          return (
            <TableRow key={row.nodeId} className={cn(row.presence === 'offline' && 'opacity-60')}>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <AuthDashboardNodesNodeId.Link nodeId={row.nodeId} className="font-medium hover:underline">
                    {nodeLabel(row)}
                  </AuthDashboardNodesNodeId.Link>
                  <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    {row.nodeId.slice(0, 8)}
                    <CopyButton value={row.nodeId} label={`Copy node id ${row.nodeId}`} />
                  </span>
                </div>
              </TableCell>
              <TableCell><PresenceBadge presence={row.presence} /></TableCell>
              <TableCell><RegistryStatus status={row.status} /></TableCell>
              <TableCell className="text-right tabular-nums">
                {dim ? <span className="text-muted-foreground">—</span> : pct(row.cpuUsage)}
                <span className="block text-xs text-muted-foreground">
                  {row.maxCpuMillicores != null ? `${(row.maxCpuMillicores / 1000).toFixed(1)} vCPU` : 'no limit'}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {dim ? <span className="text-muted-foreground">—</span> : pct(row.memoryUsage)}
                <span className="block text-xs text-muted-foreground">{formatMemory(row.maxMemoryMb)}</span>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {row.presence === 'this-node' ? 'now' : <Age at={row.lastSeenAt} />}
              </TableCell>
              <TableCell className="text-right">
                <AuthDashboardNodesNodeId.Link
                  nodeId={row.nodeId}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  aria-label={`Open ${nodeLabel(row)}`}
                >
                  Open <ArrowRight className="size-3.5" />
                </AuthDashboardNodesNodeId.Link>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
