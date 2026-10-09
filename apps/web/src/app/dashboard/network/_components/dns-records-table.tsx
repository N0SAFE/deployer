'use client'

import { Badge } from '@repo/ui/components/shadcn/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { StatusBadge } from '@/components/dashboard'
import type { IngressState } from '@repo/api-contracts/modules/reachability/index'
import { Mono } from './network-copy'

const STATUS: Record<IngressState['dns'][number]['status'], string> = {
  synced: 'healthy',
  manual: 'pending',
  error: 'failed',
}

const STATUS_LABEL: Record<IngressState['dns'][number]['status'], string> = {
  synced: 'in sync',
  manual: 'create it yourself',
  error: 'error',
}

/** The record sets the lanes need, and whether each one is converged on its DNS provider. */
export function DnsRecordsTable({ records }: { records: IngressState['dns'] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lane</TableHead>
          <TableHead>Record</TableHead>
          <TableHead>Points to</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record) => (
          <TableRow key={`${record.lane}:${record.name}`}>
            <TableCell>
              <Badge variant="outline">{record.lane}</Badge>
            </TableCell>
            <TableCell>
              <span className="mr-2 text-xs text-muted-foreground">{record.type}</span>
              <Mono>{record.name}</Mono>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {record.contents.map((content) => (
                  <Mono key={content}>{content}</Mono>
                ))}
              </div>
            </TableCell>
            <TableCell className="max-w-md">
              <StatusBadge status={STATUS[record.status]}>{STATUS_LABEL[record.status]}</StatusBadge>
              {record.detail !== null ? <p className="mt-1 text-xs text-muted-foreground">{record.detail}</p> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
