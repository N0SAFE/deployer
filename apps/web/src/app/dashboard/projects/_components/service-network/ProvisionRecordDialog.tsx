'use client'

import { useMemo, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Switch } from '@deployer/ui/components/shadcn/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@deployer/ui/components/shadcn/dialog'
import { AutocompleteField } from '../steps/autocomplete-field'

export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT'] as const
export type RecordType = (typeof RECORD_TYPES)[number]

export function isRecordType(value: string): value is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(value)
}

export interface ProvisionPayload {
  name: string
  type: RecordType
  content: string
  ttl?: number
  proxied?: boolean
}

/** Dialog to auto-provision a DNS record in the resolved zone. */
export function ProvisionRecordDialog({
  zoneName,
  onProvision,
  pending,
}: {
  zoneName: string
  onProvision: (payload: ProvisionPayload) => Promise<boolean>
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<RecordType>('CNAME')
  const [content, setContent] = useState('')
  const [ttl, setTtl] = useState('')
  const [proxied, setProxied] = useState(true)

  // Autocomplete presets: `sub.zone`, `@` (zone root), `*` (wildcard).
  const presets = useMemo(() => ['@', '*', `www.${zoneName}`], [zoneName])

  const handleProvision = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error('Record name and content are required')
      return
    }
    const ok = await onProvision({
      name: name.trim(),
      type,
      content: content.trim(),
      ttl: ttl.trim() ? Number(ttl) : undefined,
      proxied,
    })
    if (ok) {
      setOpen(false)
      setName('')
      setContent('')
      setTtl('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1.5 size-3.5" />Provision record</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Provision DNS record</DialogTitle>
          <DialogDescription>Create a record in zone <code className="font-mono">{zoneName}</code> via the DNS provider.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-1.5">
            <Label>Record name</Label>
            <AutocompleteField
              value={name}
              onChange={setName}
              options={presets}
              placeholder={`e.g. api or api.${zoneName}`}
              searchPlaceholder="Type a subdomain or full name…"
              allowCustom
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-type">Type</Label>
              <Select value={type} onValueChange={(v) => { if (isRecordType(v)) setType(v) }}>
                <SelectTrigger id="rec-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECORD_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-ttl">TTL (seconds)</Label>
              <Input id="rec-ttl" type="number" value={ttl} onChange={(e) => { setTtl(e.target.value) }} placeholder="Auto" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rec-content">Content</Label>
            <Input id="rec-content" value={content} onChange={(e) => { setContent(e.target.value) }} placeholder={type === 'CNAME' ? 'target.example.com' : type === 'A' ? '1.2.3.4' : 'text value'} className="font-mono text-sm" />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Proxy through provider</p>
              <p className="text-sm text-muted-foreground">Cloudflare orange-cloud.</p>
            </div>
            <Switch checked={proxied} onCheckedChange={setProxied} aria-label="Proxy through provider" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setOpen(false) }}>Cancel</Button>
          <Button onClick={() => { void handleProvision() }} disabled={pending}>
            {pending ? <Loader2 className="mr-1.5 size-3.5 animate-spin motion-reduce:animate-none" /> : <Plus className="mr-1.5 size-3.5" />}
            Provision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
