'use client'

import { useState } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { useCloudflareCreateTunnel } from '@/domains/dns-providers/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'
import { SecretInput } from '../../../../_components/secret-input'

export interface ZoneOption {
  id: string
  name: string
}

/** Creates a tunnel on the account and (when a zone is picked) the CNAME that points at it. */
export function CreateTunnelDialog({
  providerId,
  zones,
  zonesError,
  onClose,
}: {
  providerId: string
  zones: readonly ZoneOption[]
  zonesError: string | null
  onClose: () => void
}) {
  const createTunnel = useCloudflareCreateTunnel()
  const [name, setName] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [subdomain, setSubdomain] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const zone = zones.find((z) => z.id === zoneId)
  const hostname = zone ? (subdomain.trim() ? `${subdomain.trim()}.${zone.name}` : zone.name) : ''

  const submit = async () => {
    if (!zone) {
      setFailure('Pick the zone the tunnel hostname lives in.')
      return
    }
    setFailure(null)
    try {
      const result = await createTunnel.mutateAsync({
        params: { providerId },
        body: { name: name.trim() || `deployer-tunnel-${Date.now().toString().slice(-6)}`, hostname },
      })
      toast.success(`Tunnel “${result.tunnel.name ?? (name.trim() === '' ? 'new tunnel' : name.trim())}” created`)
      onClose()
    } catch (err) {
      setFailure(getErrorMessage(err, 'Cloudflare refused the tunnel.'))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a Cloudflare Tunnel</DialogTitle>
          <DialogDescription>The tunnel is created on Cloudflare and a CNAME for its hostname is added to the zone you pick.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tun-name">Tunnel name</Label>
            <Input id="tun-name" placeholder="deployer-node" value={name} onChange={(e) => { setName(e.target.value); }} />
            <p className="text-sm text-muted-foreground">Optional. A name is generated when empty.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tun-zone">Zone</Label>
            {zonesError ? (
              <p role="alert" className="text-sm text-destructive">Could not list zones: {zonesError} The token needs Zone → Zone → Read.</p>
            ) : (
              <Select value={zoneId} onValueChange={setZoneId} disabled={zones.length === 0}>
                <SelectTrigger id="tun-zone"><SelectValue placeholder={zones.length === 0 ? 'No zones on this account' : 'Select a zone'} /></SelectTrigger>
                <SelectContent>{zones.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tun-sub">Subdomain <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <div className="flex items-center gap-1.5">
              <Input id="tun-sub" className="flex-1 font-mono text-sm" placeholder="node" value={subdomain} onChange={(e) => { setSubdomain(e.target.value); }} disabled={!zone} />
              <span className="text-sm text-muted-foreground">.{zone?.name ?? 'zone'}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {hostname ? <>Reachable at <code className="font-mono">{hostname}</code>.</> : 'Select a zone first.'}
            </p>
          </div>
          {failure ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{failure}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={createTunnel.isPending}>{createTunnel.isPending ? 'Creating…' : 'Create tunnel'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Shows a tunnel's run token masked, with reveal and copy. Whoever holds it can run the tunnel. */
export function TunnelTokenDialog({ tunnelName, token, onClose }: { tunnelName: string; token: string; onClose: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token)
      toast.success('Tunnel token copied')
    } catch {
      toast.error('Could not copy', { description: 'Reveal the token and copy it by hand.' })
    }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run token for {tunnelName}</DialogTitle>
          <DialogDescription>Anyone with this token can run this tunnel. Treat it like a password.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1"><SecretInput id="tun-token" value={token} onChange={() => undefined} /></div>
            <Button variant="outline" size="icon" aria-label="Copy tunnel token" onClick={() => void copy()}><Copy className="size-4" /></Button>
          </div>
          <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
            <li>On the node, run <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-xs">cloudflared tunnel --no-autoupdate run --token &lt;TOKEN&gt;</code></li>
            <li>Cloudflare reports the tunnel healthy once a connector connects.</li>
          </ol>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
