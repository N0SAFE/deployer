'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Switch } from '@deployer/ui/components/shadcn/switch'
import { useCloudflareCreateRecord, useCloudflareDeleteRecord } from '@/domains/dns-providers/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'

export interface DnsRecordRow {
  id: string
  type: string
  name: string
  content: string
  ttl: number
  proxied?: boolean
}

const EDITABLE_TYPES = ['A', 'AAAA', 'CNAME', 'TXT'] as const
type EditableType = (typeof EDITABLE_TYPES)[number]

function toEditableType(value: string): EditableType {
  return EDITABLE_TYPES.find((t) => t === value) ?? 'A'
}

/** Create or edit one DNS record. Mounted only while open, so its fields always start from `record`. */
export function RecordDialog({
  providerId,
  zoneId,
  zoneName,
  record,
  onClose,
}: {
  providerId: string
  zoneId: string
  zoneName?: string
  /** The record being edited, or null to create. */
  record: DnsRecordRow | null
  onClose: () => void
}) {
  const createRecord = useCloudflareCreateRecord()
  const deleteRecord = useCloudflareDeleteRecord()
  const [type, setType] = useState<EditableType>(toEditableType(record?.type ?? 'A'))
  const [name, setName] = useState(record?.name ?? '')
  const [content, setContent] = useState(record?.content ?? '')
  const [ttl, setTtl] = useState(record && record.ttl !== 1 ? String(record.ttl) : '')
  const [proxied, setProxied] = useState(record?.proxied ?? true)
  const [submitted, setSubmitted] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const ttlNumber = ttl.trim() ? Number(ttl.trim()) : 1
  const errors = {
    name: name.trim() ? undefined : 'Enter a record name',
    content: content.trim() ? undefined : 'Enter what the record points to',
    ttl: Number.isInteger(ttlNumber) && ttlNumber >= 1 ? undefined : 'Use a whole number of seconds, or leave empty for Auto',
  }
  const invalid = Object.values(errors).some(Boolean)
  const pending = createRecord.isPending || deleteRecord.isPending

  const save = async () => {
    setSubmitted(true)
    if (invalid) return
    setFailure(null)
    try {
      // The API has no update call: an edit deletes the old record then creates the replacement.
      if (record) await deleteRecord.mutateAsync({ params: { providerId, zoneId, id: record.id } })
      await createRecord.mutateAsync({
        params: { providerId, zoneId },
        body: { type, name: name.trim(), content: content.trim(), ttl: ttlNumber, proxied },
      })
      toast.success(record ? 'Record updated' : 'Record created')
      onClose()
    } catch (err) {
      setFailure(
        record
          ? `${getErrorMessage(err, 'Cloudflare refused the change.')} The original record may have been removed — reload the list to check.`
          : getErrorMessage(err, 'Cloudflare refused the record.'),
      )
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{record ? 'Edit DNS record' : 'New DNS record'}</DialogTitle>
          <DialogDescription>
            {record ? 'Saving replaces the record on Cloudflare with the values below.' : `Adds a record to ${zoneName ?? 'the selected zone'}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rec-type">Type</Label>
            <Select value={type} onValueChange={(v) => { setType(toEditableType(v)); }}>
              <SelectTrigger id="rec-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EDITABLE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rec-name">Name</Label>
            <Input id="rec-name" className="font-mono text-sm" placeholder="app or app.example.com" value={name} onChange={(e) => { setName(e.target.value); }} aria-invalid={submitted && !!errors.name} />
            <p className="text-sm text-muted-foreground">A bare name such as <code className="font-mono">app</code> is created under {zoneName ?? 'the zone'}.</p>
            {submitted && errors.name ? <p role="alert" className="text-sm text-destructive">{errors.name}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rec-content">Content</Label>
            <Input id="rec-content" className="font-mono text-sm" placeholder="203.0.113.10, a hostname or a TXT value" value={content} onChange={(e) => { setContent(e.target.value); }} aria-invalid={submitted && !!errors.content} />
            {submitted && errors.content ? <p role="alert" className="text-sm text-destructive">{errors.content}</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-ttl">TTL (seconds)</Label>
              <Input id="rec-ttl" inputMode="numeric" className="font-mono text-sm" placeholder="Auto" value={ttl} onChange={(e) => { setTtl(e.target.value); }} aria-invalid={submitted && !!errors.ttl} />
              {submitted && errors.ttl ? <p role="alert" className="text-sm text-destructive">{errors.ttl}</p> : null}
            </div>
            <div className="flex items-center gap-2 self-end pb-2">
              <Switch id="rec-proxied" checked={proxied} onCheckedChange={setProxied} />
              <Label htmlFor="rec-proxied">Proxied through Cloudflare</Label>
            </div>
          </div>
          {failure ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{failure}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={pending}>{pending ? 'Saving…' : record ? 'Save changes' : 'Create record'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
