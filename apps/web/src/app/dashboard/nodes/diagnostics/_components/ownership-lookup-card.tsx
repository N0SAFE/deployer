'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { useLookupMeshResource } from '@/domains/mesh/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import type { MeshLookupHistoryEntry } from './diagnostics-types'

export function OwnershipLookupCard({ onLookedUp }: { onLookedUp: (entry: MeshLookupHistoryEntry) => void }) {
  const lookupResource = useLookupMeshResource()
  const [service, setService] = useState('runtime')
  const [key, setKey] = useState('')

  const lookup = async () => {
    const trimmedService = service.trim()
    const trimmedKey = key.trim()
    if (!trimmedService) {
      toast.error('A service name is required for a replica lookup')
      return
    }
    try {
      const result = await lookupResource.mutateAsync({ service: trimmedService, key: trimmedKey || undefined })
      onLookedUp({
        at: new Date().toISOString(),
        service: trimmedService,
        key: trimmedKey || null,
        found: result.found,
        node: result.replica?.nodeId ?? null,
        reason: result.reason,
      })
      if (result.found) toast.success('A replica would answer this call')
      else toast.warning('No live replica of this service is known')
    } catch (error) {
      toast.error(`Unable to look up the replica: ${isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown lookup error'}`)
    }
  }

  const result = lookupResource.data

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Replica lookup</CardTitle>
        <CardDescription>Which replica a call to a service would reach: the one holding the key, one on this node, or the least loaded.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="lookup-service" className="text-xs text-muted-foreground">Service</Label>
          <Input id="lookup-service" className="font-mono text-xs" placeholder="e.g. runtime" value={service} onChange={(e) => { setService(e.target.value) }} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lookup-key" className="text-xs text-muted-foreground">Resource key (optional)</Label>
          <Input id="lookup-key" className="font-mono text-xs" placeholder="e.g. a container id" value={key} onChange={(e) => { setKey(e.target.value) }} />
        </div>
        <Button type="button" variant="outline" disabled={lookupResource.isPending} onClick={() => { void lookup() }}>
          {lookupResource.isPending ? 'Resolving…' : 'Resolve replica'}
        </Button>

        {result ? (
          <div className="space-y-2 rounded border p-2 text-xs">
            <p className="text-muted-foreground">
              {result.replica ? `Replica ${result.replica.replicaId} on ${result.replica.nodeId.slice(0, 13)}` : 'No live replica'}
              {result.reason ? ` · ${result.reason}` : ''}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
