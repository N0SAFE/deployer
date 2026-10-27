'use client'

import { Network, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { CopyableMono } from '../../_components/copy-button'
import { nextStep, ReachabilityBadge, VerificationBadge } from './domain-status'
import { METHOD_LABELS, verificationRecordName, type DomainRow, type ReachabilityState } from './domain-types'

export function DomainsTable({
  domains,
  reachability,
  verifyPending,
  checkPending,
  onVerify,
  onInspect,
  onRecheck,
  onRemove,
}: {
  domains: readonly DomainRow[]
  reachability: Record<string, ReachabilityState>
  verifyPending: boolean
  checkPending: boolean
  onVerify: (domain: DomainRow) => void
  onInspect: (domain: DomainRow) => void
  onRecheck: (domain: DomainRow) => void
  onRemove: (domain: DomainRow) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project domains</CardTitle>
        <CardDescription>
          {domains.length} domain{domains.length === 1 ? '' : 's'}. Ownership is proven with a DNS record; reachability
          (does it resolve to this stack and answer over HTTP) is re-checked on load.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead>Ownership</TableHead>
              <TableHead>Reachability</TableHead>
              <TableHead>Next step</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.map((row) => {
              const state = reachability[row.id]
              const pendingRecord = row.verificationStatus !== 'verified' && row.verificationToken !== ''
              return (
                <TableRow key={row.id}>
                  <TableCell className="align-top font-medium">{row.domain}</TableCell>
                  <TableCell className="align-top">
                    <VerificationBadge status={row.verificationStatus} />
                  </TableCell>
                  <TableCell className="align-top"><ReachabilityBadge state={state} /></TableCell>
                  <TableCell className="max-w-sm align-top">
                    <p className="text-sm text-muted-foreground">{nextStep(row.verificationStatus, state)}</p>
                    {pendingRecord ? (
                      <dl className="mt-2 space-y-1 text-xs">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <dt className="text-muted-foreground">{METHOD_LABELS[row.verificationMethod] ?? row.verificationMethod} name</dt>
                          <dd><CopyableMono value={verificationRecordName(row.domain, row.verificationMethod)} /></dd>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2">
                          <dt className="text-muted-foreground">value</dt>
                          <dd><CopyableMono value={row.verificationToken} /></dd>
                        </div>
                      </dl>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap justify-end gap-1">
                      {row.verificationStatus !== 'verified' ? (
                        <Button variant="outline" size="sm" onClick={() => { onVerify(row) }} disabled={verifyPending}>
                          <RefreshCw className="size-3.5" />Verify
                        </Button>
                      ) : null}
                      <Button variant="outline" size="sm" onClick={() => { onInspect(row) }} disabled={checkPending}>
                        <Network className="size-3.5" />DNS check
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Re-check reachability of ${row.domain}`} title="Re-check reachability" onClick={() => { onRecheck(row) }}>
                        <RefreshCw className={state?.loading === true ? 'size-3.5 animate-spin motion-reduce:animate-none' : 'size-3.5'} />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Remove ${row.domain}`} onClick={() => { onRemove(row) }}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
