'use client'

import { isDefinedORPCError, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Siren, Globe, Network, Save, Server, ShieldCheck, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  useNodeNetworkConfig,
  useListNodeNetworkConfigs,
  useUpdateNodeNetworkConfig,
  useCheckDomainGate,
  usePublicAccessPointLive,
} from '@/domains/reachability/hooks'
import { useDNSProviders, useCloudflareZones } from '@/domains/dns-providers/hooks'
import { useFleetServers } from '@/domains/fleet/hooks'
import { useMeshSseState } from '@/domains/mesh/hooks'
import { z } from 'zod/v4'

const addressSchema = z.object({ publicAddress: z.string().optional() })

interface TunnelHealth {
  status: 'healthy' | 'degraded' | 'down' | 'inactive' | 'unknown' | null
  checkedAt: string | null
  connections: number
  tunnelId: string | null
  error: string | null
}

interface NodeNetworkView {
  nodeId: string
  publicAddress: string | null
  addressKind: 'ip' | 'hostname' | null
  tunnel: {
    enabled: boolean
    providerId: string | null
    tunnelId: string | null
    hostname: string | null
    health: TunnelHealth | null
  }
  updatedAt: string
}

export function NodeNetworkConfig() {
  const { data: allConfigsData } = useListNodeNetworkConfigs()
  const { data: fleetData } = useFleetServers()
  const { state: meshState } = useMeshSseState()
  const { data: gate } = useCheckDomainGate()
  const { data: providersData } = useDNSProviders()

  const currentNodeId = meshState?.localNode?.nodeId ?? ''
  const allConfigs = (allConfigsData?.configs ?? []) as NodeNetworkView[]

  // Node options: every cluster node (from the fleet) ∪ configured nodes.
  const nodeOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of (fleetData?.items ?? []) as Array<{ nodeId: string; displayName: string | null }>) {
      if (s.nodeId) map.set(s.nodeId, s.displayName ?? s.nodeId)
    }
    for (const c of allConfigs) {
      if (!map.has(c.nodeId)) map.set(c.nodeId, c.nodeId)
    }
    return [...map.entries()].map(([nodeId, label]) => ({ nodeId, label }))
  }, [fleetData, allConfigs])

  const [selectedNodeId, setSelectedNodeId] = useState<string>(currentNodeId)
  useEffect(() => {
    if (currentNodeId) setSelectedNodeId(currentNodeId)
  }, [currentNodeId])

  const { data: nodeConfigData } = useNodeNetworkConfig(selectedNodeId || undefined)
  const config = nodeConfigData as NodeNetworkView | undefined
  const updateConfig = useUpdateNodeNetworkConfig()

  const tunnelCapableApps = ((providersData?.providers ?? []) as Array<{
    id: string
    name: string
    isActive: boolean
    features: { tunnelManagement: boolean }
    state: { status: string } | null
  }>).filter((p) => p.isActive && p.features.tunnelManagement && p.state?.status === 'ok')

  const tunnelAvailable = tunnelCapableApps.length > 0
  const tunnel = config?.tunnel

  // The "Reach this node via" Select is optimistic: `mode` normally follows
  // the server config, but the user's pick must apply instantly — deriving it
  // purely from the config made the Select snap back on click (the mutation
  // round-trip hadn't landed yet), so selecting "Cloudflare Tunnel" looked
  // dead. The override is cleared on node switch so the UI re-syncs.
  const derivedMode: 'address' | 'tunnel' = config?.tunnel.enabled ? 'tunnel' : 'address'
  const [modeOverride, setModeOverride] = useState<'address' | 'tunnel' | null>(null)
  useEffect(() => {
    setModeOverride(null)
  }, [selectedNodeId])
  const mode: 'address' | 'tunnel' = modeOverride ?? derivedMode

  const [addressInput, setAddressInput] = useState('')
  const [providerId, setProviderId] = useState('')
  // Tunnel hostname is built from a USER-SELECTED zone + optional subdomain:
  //   hostname = subdomain ? `${subdomain}.${zone}` : zone
  // The user picks the zone (one of this Cloudflare app's zones) and the
  // subdomain on it; the server creates the CNAME there (validated by
  // findZoneForHostname).
  const [tunnelZoneId, setTunnelZoneId] = useState('')
  const [tunnelSubdomain, setTunnelSubdomain] = useState('')

  useEffect(() => {
    setAddressInput(config?.publicAddress ?? '')
    setProviderId(tunnel?.providerId ?? tunnelCapableApps[0]?.id ?? '')
    setTunnelZoneId('')
    setTunnelSubdomain('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, config?.publicAddress, tunnel?.enabled, tunnel?.providerId])

  // Zones the selected Cloudflare app can manage — the "allowed domain" pool
  // the user picks from when provisioning the tunnel. Only ACTIVE zones can
  // accept new DNS records; a pending zone would fail the CNAME creation.
  const { data: zonesData, isLoading: zonesLoading } = useCloudflareZones(providerId || undefined)
  const zones = ((zonesData?.zones ?? []) as Array<{ id: string; name: string; status: string }>)
    .filter((z) => z.status === 'active')
  const zonesError = (zonesData as { error?: string | null } | undefined)?.error ?? null
  const selectedTunnelZone = zones.find((z) => z.id === tunnelZoneId)
  const derivedTunnelHostname = selectedTunnelZone
    ? tunnelSubdomain.trim()
      ? `${tunnelSubdomain.trim()}.${selectedTunnelZone.name}`
      : selectedTunnelZone.name
    : ''

  // LIVE public access point (SSE) — always the latest for the current node.
  const accessPoint = usePublicAccessPointLive()
  const live = accessPoint.state

  const saveAddress = async () => {
    const parsed = addressSchema.safeParse({ publicAddress: addressInput })
    if (!parsed.success) return
    const value = parsed.data.publicAddress?.trim() || null
    try {
      if (value) toast.info('Verifying reachability…', { description: `Probing ${value} on this node's health and mesh endpoints.` })
      await updateConfig.mutateAsync({ nodeId: selectedNodeId, publicAddress: value })
      toast.success(value ? 'Address verified and saved' : 'Address cleared')
    } catch (err) {
      toast.error(value ? 'Address not accepted' : 'Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : 'Unknown error' })
    }
  }

  const enableTunnel = async () => {
    if (!providerId) {
      toast.error('Select a Cloudflare app with tunnel management enabled.')
      return
    }
    const hostname = derivedTunnelHostname || tunnel?.hostname || ''
    if (!hostname) {
      toast.error('Select a zone (and optionally a subdomain on it) for the tunnel hostname.')
      return
    }
    try {
      await updateConfig.mutateAsync({
        nodeId: selectedNodeId,
        tunnel: {
          enabled: true,
          providerId,
          // The CNAME is created on the zone+subdomain the user selected —
          // it must live under one of the app's zones (validated server-side).
          hostname: hostname || undefined,
        },
      })
      toast.success('Tunnel enabled — provisioned automatically')
    } catch (err) {
      toast.error('Failed to enable tunnel', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : 'Unknown error' })
    }
  }

  const disableTunnel = async (): Promise<boolean> => {
    try {
      await updateConfig.mutateAsync({ nodeId: selectedNodeId, tunnel: { enabled: false } })
      toast.success('Tunnel disabled')
      return true
    } catch (err) {
      toast.error('Failed to disable tunnel', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : 'Unknown error' })
      return false
    }
  }

  /**
   * "Reach this node via" pick handler.
   * - Tunnel: purely visual — provisioning stays explicit via the panel's
   *   "Enable tunnel" button, so nothing is sent to the server here.
   * - Address while a tunnel is active: tear the tunnel down. The override is
   *   set BEFORE the mutation so the Select doesn't snap back during the
   *   round-trip, and dropped on failure so the UI re-syncs to the server
   *   (tunnel still active).
   */
  const selectReachMode = (v: string) => {
    if (v === 'tunnel') {
      setModeOverride('tunnel')
      return
    }
    if (mode === 'tunnel') {
      setModeOverride('address')
      void disableTunnel().then((ok) => {
        if (!ok) setModeOverride(null)
      })
    }
  }

  const gateInfo = gate as {
    allowed: boolean
    reason: string | null
    publicAddress: string | null
    addressKind: 'ip' | 'hostname' | null
    tunnel: { enabled: boolean; providerId: string | null; tunnelId: string | null; hostname: string | null; health: TunnelHealth | null }
  } | undefined

  const selectedLabel = nodeOptions.find((n) => n.nodeId === selectedNodeId)?.label ?? selectedNodeId

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <CardTitle>Node Network & Reachability</CardTitle>
        </div>
        <CardDescription>
          Per-node globally reachable address. Each node keeps its own config in the global DB —
          either a public IP/hostname, or a Cloudflare Tunnel provisioned through a Cloudflare app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Node selector */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Node</Label>
          <Select value={selectedNodeId} onValueChange={setSelectedNodeId}>
            <SelectTrigger className="w-full sm:max-w-sm"><SelectValue placeholder="Select a node" /></SelectTrigger>
            <SelectContent>
              {nodeOptions.length === 0 && <SelectItem value="__none__" disabled>No nodes found</SelectItem>}
              {nodeOptions.map((n) => (
                <SelectItem key={n.nodeId} value={n.nodeId}>
                  <span className="flex items-center gap-2">
                    <Server className="size-3.5" />
                    {n.label}
                    {n.nodeId === currentNodeId && <Badge variant="secondary" className="ml-1">this node</Badge>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* LIVE public access point status (SSE — always the latest) */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-center gap-3">
            <Network className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Public access point — {selectedLabel}</p>
              <p className="text-xs text-muted-foreground">
                {live
                  ? live.configured
                    ? `${live.kind === 'tunnel' ? 'Tunnel' : live.kind === 'ip' ? 'IP' : 'Hostname'}: ${live.publicUrl ?? live.address ?? '—'}`
                    : 'Not configured — set an address below or enable a tunnel'
                  : 'Waiting for status…'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {live?.reachable === true && (
              <Badge variant="default" className="gap-1.5">
                <Globe className="size-3" /> Reachable{live.latencyMs != null ? ` · ${live.latencyMs}ms` : ''}
              </Badge>
            )}
            {live?.reachable === false && (
              <Badge variant="destructive" className="gap-1.5">
                <Siren className="size-3" /> Unreachable
              </Badge>
            )}
            {live?.reachable === null && <Badge variant="secondary">Checking…</Badge>}
            {live?.error && <span className="max-w-56 truncate text-xs text-destructive" title={live.error}>{live.error}</span>}
          </div>
        </div>

        {/* Domain gate status */}
        {gateInfo && (
          <div>
            {gateInfo.allowed ? (
              <Badge variant="default" className="gap-1.5"><Globe className="h-3 w-3" /> Domain creation allowed</Badge>
            ) : (
              <Alert variant="destructive">
                <Siren className="size-4" />
                <AlertTitle>Domains blocked</AlertTitle>
                <AlertDescription>{gateInfo.reason ?? 'Configure a public address or enable an active tunnel.'}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Address OR Tunnel selector — tunnel only appears when a Cloudflare app enables it */}
        {tunnelAvailable && (
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Reach this node via</Label>
            <Select value={mode} onValueChange={selectReachMode}>
              <SelectTrigger className="w-full sm:max-w-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="address">Public IP / Hostname</SelectItem>
                <SelectItem value="tunnel">Cloudflare Tunnel</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Public address mode */}
        {mode === 'address' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-medium">Public IP or Hostname</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  The globally reachable address DNS records should point to for this node.
                  Enter an IP (e.g. <code className="font-mono">203.0.113.10</code>) or a hostname
                  (e.g. <code className="font-mono">node.example.com</code>). Hostnames are used to
                  create CNAME records; IPs create A/AAAA records.
                </p>
              </div>
              {config?.publicAddress && <Badge variant="secondary">{config.publicAddress}</Badge>}
            </div>
            <div className="flex gap-2">
              <Input
                className="font-mono flex-1"
                placeholder="203.0.113.10 or node.example.com"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
              />
              <Button size="sm" onClick={saveAddress} disabled={updateConfig.isPending}>
                <Save className="mr-1 size-4" /> {updateConfig.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Saved addresses are verified server-side against this node&apos;s{' '}
              <code className="font-mono">/health</code> and <code className="font-mono">/mesh/ping</code>{' '}
              endpoints before being accepted — DNS must be pointing at this node.
            </p>
          </div>
        )}

        {/* Tunnel mode */}
        {mode === 'tunnel' && (
          <div className="space-y-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Network className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <Label className="text-base font-medium">Cloudflare Tunnel</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    The tunnel is created automatically on the selected Cloudflare app when enabled.
                    Its health is checked live at runtime.
                  </p>
                </div>
              </div>
              <TunnelHealthBadge health={tunnel?.health ?? null} />
            </div>

            <div className="space-y-3 border-t border-border/60 pt-3">
              <div className="space-y-1.5">
                <Label>Cloudflare app</Label>
                <Select value={providerId} onValueChange={(v) => { setProviderId(v); setTunnelZoneId(''); setTunnelSubdomain('') }}>
                  <SelectTrigger><SelectValue placeholder="Select a Cloudflare app" /></SelectTrigger>
                  <SelectContent>
                    {tunnelCapableApps.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Zone + subdomain selection — the tunnel's public hostname is
                  assembled from the selected zone (one of the app's allowed
                  domains) and an optional subdomain on it. The server creates
                  the CNAME there via findZoneForHostname. */}
              {!tunnel?.enabled && (
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <Label>Zone (domain)</Label>
                    {zonesLoading ? (
                      <p className="text-xs text-muted-foreground">Loading available zones…</p>
                    ) : zonesError ? (
                      <p className="text-xs text-destructive leading-relaxed">
                        Could not list zones: {zonesError} — check the app&apos;s Cloudflare token has Zone:Read permission.
                      </p>
                    ) : (
                      <Select value={tunnelZoneId} onValueChange={setTunnelZoneId}>
                        <SelectTrigger><SelectValue placeholder="Select a zone in this account" /></SelectTrigger>
                        <SelectContent>
                          {zones.length === 0 && <SelectItem value="__none__" disabled>No active zones on this app&apos;s token</SelectItem>}
                          {zones.map((z) => (
                            <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Subdomain (optional)</Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="flex-1 font-mono text-xs"
                        placeholder="node"
                        value={tunnelSubdomain}
                        onChange={(e) => setTunnelSubdomain(e.target.value)}
                        disabled={!selectedTunnelZone}
                        autoComplete="off"
                      />
                      <span className="text-xs text-muted-foreground">.{selectedTunnelZone?.name ?? 'zone'}</span>
                    </div>
                  </div>
                  {selectedTunnelZone && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      This node&apos;s <strong>API</strong> will be reachable at{' '}
                      <code className="font-mono rounded bg-background/60 px-1.5 py-0.5">
                        {derivedTunnelHostname || `${selectedTunnelZone.name}`}
                      </code>{' '}
                      (CNAME created on <strong>{selectedTunnelZone.name}</strong>). The node&apos;s
                      global address serves the API — the web app has its own surface in the managed
                      web app section.
                    </p>
                  )}
                </div>
              )}

              {tunnel?.enabled && tunnel.tunnelId && (
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between rounded-md bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">Tunnel id</span>
                    <code className="font-mono">{tunnel.tunnelId}</code>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-background/60 px-3 py-2">
                    <span className="text-muted-foreground">Hostname</span>
                    <code className="font-mono">{tunnel.hostname ?? '—'}</code>
                  </div>
                  {tunnel.health?.status === 'down' && (
                    <p className="text-xs text-amber-600">
                      Tunnel is down — run cloudflared with the tunnel&apos;s token (see the Cloudflare app detail page).
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {tunnel?.enabled ? (
                  <Button size="sm" variant="outline" onClick={disableTunnel} disabled={updateConfig.isPending}>
                    Disable tunnel
                  </Button>
                ) : (
                  <Button size="sm" onClick={enableTunnel} disabled={updateConfig.isPending || !providerId || !selectedTunnelZone}>
                    <Network className="mr-1 size-4" /> Enable tunnel
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tunnel feature not available anywhere */}
        {!tunnelAvailable && (
          <Alert>
            <Network className="size-4" />
            <AlertTitle>Tunnel option not available</AlertTitle>
            <AlertDescription>
              Add a Cloudflare app and enable &quot;Tunnel management&quot; on it (Admin → Providers → DNS → Cloudflare)
              to expose the Tunnel option here.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

function TunnelHealthBadge({ health }: { health: TunnelHealth | null }) {
  if (!health || !health.status) return <Badge variant="outline">Not provisioned</Badge>
  if (health.status === 'healthy') {
    return <Badge variant="default" className="gap-1"><ShieldCheck className="size-3" /> Healthy{health.connections > 0 ? ` · ${health.connections} conn` : ''}</Badge>
  }
  if (health.status === 'degraded') return <Badge variant="secondary">Degraded</Badge>
  if (health.status === 'down' || health.status === 'inactive') {
    return <Badge variant="destructive" className="gap-1" title={health.error ?? undefined}><ShieldAlert className="size-3" /> {health.status === 'down' ? 'Down' : 'Inactive'}</Badge>
  }
  return <Badge variant="secondary">Checking…</Badge>
}

