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

/**
 * Edge & Ingress — how the internet reaches this stack.
 *
 * The mode is a STACK-level decision, not a per-node one, and that is the whole
 * point: `direct` points DNS at each node (so the ingress must BIND its port),
 * while `tunnel` runs outbound connectors (so it must NOT). One tunnel serves
 * every node — Cloudflare balances across up to 25 connectors — which keeps the
 * Cloudflare side fixed as the fleet grows.
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

  const mode = edge?.mode ?? 'direct'
  const tunnel = edge?.tunnel
  const provisioned = tunnel?.provisioned === true
  const isTunnelMode = mode === 'tunnel'

  const onSwitchMode = useCallback(
    async (next: 'direct' | 'tunnel') => {
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
        toast.success(next === 'tunnel' ? 'Edge switched to Cloudflare Tunnel' : 'Edge switched to direct DNS')
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
            <Badge variant={isTunnelMode ? 'default' : 'secondary'}>
              {isLoading ? '…' : isTunnelMode ? 'Cloudflare Tunnel' : 'Direct DNS'}
            </Badge>
          </CardTitle>
          <CardDescription>
            {isTunnelMode
              ? 'A supervised connector dials out to Cloudflare, so the ingress publishes no host port at all.'
              : 'DNS points at each node and the ingress publishes :80/:443 on it, so nothing sits between a client and Traefik.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Entry port</div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                {isLoading ? (
                  <Skeleton className="h-5 w-24" />
                ) : edge?.publishesEntryPort ? (
                  <Badge variant="secondary">Published (:80/:443)</Badge>
                ) : (
                  <Badge variant="outline">Not published</Badge>
                )}
                <span className="text-muted-foreground">
                  {edge?.publishesEntryPort ? 'reachable by DNS' : 'outbound only'}
                </span>
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Tunnel</div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                {isLoading ? (
                  <Skeleton className="h-5 w-32" />
                ) : provisioned ? (
                  <Badge variant="secondary" className="font-mono text-xs">{tunnel?.tunnelId}</Badge>
                ) : (
                  <span className="text-muted-foreground">None provisioned</span>
                )}
              </div>
            </div>
          </div>

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
            onValueChange={(v) => void onSwitchMode(v === 'tunnel' ? 'tunnel' : 'direct')}
            disabled={setMode.isPending || isLoading}
            className="gap-3"
          >
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-checked:border-primary">
              <RadioGroupItem value="direct" id="edge-direct" className="mt-1" />
              <div className="space-y-1">
                <div className="text-sm font-medium">Direct DNS</div>
                <p className="text-muted-foreground text-sm">
                  No third party. Each node&apos;s address resolves the app hostname, and the ingress publishes
                  :80/:443 on it. Needs a public IP and inbound ports open.
                </p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4 has-checked:border-primary">
              <RadioGroupItem value="tunnel" id="edge-tunnel" className="mt-1" />
              <div className="space-y-1">
                <div className="text-sm font-medium">Cloudflare Tunnel</div>
                <p className="text-muted-foreground text-sm">
                  One tunnel for the whole stack, served by supervised connectors that dial out. No inbound port and
                  no public IP required; availability comes from connector replicas.
                </p>
              </div>
            </label>
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
