'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { useLookupMeshResource } from '@/domains/mesh/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import type { MeshLookupHistoryEntry, MeshLookupKind } from './diagnostics-types'

export function OwnershipLookupCard({ onLookedUp }: { onLookedUp: (entry: MeshLookupHistoryEntry) => void }) {
  const lookupResource = useLookupMeshResource()
  const [kind, setKind] = useState<MeshLookupKind>('stream')
  const [key, setKey] = useState('')

  const lookup = async () => {
    const trimmed = key.trim()
    if (!trimmed) {
      toast.error('A resource key is required for mesh ownership lookup')
      return
    }
    try {
      const result = await lookupResource.mutateAsync({ kind, key: trimmed, includeCandidates: true })
      onLookedUp({
        at: new Date().toISOString(),
        kind,
        key: trimmed,
        found: result.found,
        owner: result.primary?.ownerNodeId ?? null,
        candidates: result.candidates.length,
      })
      if (result.found) toast.success('Mesh ownership lookup resolved a primary location')
      else toast.warning('No mesh ownership location found for this resource key')
    } catch (error) {
      toast.error(`Unable to lookup resource ownership: ${isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown ownership lookup error'}`)
    }
  }

  const result = lookupResource.data

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Resource ownership lookup</CardTitle>
        <CardDescription>Find which peer owns a stream, queue, deployment or log before opening a direct connection to it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="lookup-kind" className="text-xs text-muted-foreground">Resource kind</Label>
          <select
            id="lookup-kind"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={kind}
            onChange={(event) => { setKind(event.target.value as MeshLookupKind) }}
          >
            <option value="stream">Stream</option>
            <option value="queue">Queue</option>
            <option value="deployment">Deployment</option>
            <option value="log">Log</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="lookup-key" className="text-xs text-muted-foreground">{kind} key</Label>
          <Input id="lookup-key" className="font-mono text-xs" placeholder="e.g. 7f3c1a92-…" value={key} onChange={(e) => { setKey(e.target.value) }} />
        </div>
        <Button type="button" variant="outline" disabled={lookupResource.isPending} onClick={() => { void lookup() }}>
          {lookupResource.isPending ? 'Resolving…' : 'Resolve ownership'}
        </Button>

        {result ? (
          <div className="space-y-2 rounded border p-2 text-xs">
            <p className="text-muted-foreground">
              {result.found ? `Primary owner: ${result.primary?.ownerNodeId.slice(0, 8) ?? 'n/a'}` : 'No owner found'}
            </p>
            {result.primary ? (
              <p className="break-all font-mono">{result.primary.ownerServerUrl}{result.primary.endpointPath}</p>
            ) : null}
            {result.candidates.length > 0 ? <p className="text-muted-foreground">Candidates: {result.candidates.length}</p> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
