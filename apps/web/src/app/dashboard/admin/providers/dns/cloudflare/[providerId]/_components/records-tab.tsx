'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Globe, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import z from 'zod/v4'
import { useSafeQueryParamStatesFromZod } from '@deployer/use-safe-query-param-states-from-zod'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { EmptyState, FilteredEmptyState } from '@/components/dashboard'
import { useCloudflareDeleteRecord, useCloudflareRecords, useCloudflareZones } from '@/domains/dns-providers/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'
import { ProviderLoadError } from '../../../../_components/states'
import { RemoveAccountDialog } from '../../../../_components/remove-account-dialog'
import { RecordDialog, type DnsRecordRow } from './record-dialog'

const PAGE_SIZE = 25
const RECORD_TYPES = ['A', 'AAAA', 'CAA', 'CERT', 'CNAME', 'DNSKEY', 'DS', 'HTTPS', 'LOC', 'MX', 'NAPTR', 'NS', 'OPENPGPKEY', 'PTR', 'SMIMEA', 'SRV', 'SVCB', 'TLSA', 'TXT', 'URI'] as const
type RecordType = (typeof RECORD_TYPES)[number]

function toRecordType(value: string): RecordType | undefined {
  return RECORD_TYPES.find((t) => t === value)
}

const querySchema = z.object({
  zone: z.string().optional(),
  type: z.enum(RECORD_TYPES).optional(),
  q: z.string().optional(),
  page: z.number().int().min(1).optional(),
})

/** DNS records of one zone of a Cloudflare account: pick a zone, filter, create, edit, delete. */
export function RecordsTab({ providerId }: { providerId: string }) {
  const [filters, setFilters] = useSafeQueryParamStatesFromZod(querySchema, { delay: 200 })
  const zoneId = filters.zone ?? ''
  const page = filters.page ?? 1

  const zonesQuery = useCloudflareZones(providerId)
  const zones = zonesQuery.data?.zones ?? []
  const zonesError = zonesQuery.data?.error ?? (zonesQuery.error ? getErrorMessage(zonesQuery.error) : null)
  const zone = zones.find((z) => z.id === zoneId)

  const recordsQuery = useCloudflareRecords(providerId, zoneId, { type: filters.type, name: filters.q, page, pageSize: PAGE_SIZE })
  const records = recordsQuery.data?.records ?? []
  const total = recordsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const recordsError = recordsQuery.data?.error ?? (recordsQuery.error ? getErrorMessage(recordsQuery.error) : null)
  const filtered = filters.type !== undefined || Boolean(filters.q)

  const deleteRecord = useCloudflareDeleteRecord()
  const [dialog, setDialog] = useState<{ record: DnsRecordRow | null } | null>(null)
  const [removing, setRemoving] = useState<DnsRecordRow | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const confirmRemove = async () => {
    if (!removing) return
    setRemoveError(null)
    try {
      await deleteRecord.mutateAsync({ params: { providerId, zoneId, id: removing.id } })
      toast.success('Record deleted')
      setRemoving(null)
    } catch (err) {
      setRemoveError(getErrorMessage(err, 'Cloudflare refused the deletion.'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-52 space-y-1.5">
          <Label htmlFor="rec-zone">Zone</Label>
          <Select value={zoneId} onValueChange={(v) => { setFilters({ zone: v || undefined, page: 1 }); }} disabled={zonesQuery.isLoading || zones.length === 0}>
            <SelectTrigger id="rec-zone"><SelectValue placeholder={zonesQuery.isLoading ? 'Loading zones…' : zones.length === 0 ? 'No zones' : 'Select a zone'} /></SelectTrigger>
            <SelectContent>{zones.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-40 space-y-1.5">
          <Label htmlFor="rec-type-filter">Type</Label>
          <Select value={filters.type ?? '__all__'} onValueChange={(v) => { setFilters({ type: v === '__all__' ? undefined : toRecordType(v), page: 1 }); }}>
            <SelectTrigger id="rec-type-filter"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All types</SelectItem>
              {RECORD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="rec-search">Record name</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="rec-search" className="pl-8" placeholder="Exact record name" value={filters.q ?? ''} onChange={(e) => { setFilters({ q: e.target.value || undefined, page: 1 }); }} />
          </div>
        </div>
        <Button size="sm" disabled={!zoneId} onClick={() => { setDialog({ record: null }); }}>
          <Plus className="mr-2 size-4" />New record
        </Button>
      </div>

      {zonesError ? (
        <ProviderLoadError what="zones" message={`${zonesError} Check that the token has the Zone → Zone → Read permission.`} onRetry={() => void zonesQuery.refetch()} retrying={zonesQuery.isRefetching} />
      ) : !zonesQuery.isLoading && zones.length === 0 ? (
        <EmptyState icon={Globe} title="No zones on this account" description="Add a domain to this Cloudflare account, or check that the token can read zones." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            {!zoneId ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Select a zone to list its records.</p>
            ) : recordsError ? (
              <div className="p-4"><ProviderLoadError what="records" message={recordsError} onRetry={() => void recordsQuery.refetch()} retrying={recordsQuery.isRefetching} /></div>
            ) : recordsQuery.isLoading ? (
              <div className="space-y-2 p-4" role="status" aria-label="Loading records">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            ) : records.length === 0 ? (
              filtered ? (
                <FilteredEmptyState label="No records match these filters." onClear={() => { setFilters({ type: undefined, q: undefined, page: 1 }); }} />
              ) : (
                <div className="p-4"><EmptyState compact icon={Globe} title={`No records in ${zone?.name ?? 'this zone'}`} description="Create the first record, or let a service's domain create it for you." action={{ label: 'New record', onClick: () => { setDialog({ record: null }); } }} /></div>
              )
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead className="w-24">Type</TableHead><TableHead>Content</TableHead>
                    <TableHead className="w-20 text-right">TTL</TableHead><TableHead className="w-28">Proxy</TableHead>
                    <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-mono text-sm">{record.name}</TableCell>
                      <TableCell><Badge variant="outline">{record.type}</Badge></TableCell>
                      <TableCell className="max-w-64 truncate font-mono text-sm" title={record.content}>{record.content}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{record.ttl === 1 ? 'Auto' : record.ttl}</TableCell>
                      <TableCell>{record.proxied ? <Badge variant="secondary">Proxied</Badge> : <span className="text-sm text-muted-foreground">DNS only</span>}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${record.type} record ${record.name}`} onClick={() => { setDialog({ record }); }}><Pencil className="size-4" /></Button>
                          <Button size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive" aria-label={`Delete ${record.type} record ${record.name}`} onClick={() => { setRemoveError(null); setRemoving(record) }}><Trash2 className="size-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
          {zoneId && !recordsError && !recordsQuery.isLoading ? (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-sm text-muted-foreground">{total} record{total !== 1 ? 's' : ''}</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" aria-label="Previous page" disabled={page <= 1} onClick={() => { setFilters({ page: page - 1 }); }}><ChevronLeft className="size-4" /></Button>
                <span className="text-sm tabular-nums text-muted-foreground">{page} / {totalPages}</span>
                <Button size="sm" variant="outline" aria-label="Next page" disabled={page >= totalPages} onClick={() => { setFilters({ page: page + 1 }); }}><ChevronRight className="size-4" /></Button>
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {dialog ? <RecordDialog providerId={providerId} zoneId={zoneId} zoneName={zone?.name} record={dialog.record} onClose={() => { setDialog(null); }} /> : null}
      <RemoveAccountDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        kind={`${removing?.type ?? ''} record`}
        name={removing?.name ?? ''}
        description="This cannot be undone."
        consequences="The record is deleted on Cloudflare immediately. Anything that resolves through it stops working until it is recreated."
        pending={deleteRecord.isPending}
        error={removeError}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  )
}
