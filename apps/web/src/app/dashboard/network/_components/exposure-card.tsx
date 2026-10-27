'use client'

import { CheckCircle2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import type { IngressState } from '@deployer/fleet-contracts/modules/reachability/index'

/**
 * Plain answers about exposure, computed by the API from the lanes and the edge
 * provider's descriptor — the page never re-derives them, so it cannot disagree
 * with what the supervisors actually do.
 */
export function ExposureCard({ exposure }: { exposure: IngressState['exposure'] }) {
  const rows: { label: string; value: boolean; risky: boolean }[] = [
    { label: 'Reachable from another machine', value: exposure.reachableOffMachine, risky: false },
    { label: 'Reachable from the internet', value: exposure.reachableFromInternet, risky: false },
    { label: 'A node opens an inbound port', value: exposure.opensInboundPorts, risky: true },
    { label: 'A node binds its LAN address (same-network join)', value: exposure.reachableOnLan, risky: true },
    { label: 'A third-party account is involved', value: exposure.usesProviderAccount, risky: false },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" />
          Exposure
        </CardTitle>
        <CardDescription>What the current lanes add up to.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-4">
              <span>{row.label}</span>
              {row.value ? (
                <span className={row.risky ? 'flex items-center gap-1 text-amber-600' : 'flex items-center gap-1'}>
                  {row.risky ? <TriangleAlert className="size-4" /> : <CheckCircle2 className="size-4" />}
                  yes
                </span>
              ) : (
                <span className="text-muted-foreground">no</span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
