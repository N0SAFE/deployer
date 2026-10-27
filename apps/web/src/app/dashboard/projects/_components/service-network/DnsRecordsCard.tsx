'use client'

import { Globe } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { getErrorMessage, isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import { useProvisionServiceDnsRecord } from '@/domains/service/hooks'
import { ProvisionRecordDialog } from './ProvisionRecordDialog'

export interface DnsRecordRow {
  id: string
  name: string
  type: string
  content: string
  ttl: number
  proxied: boolean
}

/** Live zone records, plus the provision dialog once a zone is chosen. */
export function DnsRecordsCard({
  serviceId,
  zoneId,
  zoneName,
  records,
}: {
  serviceId: string
  zoneId: string
  zoneName: string
  records: readonly DnsRecordRow[]
}) {
  const provision = useProvisionServiceDnsRecord()
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm"><Globe className="size-4 text-muted-foreground" /> DNS records</CardTitle>
          <CardDescription>{zoneName ? `Live records in zone ${zoneName}.` : 'Select a zone above to see its DNS records.'}</CardDescription>
        </div>
        {zoneId ? (
          <ProvisionRecordDialog
            zoneName={zoneName}
            pending={provision.isPending}
            onProvision={async (payload) => {
              try {
                const res = await provision.mutateAsync({ params: { id: serviceId }, body: payload })
                toast.success(res.message)
                return true
              } catch (err) {
                toast.error('Failed to provision record', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
                return false
              }
            }}
          />
        ) : null}
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {zoneId
              ? 'No records found in this zone, or the provider is unreachable. Check the provider account under Network → DNS.'
              : 'No zone resolved yet. Pick a provider and zone above (or set them on the project) to see records.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead className="text-right">TTL</TableHead>
                  <TableHead>Proxy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.name}</TableCell>
                    <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-sm text-muted-foreground" title={r.content}>{r.content}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{r.ttl}</TableCell>
                    <TableCell>{r.proxied ? <Badge variant="secondary">proxied</Badge> : <Badge variant="outline">DNS only</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
