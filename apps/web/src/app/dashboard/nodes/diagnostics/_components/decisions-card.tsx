'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { formatTime } from '@/lib/format/date'
import type { MeshLookupHistoryEntry, MeshRoutePlanHistoryEntry } from './diagnostics-types'

/** What you ran on this page recently. Kept in memory only — a reload clears it. */
export function DecisionsCard({
  routePlans,
  lookups,
}: {
  routePlans: readonly MeshRoutePlanHistoryEntry[]
  lookups: readonly MeshLookupHistoryEntry[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent mesh decisions</CardTitle>
        <CardDescription>Outcomes of the route plans and ownership lookups you ran in this session.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Route plans</p>
          {routePlans.length === 0 ? (
            <p className="text-xs text-muted-foreground">No route plan runs yet.</p>
          ) : (
            routePlans.map((entry, index) => (
              <div key={`${entry.streamId}-${entry.at}-${String(index)}`} className="rounded border p-2 text-xs">
                <p className="break-all font-mono">{entry.streamId}</p>
                <p className="text-muted-foreground">
                  {formatTime(entry.at)} · selected {entry.selected}/{entry.candidates}
                  {entry.topOwner ? ` · owner ${entry.topOwner.slice(0, 8)}` : ''}
                </p>
              </div>
            ))
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ownership lookups</p>
          {lookups.length === 0 ? (
            <p className="text-xs text-muted-foreground">No ownership lookups yet.</p>
          ) : (
            lookups.map((entry, index) => (
              <div key={`${entry.kind}-${entry.key}-${entry.at}-${String(index)}`} className="rounded border p-2 text-xs">
                <p className="break-all font-mono">{entry.kind}:{entry.key}</p>
                <p className="text-muted-foreground">
                  {formatTime(entry.at)} · {entry.found ? 'found' : 'missing'}
                  {entry.owner ? ` · owner ${entry.owner.slice(0, 8)}` : ''}
                  {` · candidates ${String(entry.candidates)}`}
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
