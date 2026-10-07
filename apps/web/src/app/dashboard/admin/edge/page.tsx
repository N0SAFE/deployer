'use client'

import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Globe, Network, Trash2, ShieldCheck, Siren, Radio, Lock } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { RadioGroup, RadioGroupItem } from '@repo/ui/components/shadcn/radio-group'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { EmptyState, PageHeader } from '@/components/dashboard'
import { useStackEdge, useSetStackEdgeMode, useClearStackEdgeTunnel, useTunnelHealth } from '@/domains/reachability/hooks'
import { useDNSProviders } from '@/domains/dns-providers/hooks'
import { getErrorMessage, isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import {
  DEFAULT_INGRESS_PROVIDER,
  INGRESS_PROVIDERS,
  type IngressProvider,
} from '@repo/contracts-entities/entities/ingress/index'

/**
 * Presentation copy per provider.
 *
 * Ordered to match `INGRESS_PROVIDERS` (least → most exposed) so the list the
 * operator sees can never disagree with the canonical ordering about which
 * choice is the riskier one. The `requires` line is drawn from the same traits
 * the API uses, spelled out for a human.
 */
const PROVIDER_COPY: Record<IngressProvider, { label: string; blurb: string; requires: string }> = {
  local: {
    label: 'This machine only',
    blurb:
      'The ingress listens on 127.0.0.1. Nothing is reachable from another machine, and no provider account or DNS is involved.',
    requires: 'Nothing. This is what a fresh install gets.',
  },
  wireguard: {
    label: 'Private mesh',
    blurb:
      'The ingress listens on this node’s WireGuard overlay address, so only enrolled mesh peers can reach it. No public address is involved.',
    requires: 'A mesh overlay address and at least one enrolled peer.',
  },
  tunnel: {
    label: 'Cloudflare Tunnel',
    blurb:
      'Connectors dial out to Cloudflare and hold the connection, so the node accepts no inbound connection at all. One tunnel serves the whole stack.',
    requires: 'A Cloudflare account plus a tunnel-capable DNS provider here.',
  },
  direct: {
    label: 'Direct DNS (public)',
    blurb:
      'DNS points at this node and the ingress binds :80/:443 on every interface. No third party sits in front.',
    requires: 'A public IP and inbound ports 80/443 open on the firewall.',
  },
}

/**
 * Edge & Ingress — how a client reaches this stack's ingress.
 *
 * The provider is a STACK-level decision, not a per-node one. Four providers are
 * PEERS, ordered from least to most exposed, and the page says plainly what each
 * one binds rather than making the operator infer it:
 *
 *   local     — loopback only. Reachable from this machine; nothing else.
 *   wireguard — the mesh overlay address. Reachable by enrolled peers.
 *   tunnel    — outbound connector. The node accepts no inbound connection.
 *   direct    — :80/:443 on every interface. The only public one.
 *
 * Exposure comes from the SERVER (`edge.exposure`), not from comparing the mode
 * to a literal here: the two answers drifted once already, and "binds a port but
 * only on loopback" is not something a client should have to re-derive.
 */
export default function AdminEdgePage() {
  const { data: edge, isLoading, error, refetch } = useStackEdge()
  const { data: health } = useTunnelHealth()
  const { data: providersData } = useDNSProviders()
  const setMode = useSetStackEdgeMode()
  const clearTunnel = useClearStackEdgeTunnel()

  const [providerId, setProviderId] = useState('')
  const [wildcard, setWildcard] = useState('')

  // Tunnel-capable providers only: an adapter without tunnelManagement cannot
  // create one, so offering it would be a dead end.
  const tunnelProviders = useMemo(
    () => (providersData?.providers ?? []).filter((p) => p.features?.tunnelManagement === true),
    [providersData],
  )

  const mode: IngressProvider = edge?.mode ?? DEFAULT_INGRESS_PROVIDER
  const tunnel = edge?.tunnel
  const provisioned = tunnel?.provisioned === true
  const isTunnelMode = mode === 'tunnel'
  const exposure = edge?.exposure

  const onSwitchMode = useCallback(
    async (next: IngressProvider) => {
      if (next === mode) return
      try {
        await setMode.mutateAsync({
          mode: next,
          // Only sent when provisioning is actually needed; the server keeps
          // an existing tunnel and just re-applies its routing rule.
          ...(next === 'tunnel' && !provisioned
            ? {
                ...(providerId ? { providerId } : {}),
                ...(wildcard.trim() ? { wildcard: wildcard.trim() } : {}),
              }
            : {}),
        })
        toast.success(`${PROVIDER_COPY[next].label} enabled`)
        refetch()
      } catch (err) {
        toast.error(isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE)
      }
    },
    [mode, provisioned, providerId, wildcard, setMode, refetch],
  )

  const onClearTunnel = useCallback(async () => {
    try {
      await clearTunnel.mutateAsync({})
      toast.success('Stack tunnel deleted')
      refetch()
    } catch (err) {
      toast.error(isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE)
    }
  }, [clearTunnel, refetch])

  if (error) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Could not load the edge configuration</AlertTitle>
        <AlertDescription>{getErrorMessage(error)}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edge & Ingress"
        description="How the internet reaches this stack — and whether the ingress publishes a port."
      />

      {/* Current state, stated in terms of what actually happens on the wire. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {isTunnelMode ? <Radio className="size-4" /> : <Globe className="size-4" />}
            Current edge
            <Badge variant={exposure?.externallyReachable ? 'default' : 'secondary'}>
              {isLoading ? '…' : PROVIDER_COPY[mode].label}
            </Badge>
          </CardTitle>
          <CardDescription>{PROVIDER_COPY[mode].blurb}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Reachable from</div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                {isLoading ? (
                  <Skeleton className="h-5 w-24" />
                ) : exposure?.externallyReachable ? (
                  <Badge variant="default">Other machines</Badge>
                ) : (
                  <Badge variant="secondary">This machine only</Badge>
                )}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Host ports</div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                {isLoading ? (
                  <Skeleton className="h-5 w-24" />
                ) : exposure?.bindsNonLoopbackPort ? (
                  <Badge variant="destructive">Open on every interface</Badge>
                ) : edge?.publishesEntryPort ? (
                  <Badge variant="outline">Loopback only</Badge>
                ) : (
                  <Badge variant="outline">None bound</Badge>
                )}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Inbound firewall</div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                {isLoading ? (
                  <Skeleton className="h-5 w-24" />
                ) : exposure?.requiresOpenInboundPorts ? (
                  <Badge variant="destructive">80/443 must be open</Badge>
                ) : (
                  <Badge variant="secondary">Nothing to open</Badge>
                )}
              </div>
            </div>
          </div>

          {/* The loopback lane works in EVERY provider, so it is always worth
              showing — on a fresh install it IS the console URL. */}
          {edge?.localUrl && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="text-muted-foreground">On this machine:</span>
              <a href={edge.localUrl} className="font-mono underline underline-offset-4">
                {edge.localUrl}
              </a>
            </div>
          )}

          {provisioned && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <span className="text-muted-foreground">
                Routes <span className="text-foreground font-mono">{tunnel?.wildcard ?? '—'}</span>
              </span>
              {health && (
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-4" />
                  {health.status ?? 'unknown'}
                  <span className="text-muted-foreground">
                    {health.connections} connector{health.connections === 1 ? '' : 's'}
                  </span>
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={onClearTunnel}
                disabled={clearTunnel.isPending}
              >
                <Trash2 className="mr-2 size-4" />
                Delete tunnel on Cloudflare
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* The mode switch itself. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="size-4" />
            Edge mode
          </CardTitle>
          <CardDescription>
            This decides whether the ingress binds a host port. It is derived from the mode, never guessed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={mode}
            onValueChange={(v) => void onSwitchMode(v as IngressProvider)}
            disabled={setMode.isPending || isLoading}
            className="gap-3"
          >
            {INGRESS_PROVIDERS.map((provider) => (
              <label
                key={provider}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-checked:border-primary"
              >
                <RadioGroupItem value={provider} id={`edge-${provider}`} className="mt-1" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {PROVIDER_COPY[provider].label}
                    {/* The ONLY provider that opens a port to the internet. Marked
                        because it is the one choice with a real security cost, and
                        opting into it should never be accidental. */}
                    {provider === 'direct' && <Badge variant="destructive">Opens ports</Badge>}
                    {provider === DEFAULT_INGRESS_PROVIDER && <Badge variant="secondary">Default</Badge>}
                  </div>
                  <p className="text-muted-foreground text-sm">{PROVIDER_COPY[provider].blurb}</p>
                  <p className="text-muted-foreground text-xs">
                    <span className="font-medium">Requires:</span> {PROVIDER_COPY[provider].requires}
                  </p>
                </div>
              </label>
            ))}
          </RadioGroup>

          {/* Provisioning inputs — only needed when switching TO tunnel without one. */}
          {!isTunnelMode && !provisioned && (
            <div className="space-y-3 rounded-lg border border-dashed p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Lock className="size-4" />
                Tunnel setup
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edge-provider">Cloudflare app</Label>
                  {tunnelProviders.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No tunnel-capable provider yet — add one under Providers → DNS providers.
                    </p>
                  ) : (
                    <select
                      id="edge-provider"
                      aria-label="Cloudflare app"
                      value={providerId}
                      onChange={(e) => setProviderId(e.target.value)}
                      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    >
                      <option value="">Select a provider…</option>
                      {tunnelProviders.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edge-wildcard">Wildcard hostname</Label>
                  <Input
                    id="edge-wildcard"
                    placeholder="*.example.com"
                    value={wildcard}
                    onChange={(e) => setWildcard(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    One rule covers every app and preview, so onboarding a deployment never touches Cloudflare.
                  </p>
                </div>
              </div>
            </div>
          )}

          {isTunnelMode && !provisioned && (
            <Alert>
              <Siren className="size-4" />
              <AlertTitle>No tunnel provisioned</AlertTitle>
              <AlertDescription>
                The edge is set to tunnel mode but nothing is stored, so the connector has nothing to run. Switch to
                direct DNS and back with a provider + wildcard to provision one.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {isLoading && <EmptyState title="Loading edge configuration…" description="" icon={Network} />}
    </div>
  )
}
