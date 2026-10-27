'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Switch } from '@deployer/ui/components/shadcn/switch'
import { useUpdateDNSProvider } from '@/domains/dns-providers/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'
import type { CloudflareAccount } from './types'

function ToggleRow({ id, title, text, checked, onChange }: { id: string; title: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {title}
        </Label>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

/** Edits an account's name and what the platform may use it for. Mounted per account so state starts fresh. */
export function CloudflareConfigureDialog({ account, onClose }: { account: CloudflareAccount; onClose: () => void }) {
  const update = useUpdateDNSProvider()
  const [name, setName] = useState(account.name)
  const [dns, setDns] = useState(account.features.dnsManagement)
  const [tunnel, setTunnel] = useState(account.features.tunnelManagement)
  const [active, setActive] = useState(account.isActive)
  const [failure, setFailure] = useState<string | null>(null)

  const save = async () => {
    setFailure(null)
    try {
      await update.mutateAsync({
        params: { id: account.id },
        body: { name: name.trim() || undefined, isActive: active, features: { dnsManagement: dns, tunnelManagement: tunnel } },
      })
      toast.success(`Saved “${name.trim() || account.name}”`)
      onClose()
    } catch (err) {
      setFailure(getErrorMessage(err, 'The change was refused.'))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings for {account.name}</DialogTitle>
          <DialogDescription>Choose what the platform may use this account for.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cf-cfg-name">Account name</Label>
            <Input id="cf-cfg-name" value={name} onChange={(e) => { setName(e.target.value); }} />
          </div>
          <ToggleRow id="cf-cfg-dns" title="DNS management" text="Zones, records and domain checks use this account." checked={dns} onChange={setDns} />
          <ToggleRow id="cf-cfg-tunnel" title="Tunnel management" text="Lets Network → Ingress & edge run the public edge tunnel on this account." checked={tunnel} onChange={setTunnel} />
          <ToggleRow id="cf-cfg-active" title="Enabled" text="A disabled account cannot be used by any other module." checked={active} onChange={setActive} />
          {failure ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {failure}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
