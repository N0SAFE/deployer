'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Cpu } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { EmptyState } from '@/components/dashboard'
import {
  useDeleteFleetAllocation,
  useFleetAllocations,
  useUpsertFleetAllocation,
  type useFleetServers,
} from '@/domains/fleet/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { ConfirmDialog } from '../../_components/confirm-dialog'
import { ALLOCATION_MODE_LABEL, formatMemory } from './capacity-format'

type FleetServer = NonNullable<ReturnType<typeof useFleetServers>['data']>['items'][number]
type AllocationMode = 'dedicated_full' | 'dedicated_slice' | 'shared_slice'

function errorText(error: unknown, fallback: string): string {
  return isDefinedORPCError(error) ? getErrorMessage(error) : fallback
}

function AssignAllocationForm({ servers }: { servers: readonly FleetServer[] }) {
  const upsert = useUpsertFleetAllocation()
  const [nodeId, setNodeId] = useState('')
  const [mode, setMode] = useState<AllocationMode>('shared_slice')
  const [cpu, setCpu] = useState(1000)
  const [memory, setMemory] = useState(1024)
  const [maxServices, setMaxServices] = useState<number | null>(null)
  const selectedNodeId = nodeId === '' ? (servers.at(0)?.nodeId ?? '') : nodeId

  const save = async () => {
    if (!selectedNodeId) {
      toast.error('Select a node first')
      return
    }
    try {
      await upsert.mutateAsync({
        serverNodeId: selectedNodeId,
        allocationMode: mode,
        cpuMillicores: Math.max(0, cpu),
        memoryMb: Math.max(0, memory),
        maxServices,
        isEnabled: true,
      })
      toast.success('Allocation saved')
    } catch (error) {
      toast.error(`Failed to save allocation: ${errorText(error, 'Unknown allocation error')}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assign capacity</CardTitle>
        <CardDescription>Reserve CPU and memory on a node. Saving again for the same node replaces its allocation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="alloc-server" className="text-xs text-muted-foreground">Node</Label>
          <select
            id="alloc-server"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={selectedNodeId}
            onChange={(event) => { setNodeId(event.target.value) }}
          >
            {servers.map((server) => (
              <option key={server.nodeId} value={server.nodeId}>
                {server.displayName ?? server.nodeId.slice(0, 8)}
                {' · '}
                {server.maxCpuMillicores != null
                  ? `${String(server.allocationSummary.cpuMillicores)} / ${String(server.maxCpuMillicores)}m CPU reserved`
                  : `${String(server.allocationSummary.cpuMillicores)}m CPU reserved, no limit set`}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="alloc-mode" className="text-xs text-muted-foreground">Allocation mode</Label>
          <select
            id="alloc-mode"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={mode}
            onChange={(event) => { setMode(event.target.value as AllocationMode) }}
          >
            <option value="shared_slice">Shared slice — share the node with others</option>
            <option value="dedicated_slice">Dedicated slice — reserved capacity</option>
            <option value="dedicated_full">Whole node — nothing else runs on it</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="alloc-cpu" className="text-xs text-muted-foreground">CPU millicores (1000 = 1 vCPU)</Label>
            <Input id="alloc-cpu" type="number" min={0} value={cpu} onChange={(e) => { setCpu(Number(e.target.value) || 0) }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="alloc-mem" className="text-xs text-muted-foreground">Memory (MB)</Label>
            <Input id="alloc-mem" type="number" min={0} value={memory} onChange={(e) => { setMemory(Number(e.target.value) || 0) }} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="alloc-max" className="text-xs text-muted-foreground">Max services (optional)</Label>
          <Input
            id="alloc-max"
            type="number"
            min={0}
            value={maxServices ?? ''}
            placeholder="Unlimited"
            onChange={(event) => {
              const value = event.target.value.trim()
              setMaxServices(value === '' ? null : Number(value) || 0)
            }}
          />
        </div>
        <Button type="button" disabled={upsert.isPending || servers.length === 0} onClick={() => { void save() }}>
          {upsert.isPending ? 'Saving…' : 'Save allocation'}
        </Button>
      </CardContent>
    </Card>
  )
}

function AllocationsTable({ servers }: { servers: readonly FleetServer[] }) {
  const { data, isLoading } = useFleetAllocations()
  const remove = useDeleteFleetAllocation()
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  const allocations = data?.items ?? []
  const nodeName = (nodeId: string) => {
    const server = servers.find((s) => s.nodeId === nodeId)
    return server?.displayName ?? server?.serverUrl ?? nodeId.slice(0, 8)
  }

  const confirmRemoval = async () => {
    if (!pendingRemoval) return
    try {
      await remove.mutateAsync({ serverNodeId: pendingRemoval })
      toast.success('Allocation removed')
      setPendingRemoval(null)
    } catch (error) {
      toast.error(`Failed to remove allocation: ${errorText(error, 'Unknown deletion error')}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Current allocations</CardTitle>
        <CardDescription>What each node has promised. Removing one releases its capacity back to the node.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading allocations…</p>
        ) : allocations.length === 0 ? (
          <EmptyState compact icon={Cpu} title="No allocations yet" description="Assign capacity to a node to let it host services." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Node</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>CPU</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead>Max services</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.map((allocation) => (
                <TableRow key={allocation.id}>
                  <TableCell className="text-sm font-medium">{nodeName(allocation.serverNodeId)}</TableCell>
                  <TableCell>{ALLOCATION_MODE_LABEL[allocation.allocationMode] ?? allocation.allocationMode}</TableCell>
                  <TableCell className="tabular-nums">{allocation.cpuMillicores}m</TableCell>
                  <TableCell className="tabular-nums">{formatMemory(allocation.memoryMb)}</TableCell>
                  <TableCell>{allocation.maxServices ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => { setPendingRemoval(allocation.serverNodeId) }}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => { if (!open) setPendingRemoval(null) }}
        title="Remove this allocation?"
        description={`${pendingRemoval ? nodeName(pendingRemoval) : 'The node'} will no longer have reserved capacity, so new services cannot be placed on it until you assign capacity again.`}
        confirmLabel="Remove allocation"
        pending={remove.isPending}
        onConfirm={() => { void confirmRemoval() }}
      />
    </Card>
  )
}

/** Assign form + current allocations, side by side on wide screens. */
export function AllocationsSection({ servers }: { servers: readonly FleetServer[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <AssignAllocationForm servers={servers} />
      <AllocationsTable servers={servers} />
    </div>
  )
}
