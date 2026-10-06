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
import { Siren, Globe, Network, Save, Server } from 'lucide-react'
import { toast } from 'sonner'
import {
  useNodeNetworkConfig,
  useListNodeNetworkConfigs,
  useUpdateNodeNetworkConfig,
  useCheckDomainGate,
  usePublicAccessPointLive,
} from '@/domains/reachability/hooks'
import { useFleetServers } from '@/domains/fleet/hooks'
import { useMeshSseState } from '@/domains/mesh/hooks'
import { z } from 'zod/v4'

const addressSchema = z.object({ publicAddress: z.string().optional() })

/**
 * A node's OWN network config.
 *
 * No tunnel field: the tunnel belongs to the STACK (one tunnel serves every
 * node), configured in Edge & Ingress. This card answers only "what is this
 * node's address, and is it reachable?"
 */
interface NodeNetworkView {
  nodeId: string
  publicAddress: string | null
  addressKind: 'ip' | 'hostname' | null
  updatedAt: string
}

export function NodeNetworkConfig() {
  const { data: allConfigsData } = useListNodeNetworkConfigs()
  const { data: fleetData } = useFleetServers()
  const { state: meshState } = useMeshSseState()
  const { data: gate } = useCheckDomainGate()

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

  const [addressInput, setAddressInput] = useState('')

  useEffect(() => {
    setAddressInput(config?.publicAddress ?? '')
  }, [selectedNodeId, config?.publicAddress])

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

  const gateInfo = gate as {
    allowed: boolean
    reason: string | null
    publicAddress: string | null
    addressKind: 'ip' | 'hostname' | null
  } | undefined

  const selectedLabel = nodeOptions.find((n) => n.nodeId === selectedNodeId)?.label ?? selectedNodeId

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <CardTitle>Node Network &amp; Reachability</CardTitle>
        </div>
        <CardDescription>
          Per-node globally reachable address. Each node keeps its own config in the global DB.
          How the internet reaches this stack (direct DNS or a Cloudflare tunnel) is a STACK
          setting — see <span className="font-medium">Edge &amp; Ingress</span>.
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

        {/* The node's reachable address. */}
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
      </CardContent>
    </Card>
  )
}

