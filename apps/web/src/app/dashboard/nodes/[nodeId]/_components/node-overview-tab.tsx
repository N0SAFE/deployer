'use client'

import { Cpu, HardDrive, Info, Server } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { EmptyState, StatStrip, StatStripItem, StatusBadge } from '@/components/dashboard'
import { Age } from '../../../network/_components/network-copy'
import { CopyableMono } from '../../../network/_components/copy-button'
import { NodeNetworkCard } from '../../../network/_components/node-network-card'
import { PresenceBadge } from '../../_components/presence-badge'
import type { NodePresence } from '../../_utils/node-presence'

export interface NodeDetail {
  nodeId: string
  serverUrl: string
  displayName: string | null
  status: string
  lastSeenAt: string | null
  maxCpuMillicores: number | null
  maxMemoryMb: number | null
  cpuUsage: number | null
  memoryUsage: number | null
}

export interface AllocationRow {
  id: string
  allocationMode: string
  cpuMillicores: number
  memoryMb: number
  maxServices: number | null
  isEnabled: boolean
}

export function formatMemory(mb: number | null | undefined): string {
  if (mb == null) return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${String(mb)} MB`
}

function pct(value: number | null): string {
  return value == null ? '—' : `${String(Math.round(value * 100))}%`
}

export function NodeOverviewTab({
  node,
  presence,
  lifecycleState,
  roles,
  allocations,
}: {
  node: NodeDetail
  presence: NodePresence
  lifecycleState: string | null
  roles: readonly string[]
  allocations: readonly AllocationRow[]
}) {
  const live = presence === 'online' || presence === 'this-node'
  return (
    <div className="space-y-5">
      <StatStrip>
        <StatStripItem icon={Server} label="Presence" value={<PresenceBadge presence={presence} />} />
        <StatStripItem
          icon={Cpu}
          label="CPU"
          value={live ? pct(node.cpuUsage) : '—'}
          hint={node.maxCpuMillicores != null ? `${(node.maxCpuMillicores / 1000).toFixed(1)} vCPU limit` : 'no limit'}
        />
        <StatStripItem
          icon={HardDrive}
          label="Memory"
          value={live ? pct(node.memoryUsage) : '—'}
          hint={node.maxMemoryMb != null ? `${formatMemory(node.maxMemoryMb)} limit` : 'no limit'}
        />
        <StatStripItem icon={Info} label="Last seen" value={presence === 'this-node' ? 'now' : <Age at={node.lastSeenAt} />} />
      </StatStrip>

      {live ? null : (
        <p role="note" className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          This node is not connected to the mesh right now, so CPU and memory are not shown — the last values it
          reported would read as current.
        </p>
      )}

      <NodeNetworkCard nodeId={node.nodeId} />

      <Card>
        <CardHeader>
          <CardTitle>Identity and registry</CardTitle>
          <CardDescription>How the node registry and the live mesh membership describe this node.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Node id"><CopyableMono value={node.nodeId} label="Copy node id" /></Row>
          <Row label="Endpoint"><CopyableMono value={node.serverUrl} label="Copy endpoint" /></Row>
          <Row label="Registry status">
            <span title="The registry record only: “active” means not revoked, not that the machine is up.">
              {node.status}
            </span>
          </Row>
          <Row label="Mesh lifecycle">{lifecycleState ?? 'not in the live membership'}</Row>
          <Row label="Roles">{roles.length > 0 ? roles.join(', ') : '—'}</Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allocation</CardTitle>
          <CardDescription>The resource budget the fleet grants this node.</CardDescription>
        </CardHeader>
        <CardContent>
          {allocations.length === 0 ? (
            <EmptyState
              compact
              icon={Cpu}
              title="No allocation for this node"
              description="Without an allocation the scheduler does not place services here. Grant one under Nodes → Capacity & admissions."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">CPU</TableHead>
                  <TableHead className="text-right">Memory</TableHead>
                  <TableHead className="text-right">Max services</TableHead>
                  <TableHead>Enabled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.allocationMode}</TableCell>
                    <TableCell className="text-right tabular-nums">{(a.cpuMillicores / 1000).toFixed(1)} vCPU</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMemory(a.memoryMb)}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.maxServices ?? 'unlimited'}</TableCell>
                    <TableCell>
                      <StatusBadge status={a.isEnabled ? 'active' : 'inactive'}>
                        {a.isEnabled ? 'Enabled' : 'Disabled'}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  )
}
