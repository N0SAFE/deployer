'use client'

import { useMemo } from 'react'
import { AuthDashboardNodesNodeId, AuthDashboardNodes } from '@/routes'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { ArrowRight, Globe, KeyRound, Network, Server, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { PageHeader, PageLoadingState, StatusBadge, ScopeLabel } from '@/components/dashboard'
import { useFleetServers, useFleetAllocations } from '@/domains/fleet/hooks'
import { useMeshLocalNode, useMeshNodeConfig, useMeshTrustKeyringStatus } from '@/domains/mesh/hooks'
import { isRecord } from '@repo/type-guards'

interface FleetServerRow {
  nodeId: string
  displayName?: string | null
  status?: string
  healthy?: boolean
  maxCpuMillicores?: number | null
  maxMemoryMb?: number | null
}

/**
 * Configuration — mesh-wide settings + per-node configuration.
 *
 * Two scopes, one page:
 *  - **Mesh**: settings that apply across the whole mesh (mesh bootstrap
 *    URLs, routing defaults, trust keyring status).
 *  - **Per node**: each node carries its own configuration (region, zone,
 *    roles, routing, database URL) and its own capacity allocation. Change
 *    them from the node's workspace.
 */
export default function DashboardConfigurationPage() {
  const { data: serversData, isLoading } = useFleetServers()
  const { data: allocationsData } = useFleetAllocations()
  const { data: localNode } = useMeshLocalNode()
  const isLocalConfigured = Boolean(localNode?.nodeId)
  const { data: localConfig } = useMeshNodeConfig({ enabled: isLocalConfigured })
  const { data: keyringData } = useMeshTrustKeyringStatus()

  const servers = useMemo<FleetServerRow[]>(() => {
    const raw = serversData as { items?: Array<Record<string, unknown>> } | undefined
    return (raw?.items ?? []).map((item) => ({
      nodeId: String(item.nodeId ?? ''),
      displayName: item.displayName as string | null | undefined,
      status: item.status as string | undefined,
      healthy: item.healthy as boolean | undefined,
      maxCpuMillicores: item.maxCpuMillicores as number | null | undefined,
      maxMemoryMb: item.maxMemoryMb as number | null | undefined,
    }))
  }, [serversData])

  const allocations = useMemo(() => {
    const raw = allocationsData as { items?: Array<Record<string, unknown>> } | undefined
    return raw?.items ?? []
  }, [allocationsData])

  const keyringReady =
    isRecord(keyringData) && (keyringData as Record<string, unknown>).ready === true

  if (isLoading) {
    return <PageLoadingState label="Loading configuration…" />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Mesh & node configuration"
        description="Mesh-wide settings apply everywhere; every node also carries its own configuration and capacity. Both scopes are managed here."
        badge={
          <>
            <ScopeLabel scope="mesh" />
            <Badge variant="secondary">{servers.length} nodes</Badge>
          </>
        }
      />

      {/* ─── Mesh-wide section ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Globe className="size-4" /> Mesh-wide
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Network className="size-4 text-muted-foreground" /> Mesh bootstrap
              </CardTitle>
              <CardDescription>
                URLs used by nodes to rejoin the mesh after restart. Stored in each node&apos;s
                local configuration and refreshed from here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="shrink-0 text-muted-foreground">Bootstrap strategy</span>
                <span className="font-medium">{localConfig?.strategy ?? '—'}</span>
              </div>
              <div className="space-y-1.5">
                <span className="block text-muted-foreground">Mesh URLs snapshot</span>
                {localConfig?.meshUrlsSnapshot?.length ? (
                  <ul className="space-y-1">
                    {localConfig.meshUrlsSnapshot.map((url) => (
                      <li key={url} className="truncate font-mono text-xs text-muted-foreground">
                        {url}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No mesh URLs recorded yet.</p>
                )}
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="shrink-0 text-muted-foreground">Routing mode (default)</span>
                <span className="font-medium">{localConfig?.routingMode ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="shrink-0 text-muted-foreground">Consistency mode (default)</span>
                <span className="font-medium">{localConfig?.consistencyMode ?? '—'}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="size-4 text-muted-foreground" /> Trust & keyring
              </CardTitle>
              <CardDescription>
                The mesh keyring secures node-to-node communication. Status is mesh-wide.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Keyring ready</span>
              {keyringReady ? (
                <StatusBadge status="healthy" />
              ) : (
                <StatusBadge status="pending" />
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ─── Per-node section ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <Server className="size-4" /> Per node
        </h2>

        <Card className="border-dashed">
          <CardContent className="grid gap-4 py-5 text-sm text-muted-foreground md:grid-cols-3">
            <p className="flex items-start gap-2">
              <SlidersHorizontal className="mt-0.5 size-4 shrink-0" />
              Node configuration (region, zone, roles, routing, database URL) is stored on each
              node. Edit it from the node&apos;s workspace.
            </p>
            <p className="flex items-start gap-2">
              <KeyRound className="mt-0.5 size-4 shrink-0" />
              Capacity and allocations are granted per node by the fleet. They decide how many
              services a node may host.
            </p>
            <p className="flex items-start gap-2">
              <ArrowRight className="mt-0.5 size-4 shrink-0" />
              Open a node to see its deployments, its configuration, and to manage its allocation.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {servers.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No nodes registered yet. Nodes appear once they join the mesh.
              </CardContent>
            </Card>
          ) : (
            servers.map((row) => {
              const nodeAllocation = allocations.find(
                (a) => String(a.serverNodeId) === row.nodeId,
              )
              return (
                <Card key={row.nodeId}>
                  <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="text-base">
                        {row.displayName ?? row.nodeId.slice(0, 8)}
                      </CardTitle>
                      <CardDescription className="truncate font-mono text-xs">
                        {row.nodeId}
                      </CardDescription>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={row.status ?? 'unknown'} />
                      {row.nodeId === localNode?.nodeId ? (
                        <Badge variant="secondary">local</Badge>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Allocation mode</span>
                      <span className="font-medium">
                        {nodeAllocation ? String(nodeAllocation.allocationMode) : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Capacity</span>
                      <span className="font-medium">
                        {row.maxCpuMillicores != null
                          ? `${(row.maxCpuMillicores / 1000).toFixed(1)} vCPU`
                          : '∞'}{' '}
                        /{' '}
                        {row.maxMemoryMb != null
                          ? `${row.maxMemoryMb >= 1024 ? `${(row.maxMemoryMb / 1024).toFixed(1)} GB` : `${row.maxMemoryMb} MB`}`
                          : '∞'}
                      </span>
                    </div>
                    <div className="pt-2">
                      <AuthDashboardNodesNodeId.Link
                        nodeId={row.nodeId}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        Open node workspace <ArrowRight className="size-3.5" />
                      </AuthDashboardNodesNodeId.Link>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>

        <div className="pt-1">
          <Button variant="outline" size="sm" asChild>
            <AuthDashboardNodes.Link>
              <Server className="size-4" /> View fleet overview
            </AuthDashboardNodes.Link>
          </Button>
        </div>
      </section>
    </div>
  )
}