'use client'

import { CheckCircle2, DoorOpen, XCircle } from 'lucide-react'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import type { IngressState } from '@deployer/fleet-contracts/modules/reachability/index'
import { Mono } from './network-copy'

/**
 * How a node that is NOT a member yet reaches one — the question that comes
 * before every other: a fresh machine has no mesh address, so it can only dial a
 * name or an address. Each path says what it needs, and how many members back it.
 */
export function JoinPathsCard({ entryPoints }: { entryPoints: IngressState['entryPoints'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DoorOpen className="size-4" />
          How a new node reaches this cluster
        </CardTitle>
        <CardDescription>
          {entryPoints.joinable
            ? 'A fresh machine can join through at least one path below. Run the setup wizard on it and choose “Join an existing cluster”.'
            : 'No path lets a machine that is not a member reach this cluster yet. Open one below first.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {entryPoints.points.map((point) => (
          <div key={point.kind} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              {point.available ? <CheckCircle2 className="size-4 text-emerald-500" /> : <XCircle className="size-4 text-muted-foreground" />}
              <span className="font-medium">{point.via}</span>
              {entryPoints.preferred === point.kind ? <Badge>recommended</Badge> : null}
              {point.available ? (
                <Badge variant="outline">
                  {point.sources} member{point.sources === 1 ? '' : 's'} behind it
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{point.detail}</p>
            {point.available && point.target !== null ? (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>
                  Dial <Mono>{point.target}</Mono>
                </span>
                {point.hostHeader !== null ? (
                  <span>
                    with <Mono>{`Host: ${point.hostHeader}`}</Mono>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
