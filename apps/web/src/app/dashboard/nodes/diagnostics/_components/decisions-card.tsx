'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'

import { formatTime } from '@/lib/format/date'

import type { MeshLookupHistoryEntry } from './diagnostics-types'

/** What you ran on this page recently. Kept in memory only — a reload clears it. */
export function DecisionsCard({ lookups }: { lookups: readonly MeshLookupHistoryEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent lookups</CardTitle>
        <CardDescription>Outcomes of the replica lookups you ran in this session.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {lookups.length === 0 ? (
          <p className="text-xs text-muted-foreground">Lookups you run appear here.</p>
        ) : (
          lookups.map((entry, index) => (
            <div key={`${entry.service}-${entry.key ?? ''}-${entry.at}-${String(index)}`} className="rounded border p-2 text-xs">
              <p className="break-all font-mono">{entry.service}{entry.key ? `:${entry.key}` : ''}</p>
              <p className="text-muted-foreground">
                {formatTime(entry.at)} · {entry.found ? 'found' : 'no replica'}
                {entry.node ? ` · node ${entry.node.slice(0, 13)}` : ''}
                {entry.reason ? ` · ${entry.reason}` : ''}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
