'use client'

import { Download, RefreshCw, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@deployer/ui/components/shadcn/select'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@deployer/ui/components/shadcn/table'


import { PageErrorState, PageHeader } from '@/components/dashboard'
import { useAuditEvents, useAuditExport } from '@/domains/audit/hooks'
import { useCan } from '@/lib/access/permissions'
import { getErrorMessage } from '@/lib/orpc/typed-errors'

const LIMITS = [50, 100, 200] as const

/** Hand a CSV string to the browser as a download. */
function downloadCsv(csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Settings → Audit log.
 *
 * `audit:read` is the same capability the API checks, so a custom role that holds it can open the page. The rows name
 * actors and targets, which is why the API gates the read at all.
 */
export default function SettingsAuditPage() {
  const canRead = useCan('audit:read')
  const canExport = useCan('audit:export')
  const [action, setAction] = useState('')
  const [actorId, setActorId] = useState('')
  const [limit, setLimit] = useState<number>(50)

  const query = useAuditEvents({ action, actorId, limit }, { enabled: canRead })
  const exportAudit = useAuditExport()
  const rows = useMemo(() => query.data?.data ?? [], [query.data])

  if (!canRead) {
    return (
      <Alert>
        <ShieldAlert className="size-4" />
        <AlertTitle>Not for this account</AlertTitle>
        <AlertDescription>
          Reading the audit log needs the <code>audit:read</code> capability.
        </AlertDescription>
      </Alert>
    )
  }

  const download = async () => {
    try {
      const result = await exportAudit.mutateAsync({ query: { action, actorId, limit: 5000 } })
      downloadCsv(result.csv)
      if (result.truncated) {
        toast.warning(`Exported ${String(result.rows)} rows — the 5000-row cap applied. Narrow the filters for the rest.`)
      }
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Audit log"
        description="Every authentication and administration action the platform recorded: who did it, to whom, from where. Newest first."
        badge={query.data === undefined ? undefined : <Badge variant="secondary">{query.data.meta.hasMore ? `${String(limit)}+` : String(rows.length)}</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Matching is exact. Leave a field empty to include every value; the last {limit} events are returned.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-sm font-medium" htmlFor="audit-action">
              Action
            </label>
            <Input
              id="audit-action"
              placeholder="user.setRole"
              value={action}
              onChange={(event) => { setAction(event.target.value) }}
            />
          </div>
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-sm font-medium" htmlFor="audit-actor">
              Actor id
            </label>
            <Input id="audit-actor" value={actorId} onChange={(event) => { setActorId(event.target.value) }} />
          </div>
          <div className="w-32">
            <label className="mb-1 block text-sm font-medium" htmlFor="audit-limit">
              Limit
            </label>
            <Select value={String(limit)} onValueChange={(value) => { setLimit(Number(value)) }}>
              <SelectTrigger id="audit-limit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMITS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={query.isFetching ? 'size-4 animate-spin' : 'size-4'} />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => void download()} disabled={exportAudit.isPending || !canExport}>
            <Download className="size-4" />
            Export all matching
          </Button>
        </CardContent>
      </Card>

      {query.isError ? (
        <PageErrorState title="Could not read the audit log" message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <Card>
          <CardContent className="p-0">
            {query.isLoading ? (
              <div className="space-y-2 p-6">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-sm">{row.createdAt.toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{row.action}</TableCell>
                      <TableCell className="font-mono text-xs">{row.actorId ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.targetId ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.ip ?? '—'}</TableCell>
                      <TableCell className="max-w-72 truncate font-mono text-xs" title={JSON.stringify(row.detail)}>
                        {Object.keys(row.detail).length === 0 ? '—' : JSON.stringify(row.detail)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                        No events match these filters.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {query.data?.meta.hasMore === true ? (
        <p className="text-sm text-muted-foreground">
          Older events exist. Narrow the filters or raise the limit to reach them.
        </p>
      ) : null}
    </div>
  )
}
