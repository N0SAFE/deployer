'use client'

import { Siren } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import type { ReachabilityResult } from './domain-types'

export function RemoveDomainDialog({
  domain,
  pending,
  onCancel,
  onConfirm,
}: {
  domain: string | null
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={domain !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {domain}?</DialogTitle>
          <DialogDescription>
            The domain is unlinked from the project and from every service using it; those services stop answering on it.
            The DNS records at your provider are not touched.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? 'Removing…' : 'Remove domain'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DnsCheckDialog({ result, onClose }: { result: ReachabilityResult | null; onClose: () => void }) {
  const summary =
    result === null
      ? ''
      : result.httpReachable
        ? 'Reachable'
        : result.resolvedIps.length > 0
          ? 'DNS resolves, but the stack does not answer'
          : 'Not resolving'
  return (
    <Dialog open={result !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>DNS check: {result?.domain ?? ''}</DialogTitle>
          <DialogDescription>What the domain resolves to and whether it answers over HTTP, seen from this node.</DialogDescription>
        </DialogHeader>
        {result === null ? null : (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2" role="status">
              <Badge variant={result.httpReachable ? 'default' : result.resolvedIps.length > 0 ? 'secondary' : 'destructive'}>
                {summary}
              </Badge>
              {result.httpStatusCode ? <Badge variant="outline">HTTP {result.httpStatusCode}</Badge> : null}
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Resolved addresses</dt>
                <dd className="font-mono text-xs">{result.resolvedIps.join(', ') || 'none'}</dd>
              </div>
              {result.expectedIp ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Expected (this stack’s public address)</dt>
                  <dd className="font-mono text-xs">{result.expectedIp}</dd>
                </div>
              ) : null}
              {result.dnsMatch !== null ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Address match</dt>
                  <dd><Badge variant={result.dnsMatch ? 'default' : 'destructive'}>{result.dnsMatch ? 'Match' : 'Mismatch'}</Badge></dd>
                </div>
              ) : null}
            </dl>
            {result.error ? (
              <Alert variant="destructive">
                <Siren className="size-4" />
                <AlertTitle>The check reported an error</AlertTitle>
                <AlertDescription>{result.error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
