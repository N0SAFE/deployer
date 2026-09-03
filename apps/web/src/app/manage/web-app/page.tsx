'use client'

/**
 * Managed Web App console — the beautiful visual of the SINGLE console URL
 * (`/manage/web-app`).
 *
 * Traefik routes this path to the web app when the managed web is enabled;
 * when it is stopped, the same URL falls back to the API HTML console (same
 * data model, same actions — see PlatformManagedWebService). This page is
 * deliberately public (like the fallback): the operator console must work
 * even when the whole app is down.
 */

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowUpRight,
  Cable,
  Globe,
  Loader2,
  Plug,
  Power,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import {
  useDisableManagedWebTunnel,
  useEnableManagedWebTunnel,
  useManagedWebState,
  useRestartManagedWeb,
  useSetManagedWebOrigin,
  useToggleManagedWeb,
} from '@/domains/managed-web/hooks'

type LedTone = 'green' | 'amber' | 'red' | 'gray'

/** Front-panel LED: glow + subtle pulse for active states. */
function Led({ tone }: { tone: LedTone }) {
  const color =
    tone === 'green' ? '#22c55e' : tone === 'amber' ? '#f59e0b' : tone === 'red' ? '#ef4444' : '#64748b'
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{
        backgroundColor: color,
        boxShadow: `0 0 6px 1px ${tone === 'gray' ? 'transparent' : color}66`,
        animation: tone === 'amber' ? 'pulse 1.4s ease-in-out infinite' : undefined,
      }}
    />
  )
}

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 text-sm">{children}</div>
    </div>
  )
}

/** Patch-panel row: a mode tag + mono address (one public reach point of the web appliance). */
function PatchRow({
  mode,
  address,
  chip,
  tone = 'gray',
}: {
  mode: 'PLATFORM' | 'CUSTOM' | 'TUNNEL'
  address: string
  chip?: string
  tone?: LedTone
}) {
  const modeColor =
    mode === 'PLATFORM'
      ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
      : mode === 'CUSTOM'
        ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
      <Led tone={tone} />
      <Badge variant="outline" className={`font-mono text-[10px] tracking-wider ${modeColor}`}>
        {mode}
      </Badge>
      <code className="min-w-0 flex-1 truncate font-mono text-sm">{address}</code>
      {chip !== undefined ? <span className="text-xs text-muted-foreground">{chip}</span> : null}
    </div>
  )
}

export default function ManageWebAppPage() {
  const { data, isLoading, isError, error, refetch } = useManagedWebState()
  const toggle = useToggleManagedWeb()
  const restart = useRestartManagedWeb()
  const setOrigin = useSetManagedWebOrigin()
  const enableTunnel = useEnableManagedWebTunnel()
  const disableTunnel = useDisableManagedWebTunnel()

  const [originInput, setOriginInput] = useState('')
  const [tunnelHostname, setTunnelHostname] = useState('')
  const [confirmRemoveTunnel, setConfirmRemoveTunnel] = useState(false)

  const state = data
  const enabled = state?.enabled ?? false

  // Keep the origin input in sync with the server state (after a mutation or
  // a refetch it reflects the persisted value).
  const [customKey, setCustomKey] = useState<string | null>(null)
  useEffect(() => {
    if (state !== undefined && state.customOrigin !== customKey) {
      setOriginInput(state.customOrigin ?? '')
      setCustomKey(state.customOrigin)
    }
  }, [state, customKey])

  const ledTone: LedTone = state === undefined
    ? 'gray'
    : state.external
      ? 'gray'
      : !enabled
        ? 'red'
        : state.supervisorState === 'converging'
          ? 'amber'
          : state.healthy === false
            ? 'red'
            : 'green'

  const busy = toggle.isPending || restart.isPending || setOrigin.isPending || enableTunnel.isPending || disableTunnel.isPending

  async function run(fn: () => Promise<unknown>, success: string) {
    try {
      await fn()
      toast.success(success)
    } catch (e) {
      toast.error(isDefinedORPCError(e) ? getErrorMessage(e) : UNKNOWN_ORPC_ERROR_MESSAGE)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      {/* Eyebrow + title */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Deployer · Web Appliance
        </p>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Managed Web App</h1>
          {state !== undefined && (
            <Badge
              variant="outline"
              className={
                enabled
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/40 bg-red-500/10 text-red-300'
              }
            >
              <Led tone={ledTone} />
              <span className="ml-1.5">{enabled ? 'Enabled' : 'Disabled'}</span>
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          A single console URL for both visuals — Traefik serves this page while the app runs, and the API fallback when it stops.
        </p>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {isError && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Console unreachable</AlertTitle>
          <AlertDescription>
            {getErrorMessage(error)}
            <Button variant="outline" size="sm" className="ml-3" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {state === undefined ? null : (
        <>
          {/* Status panel */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity className="size-4 text-muted-foreground" /> Runtime status
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <StatusRow label="Reconciler">
                <Led tone={ledTone} />
                <span className="font-mono">{state.supervisorState ?? 'not registered'}</span>
              </StatusRow>
              <StatusRow label="Health">
                {state.healthy === null
                  ? <span className="text-muted-foreground">supervisor not registered</span>
                  : state.healthy
                    ? <span className="text-emerald-300">healthy</span>
                    : <span className="text-red-300">{state.detail ?? 'unhealthy'}</span>}
              </StatusRow>
              <StatusRow label="External mode">
                <code className="font-mono text-muted-foreground">{String(state.external)}</code>
              </StatusRow>
            </CardContent>
          </Card>

          {/* Public surface — the patch panel */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Cable className="size-4 text-muted-foreground" /> Public surface
              </CardTitle>
              <CardDescription className="text-xs">
                Every reach point enters the platform Traefik, which routes it to this web container.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-1">
              <PatchRow mode="PLATFORM" address={state.webHostname} tone="green" />
              {state.customOrigin !== null && (
                <PatchRow mode="CUSTOM" address={state.customOrigin} chip="custom origin" />
              )}
              {state.tunnel !== null && (
                <PatchRow
                  mode="TUNNEL"
                  address={state.tunnel.hostname}
                  tone="green"
                  chip={`tunnel ${state.tunnel.tunnelId.slice(0, 8)}…`}
                />
              )}
            </CardContent>

            <Separator />

            <CardContent className="flex flex-col gap-3 pt-4">
              <div>
                <Label htmlFor="web-origin" className="text-xs text-muted-foreground">Custom origin (domain / IP)</Label>
                <div className="mt-1.5 flex gap-2">
                  <Input
                    id="web-origin"
                    placeholder="web.example.com"
                    className="font-mono"
                    value={originInput}
                    onChange={(e) => setOriginInput(e.target.value)}
                  />
                  <Button
                    variant="default"
                    disabled={busy}
                    onClick={() => run(() => setOrigin.mutateAsync({ origin: originInput.trim() === '' ? null : originInput.trim() }), 'Origin updated')}
                  >
                    {setOrigin.isPending ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
                    <span className="ml-1.5">Save</span>
                  </Button>
                  {state.customOrigin !== null && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => run(() => setOrigin.mutateAsync({ origin: null }), 'Origin cleared')}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="web-tunnel" className="text-xs text-muted-foreground">Dedicated tunnel</Label>
                {state.tunnel === null ? (
                  <div className="mt-1.5 flex gap-2">
                    <Input
                      id="web-tunnel"
                      placeholder="web.sebille.net"
                      className="font-mono"
                      value={tunnelHostname}
                      onChange={(e) => setTunnelHostname(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={busy || tunnelHostname.trim() === ''}
                      onClick={() => run(
                        () => enableTunnel.mutateAsync({ hostname: tunnelHostname.trim() }),
                        'Tunnel provisioned — app restarted with the new origin',
                      )}
                    >
                      {enableTunnel.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
                      <span className="ml-1.5">Provision</span>
                    </Button>
                  </div>
                ) : (
                  <div className="mt-1.5 flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md border border-border/60 bg-card/60 px-3 py-2 font-mono text-sm">
                      {state.tunnel.hostname}
                    </code>
                    <Button
                      variant={confirmRemoveTunnel ? 'destructive' : 'outline'}
                      disabled={busy}
                      onClick={() => {
                        if (!confirmRemoveTunnel) {
                          setConfirmRemoveTunnel(true)
                          setTimeout(() => setConfirmRemoveTunnel(false), 3000)
                          return
                        }
                        setConfirmRemoveTunnel(false)
                        run(() => disableTunnel.mutateAsync({}), 'Tunnel removed — app restarted')
                      }}
                    >
                      {disableTunnel.isPending
                        ? <Loader2 className="size-4 animate-spin" />
                        : <Trash2 className="size-4" />}
                      <span className="ml-1.5">{confirmRemoveTunnel ? 'Click again to confirm' : 'Remove tunnel'}</span>
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Controls */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Power className="size-4 text-muted-foreground" /> Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant={enabled ? 'destructive' : 'default'}
                disabled={busy || state.external}
                onClick={() => run(() => toggle.mutateAsync({}), enabled ? 'Managed web app disabled' : 'Managed web app enabled')}
              >
                {toggle.isPending ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
                <span className="ml-1.5">{enabled ? 'Disable managed web app' : 'Enable managed web app'}</span>
              </Button>
              <Button
                variant="outline"
                disabled={busy || state.external}
                onClick={() => run(() => restart.mutateAsync({}), 'Restart requested')}
              >
                {restart.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                <span className="ml-1.5">Force restart container</span>
              </Button>
              {state.external && (
                <span className="text-xs text-amber-300">
                  External mode — lifecycle belongs to the compose stack.
                </span>
              )}
            </CardContent>
          </Card>

          {/* Footnote */}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            The node&apos;s global address (Network &amp; Reachability) serves the API via Traefik — this console is the web
            app&apos;s own surface.
            <Link
              href="/dashboard/admin/system"
              className="inline-flex items-center gap-0.5 text-sky-300 hover:underline"
            >
              Node network <ArrowUpRight className="size-3" />
            </Link>
          </p>
        </>
      )}
    </main>
  )
}