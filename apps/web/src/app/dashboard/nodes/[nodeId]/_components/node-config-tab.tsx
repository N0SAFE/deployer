'use client'

import { Network, TerminalSquare } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { EmptyState } from '@/components/dashboard'

export interface LocalNodeConfigView {
  strategy: string
  region?: string | null
  zone?: string | null
  roles?: readonly string[] | null
  routingMode?: string | null
  consistencyMode?: string | null
}

function Row({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-muted-foreground" title={hint}>{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

export function NodeConfigTab({ isLocal, config }: { isLocal: boolean; config: LocalNodeConfigView | null | undefined }) {
  return (
    <div className="space-y-5">
      {isLocal && config ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="size-4 text-muted-foreground" /> Local node configuration
            </CardTitle>
            <CardDescription>
              Stored on this node. Every node keeps its own copy — change it from the dashboard of the node that hosts it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Strategy" value={config.strategy} />
            <Row label="Region" value={config.region ?? '—'} />
            <Row label="Zone" value={config.zone ?? '—'} />
            <Row label="Roles" value={config.roles?.length ? config.roles.join(', ') : '—'} />
            <Row label="Routing mode" hint="How the mesh picks a path between nodes." value={config.routingMode ?? '—'} />
            <Row label="Consistency mode" hint="What this node does when the mesh is partitioned." value={config.consistencyMode ?? '—'} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={Network}
          title={isLocal ? 'Configuration not loaded' : 'Configuration lives on the node itself'}
          description={
            isLocal
              ? 'The node configuration could not be read. Reload the page to retry.'
              : 'A remote node keeps its own configuration. Open that node’s dashboard to read or change it.'
          }
        />
      )}

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalSquare className="size-4 text-muted-foreground" /> Working with a node
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Deployments run on the node that owns the service allocation; the Deployments tab filters by this node.</p>
          <p>The Docker section always operates the node serving this dashboard. To manage another node’s containers, open that node’s dashboard.</p>
          <p>Allocations and capacity are set under Nodes → Capacity &amp; admissions.</p>
        </CardContent>
      </Card>
    </div>
  )
}
