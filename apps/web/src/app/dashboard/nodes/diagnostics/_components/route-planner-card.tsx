'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { usePlanMeshStreamRoute } from '@/domains/mesh/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import type { MeshRoutePlanHistoryEntry } from './diagnostics-types'

export function RoutePlannerCard({ onPlanned }: { onPlanned: (entry: MeshRoutePlanHistoryEntry) => void }) {
  const planStreamRoute = usePlanMeshStreamRoute()
  const [streamId, setStreamId] = useState('')
  const [branches, setBranches] = useState(2)

  const plan = async () => {
    const trimmed = streamId.trim()
    if (!trimmed) {
      toast.error('A stream id is required to plan mesh route branches')
      return
    }
    try {
      const result = await planStreamRoute.mutateAsync({
        streamId: trimmed,
        desiredBranches: Math.min(6, Math.max(1, branches)),
        includeCandidates: true,
      })
      onPlanned({
        at: new Date().toISOString(),
        streamId: trimmed,
        selected: result.selected.length,
        candidates: result.candidates.length,
        topOwner: result.selected[0]?.ownerNodeId ?? null,
      })
      toast.success('Computed stream route plan from mesh resource index')
    } catch (error) {
      toast.error(`Unable to plan stream route: ${isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown route planning error'}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Stream route planner</CardTitle>
        <CardDescription>Dry run: shows which peer branches would carry a stream&apos;s subscriptions given current weights and ownership. Nothing is changed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="route-stream" className="text-xs text-muted-foreground">Stream id</Label>
          <Input id="route-stream" className="font-mono text-xs" placeholder="stream uuid" value={streamId} onChange={(e) => { setStreamId(e.target.value) }} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="route-branches" className="text-xs text-muted-foreground">Branches wanted (1–6)</Label>
          <Input id="route-branches" type="number" min={1} max={6} value={branches} onChange={(e) => { setBranches(Number(e.target.value) || 1) }} />
        </div>
        <Button type="button" variant="outline" disabled={planStreamRoute.isPending} onClick={() => { void plan() }}>
          {planStreamRoute.isPending ? 'Planning…' : 'Plan subscription branches'}
        </Button>

        {planStreamRoute.data ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Selected {planStreamRoute.data.selected.length} branch(es) out of {planStreamRoute.data.candidates.length} candidates
            </p>
            {planStreamRoute.data.selected.map((branch) => (
              <div key={`${branch.ownerNodeId}:${branch.endpointPath}`} className="break-all rounded border p-2 font-mono text-xs">
                {branch.ownerNodeId.slice(0, 8)} · {branch.protocol} · w={branch.estimatedWeight.toFixed(4)} · {branch.ownerServerUrl}{branch.endpointPath}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
