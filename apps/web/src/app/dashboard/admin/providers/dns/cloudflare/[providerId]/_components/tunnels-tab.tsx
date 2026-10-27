'use client'

import { useMemo, useState } from 'react'
import { Copy, Network, Plus, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { EmptyState, StatusBadge } from '@/components/dashboard'
import { AuthDashboardNetworkIngress } from '@/routes'
import { useCloudflareDeleteTunnel, useCloudflareGetTunnelToken, useCloudflareTunnels, useCloudflareZones } from '@/domains/dns-providers/hooks'
import { useIngress } from '@/domains/reachability/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'
import { ProviderLoadError } from '../../../../_components/states'
import { RemoveAccountDialog } from '../../../../_components/remove-account-dialog'
import { CreateTunnelDialog, TunnelTokenDialog } from './tunnel-dialogs'

/** Cloudflare reports `inactive` for a tunnel with no connector: say that, not "Inactive". */
const TUNNEL_LABEL = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down', inactive: 'No connector' } as const

export function TunnelsTab({ providerId }: { providerId: string }) {
  const tunnelsQuery = useCloudflareTunnels(providerId)
  const tunnels = tunnelsQuery.data?.tunnels ?? []
  const tunnelsError = tunnelsQuery.data?.error ?? (tunnelsQuery.error ? getErrorMessage(tunnelsQuery.error) : null)
  const zonesQuery = useCloudflareZones(providerId)
  const zonesError = zonesQuery.data?.error ?? null
  const { data: ingress } = useIngress()
  const deleteTunnel = useCloudflareDeleteTunnel()
  const getToken = useCloudflareGetTunnelToken()

  const stackTunnelId = useMemo(
    () => ingress?.edge.active?.status.resources.find((r) => r.kind === 'tunnel' && r.accountId === providerId)?.id ?? null,
    [ingress, providerId],
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [token, setToken] = useState<{ name: string; value: string } | null>(null)
  const [fetchingTokenFor, setFetchingTokenFor] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const showToken = async (id: string, name: string) => {
    setFetchingTokenFor(id)
    try {
      const result = await getToken.mutateAsync({ params: { providerId, id } })
      if (result.token) setToken({ name, value: result.token })
      else toast.error('Cloudflare returned no run token for this tunnel')
    } catch (err) {
      toast.error('Could not fetch the run token', { description: getErrorMessage(err, 'Cloudflare refused the request.') })
    } finally {
      setFetchingTokenFor(null)
    }
  }

  const confirmRemove = async () => {
    if (!removing) return
    setRemoveError(null)
    try {
      await deleteTunnel.mutateAsync({ params: { providerId, id: removing.id } })
      toast.success('Tunnel deleted')
      setRemoving(null)
    } catch (err) {
      setRemoveError(getErrorMessage(err, 'Cloudflare refused the deletion.'))
    }
  }

  const removingIsStack = removing !== null && removing.id === stackTunnelId

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Tunnels on this account. For the stack&apos;s own public edge, use{' '}
          <AuthDashboardNetworkIngress.Link className="font-medium text-primary hover:underline">Network → Ingress &amp; edge</AuthDashboardNetworkIngress.Link>, which creates and routes the tunnel for you.
        </p>
        <Button size="sm" onClick={() => { setCreateOpen(true); }}><Plus className="mr-2 size-4" />Create tunnel</Button>
      </div>

      {tunnelsError ? (
        <ProviderLoadError what="tunnels" message={`${tunnelsError} The token needs Account → Cloudflare Tunnel → Edit.`} onRetry={() => void tunnelsQuery.refetch()} retrying={tunnelsQuery.isRefetching} />
      ) : tunnelsQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2" role="status" aria-label="Loading tunnels">{[0, 1].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : tunnels.length === 0 ? (
        <EmptyState icon={Network} title="No tunnels on this account" description="A tunnel lets a node publish services without opening an inbound port. Create one here, or let the public edge create the stack's tunnel." action={{ label: 'Create tunnel', onClick: () => { setCreateOpen(true); } }} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tunnels.map((tunnel) => {
            const isStack = tunnel.id === stackTunnelId
            const active = tunnel.connections.filter((c) => !c.isPendingReconnect).length
            const status = tunnel.status ?? 'inactive'
            const label = tunnel.name ?? tunnel.id.slice(0, 8)
            return (
              <Card key={tunnel.id} className={isStack ? 'border-primary/60 ring-1 ring-primary/25' : undefined}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="font-mono text-base">{label}</CardTitle>
                      {isStack ? <Badge className="gap-1"><Star className="size-3" /> Stack&apos;s edge tunnel</Badge> : null}
                    </div>
                    <StatusBadge status={status === 'inactive' ? 'idle' : status} className="normal-case">{TUNNEL_LABEL[status]}</StatusBadge>
                  </div>
                  <CardDescription className="font-mono text-xs">{tunnel.id}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isStack ? <p className="text-sm text-muted-foreground">Every node&apos;s connector shares this tunnel, so adding a node never adds a tunnel.</p> : null}
                  <div className="space-y-1 text-sm">
                    <p className="text-muted-foreground">{active} active connection{active !== 1 ? 's' : ''}</p>
                    {tunnel.connections.length === 0 ? (
                      <p className="text-muted-foreground">No connector is running. Start cloudflared with the run token to open connections.</p>
                    ) : (
                      tunnel.connections.map((c, i) => (
                        <p key={c.id ?? i} className="font-mono text-xs">{c.coloName ?? 'unknown colo'} · {c.isPendingReconnect ? 'reconnecting' : 'connected'}</p>
                      ))
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={fetchingTokenFor === tunnel.id} onClick={() => void showToken(tunnel.id, label)}>
                      <Copy className="mr-1.5 size-3.5" />{fetchingTokenFor === tunnel.id ? 'Fetching…' : 'Run token'}
                    </Button>
                    <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" aria-label={`Delete tunnel ${label}`} onClick={() => { setRemoveError(null); setRemoving({ id: tunnel.id, name: label }) }}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {createOpen ? <CreateTunnelDialog providerId={providerId} zones={zonesQuery.data?.zones ?? []} zonesError={zonesError} onClose={() => { setCreateOpen(false); }} /> : null}
      {token ? <TunnelTokenDialog tunnelName={token.name} token={token.value} onClose={() => { setToken(null); }} /> : null}
      <RemoveAccountDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        kind="tunnel"
        name={removing?.name ?? ''}
        description="This cannot be undone."
        consequences="The tunnel is deleted on Cloudflare. Any connector still using its token stops serving traffic."
        blockedReason={
          removingIsStack ? (
            <>
              This is the stack&apos;s edge tunnel: deleting it cuts every node off at once. Tear the public edge down from{' '}
              <AuthDashboardNetworkIngress.Link className="font-medium underline">Network → Ingress &amp; edge</AuthDashboardNetworkIngress.Link>, which also removes its DNS record.
            </>
          ) : undefined
        }
        pending={deleteTunnel.isPending}
        error={removeError}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  )
}
