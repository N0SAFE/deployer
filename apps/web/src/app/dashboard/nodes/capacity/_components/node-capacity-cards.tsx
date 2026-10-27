'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Server } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Progress } from '@deployer/ui/components/shadcn/progress'
import { EmptyState } from '@/components/dashboard'
import { PresenceBadge } from '../../_components/presence-badge'
import type { NodePresence } from '../../_utils/node-presence'
import { useSetFleetServerCapacity, type useFleetServers } from '@/domains/fleet/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { useRouter } from 'next/navigation'
import { AuthDashboardNetworkMesh, AuthDashboardNodesNodeId } from '@/routes'
import { ALLOCATION_MODE_LABEL, formatCpu, formatMemory, utilisationIndicatorClass, utilisationPct } from './capacity-format'

type FleetServer = NonNullable<ReturnType<typeof useFleetServers>['data']>['items'][number]
interface FleetAllocation {
  serverNodeId: string
  allocationMode: string
}

function UsageMeter({ label, used, max, unit, pct }: { label: string; used: number; max: number | null; unit: string; pct: number | null }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{pct != null ? `${String(pct)}% used` : 'no limit'}</span>
      </div>
      <Progress value={pct ?? 0} aria-label={`${label} utilisation`} className={`h-1.5 ${utilisationIndicatorClass(pct)}`} />
      <p className="text-xs text-muted-foreground">
        {String(used)}
        {unit} reserved of {max != null ? `${String(max)}${unit}` : '∞'}
      </p>
    </div>
  )
}

function CapacityLimitsEditor({ server, onDone }: { server: FleetServer; onDone: () => void }) {
  const setCapacity = useSetFleetServerCapacity()
  const [maxCpu, setMaxCpu] = useState(server.maxCpuMillicores != null ? String(server.maxCpuMillicores) : '')
  const [maxMem, setMaxMem] = useState(server.maxMemoryMb != null ? String(server.maxMemoryMb) : '')
  const cpuId = `cap-cpu-${server.nodeId}`
  const memId = `cap-mem-${server.nodeId}`

  const save = () => {
    setCapacity.mutate(
      {
        serverNodeId: server.nodeId,
        maxCpuMillicores: maxCpu.trim() === '' ? null : Number(maxCpu),
        maxMemoryMb: maxMem.trim() === '' ? null : Number(maxMem),
      },
      {
        onSuccess: () => {
          toast.success('Capacity limits updated')
          onDone()
        },
        onError: (err) => {
          toast.error(isDefinedORPCError(err) ? getErrorMessage(err, 'Failed to update capacity') : 'Failed to update capacity')
        },
      },
    )
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={cpuId} className="text-xs text-muted-foreground">Max CPU (millicores)</Label>
          <Input id={cpuId} className="h-8 text-xs" type="number" min={1} value={maxCpu} placeholder="1000 = 1 vCPU" onChange={(e) => { setMaxCpu(e.target.value) }} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={memId} className="text-xs text-muted-foreground">Max memory (MB)</Label>
          <Input id={memId} className="h-8 text-xs" type="number" min={1} value={maxMem} placeholder="e.g. 4096" onChange={(e) => { setMaxMem(e.target.value) }} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Leave a field empty to remove that limit.</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={setCapacity.isPending} onClick={save}>
          {setCapacity.isPending ? 'Saving…' : 'Save limits'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  )
}

function NodeCapacityCard({ server, allocation, presence }: { server: FleetServer; allocation: FleetAllocation | undefined; presence: NodePresence }) {
  const [editing, setEditing] = useState(false)
  const usedCpu = server.allocationSummary.cpuMillicores
  const usedMem = server.allocationSummary.memoryMb

  return (
    <Card className={presence === 'offline' ? 'opacity-70' : undefined}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="truncate text-base">
            <AuthDashboardNodesNodeId.Link nodeId={server.nodeId} className="hover:underline">
              {server.displayName ?? server.nodeId.slice(0, 8)}
            </AuthDashboardNodesNodeId.Link>
          </CardTitle>
          <CardDescription className="truncate font-mono text-xs" title={server.serverUrl}>
            {server.serverUrl || server.nodeId}
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <PresenceBadge presence={presence} />
          {server.status === 'active' ? null : <Badge variant="outline">{server.status}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <UsageMeter label="CPU" used={usedCpu} max={server.maxCpuMillicores} unit="m" pct={utilisationPct(usedCpu, server.maxCpuMillicores)} />
          <UsageMeter label="Memory" used={usedMem} max={server.maxMemoryMb} unit=" MB" pct={utilisationPct(usedMem, server.maxMemoryMb)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Limits: {formatCpu(server.maxCpuMillicores)} · {formatMemory(server.maxMemoryMb)}
          </span>
          <span>
            Allocation: {allocation ? (ALLOCATION_MODE_LABEL[allocation.allocationMode] ?? allocation.allocationMode) : 'none yet'}
            {server.allocationSummary.services > 0 ? ` · ${String(server.allocationSummary.services)} in use` : ''}
          </span>
        </div>
        {editing ? (
          <CapacityLimitsEditor server={server} onDone={() => { setEditing(false) }} />
        ) : (
          <div className="flex items-center justify-between">
            <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(true) }}>
              Edit limits
            </Button>
            <AuthDashboardNodesNodeId.Link nodeId={server.nodeId} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Open node <ArrowRight className="size-3.5" />
            </AuthDashboardNodesNodeId.Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** One card per node: its ceiling, how much of it is reserved, and a way to change the ceiling. */
export function NodeCapacityCards({
  servers,
  allocations,
  presenceOf,
}: {
  servers: readonly FleetServer[]
  allocations: readonly FleetAllocation[]
  presenceOf: (nodeId: string, lastSeenAt: string | null, status: string) => NodePresence
}) {
  const router = useRouter()
  if (servers.length === 0) {
    return (
      <EmptyState
        icon={Server}
        title="No nodes registered yet"
        description="Nodes appear here as soon as they join the mesh."
        action={{ label: 'Add a node', onClick: () => { router.push(AuthDashboardNetworkMesh()) } }}
      />
    )
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {servers.map((server) => (
        <NodeCapacityCard
          key={server.nodeId}
          server={server}
          allocation={allocations.find((a) => a.serverNodeId === server.nodeId)}
          presence={presenceOf(server.nodeId, server.lastSeenAt, server.status)}
        />
      ))}
    </div>
  )
}
