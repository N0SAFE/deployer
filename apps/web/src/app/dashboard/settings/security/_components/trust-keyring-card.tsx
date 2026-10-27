'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle2, Copy, Eye, EyeOff, Key, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import {
  useMeshTrustKeyringConvergenceStatus,
  useMeshTrustKeyringRotate,
  useMeshTrustKeyringSecrets,
  useMeshTrustKeyringStatus,
} from '@/domains/mesh/hooks'
import { formatDateTime } from '@/lib/format/date'
import { QueryError } from '../../_components/query-error'

const shortId = (id: string, len = 8) => (id.length > len ? id.slice(0, len) : id)

/** The mesh trust keyring: which keys exist, which is active, whether every node has caught up. */
export function TrustKeyringCard() {
  const [showSecrets, setShowSecrets] = useState(false)
  const [showRotate, setShowRotate] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [keyId, setKeyId] = useState('')
  const [secret, setSecret] = useState('')

  const { data: keyring, isLoading, error: keyringError, refetch: refetchKeyring } = useMeshTrustKeyringStatus()
  // Secrets are only fetched once the operator asks to see them.
  const { data: secrets, isLoading: secretsLoading } = useMeshTrustKeyringSecrets({ enabled: showSecrets })
  const { data: convergence, isLoading: convergenceLoading, error: convergenceError, refetch: refetchConvergence } = useMeshTrustKeyringConvergenceStatus()
  const rotate = useMeshTrustKeyringRotate()

  const runRotate = async () => {
    try {
      await rotate.mutateAsync({ keyId: keyId.trim() || undefined, secretMaterial: secret.trim() || undefined })
      setConfirming(false)
      setShowRotate(false)
      setKeyId('')
      setSecret('')
      toast.success('Trust keyring rotated')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      toast.error(`Failed to rotate key: ${message}`)
    }
  }

  const copyKey = (value: string) => {
    void navigator.clipboard.writeText(value).then(() => { toast.success('Key copied to clipboard') })
  }

  const rows = showSecrets ? (secrets?.keys ?? []) : (keyring?.keys ?? [])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Key className="size-5 text-primary" /> Trust keyring</CardTitle>
            <CardDescription>
              The keys nodes use to sign messages to each other and to check that a peer is genuine. One key is active; older ones are kept so messages in flight still verify.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => { setShowSecrets(!showSecrets) }}>
              {showSecrets ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {showSecrets ? 'Hide secrets' : 'Show secrets'}
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => { setShowRotate(!showRotate) }}>
              <RefreshCw className="size-3.5" /> Rotate key
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {keyringError || convergenceError ? (
          <QueryError what="the trust keyring" onRetry={() => { void refetchKeyring(); void refetchConvergence() }} />
        ) : null}
        {keyringError || convergenceError ? null : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1 rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Active key</p>
            {isLoading ? <Skeleton className="h-5 w-24" /> : <p className="font-mono text-sm">{keyring?.activeKeyId ?? 'No active key'}</p>}
          </div>
          <div className="space-y-1 rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Keys in the keyring</p>
            <p className="text-sm font-semibold">{keyring?.keys.length ?? 0}</p>
          </div>
          <div className="space-y-1 rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">Every node has the new key</p>
            {convergenceLoading ? <Skeleton className="h-5 w-24" /> : (
              <div className="flex items-center gap-2 text-sm">
                {convergence?.converged ? <CheckCircle2 className="size-4 text-green-500" /> : <AlertCircle className="size-4 text-amber-500" />}
                {convergence?.converged ? 'Yes' : 'Not yet'}
                {convergence ? ` (${String(convergence.receivedAcks)}/${String(convergence.expectedAcks)})` : ''}
              </div>
            )}
          </div>
        </div>

        )}

        {showRotate && !keyringError ? (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <div>
              <p className="text-sm font-semibold">Rotate the trust key</p>
              <p className="text-sm text-muted-foreground">Creates a new active key. Leave both fields empty to have one generated.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rotate-key-id" className="text-xs text-muted-foreground">Key ID (optional)</Label>
                <Input id="rotate-key-id" value={keyId} onChange={(e) => { setKeyId(e.target.value) }} placeholder="Auto-generate" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rotate-key-secret" className="text-xs text-muted-foreground">Secret material (optional)</Label>
                <Input id="rotate-key-secret" type="password" autoComplete="off" value={secret} onChange={(e) => { setSecret(e.target.value) }} placeholder="Auto-generate" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { setConfirming(true) }} disabled={rotate.isPending}>Rotate…</Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowRotate(false); setKeyId(''); setSecret('') }}>Cancel</Button>
            </div>
          </div>
        ) : null}

        {keyringError ? null : rows.length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key ID</TableHead>
                  <TableHead>Algorithm</TableHead>
                  <TableHead>Status</TableHead>
                  {showSecrets ? <TableHead>Secret material</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((key) => {
                  const material = 'secretMaterial' in key ? (key as { secretMaterial?: string }).secretMaterial : undefined
                  return (
                    <TableRow key={key.keyId}>
                      <TableCell className="font-mono text-xs">{key.keyId}</TableCell>
                      <TableCell><Badge variant="outline">{key.algorithm}</Badge></TableCell>
                      <TableCell><Badge variant={key.status === 'active' ? 'default' : 'secondary'}>{key.status}</Badge></TableCell>
                      {showSecrets ? (
                        <TableCell className="max-w-56">
                          {secretsLoading ? <Skeleton className="h-4 w-32" /> : material ? (
                            <span className="flex items-center gap-1">
                              <span className="truncate font-mono text-xs">{material}</span>
                              <Button variant="ghost" size="icon" className="size-6 shrink-0" aria-label={`Copy key ${key.keyId}`} onClick={() => { copyKey(material) }}>
                                <Copy className="size-3.5" />
                              </Button>
                            </span>
                          ) : '—'}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : !isLoading ? (
          <p className="text-sm text-muted-foreground">No trust keys yet. Rotate to create the first one.</p>
        ) : null}

        {convergence && !convergence.converged && !convergenceError ? (
          <div className="rounded-lg border bg-amber-50 p-3 dark:bg-amber-950/20">
            <div className="flex items-center gap-2 text-sm">
              <AlertCircle className="size-4 text-amber-500" />
              <span className="font-medium">Waiting for nodes to acknowledge the new key</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {convergence.receivedAcks}/{convergence.expectedAcks} acknowledgements received.
              {convergence.pendingNodeIds.length > 0 ? ` Still waiting on: ${convergence.pendingNodeIds.map((id) => shortId(id)).join(', ')}.` : ''}
            </p>
            {convergence.lastRotatedAt ? <p className="mt-1 text-sm text-muted-foreground">Last rotation: {formatDateTime(convergence.lastRotatedAt)}</p> : null}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate the trust key?</DialogTitle>
            <DialogDescription>
              A new key becomes active and is distributed to every node. With strict mode on, the new key only takes effect once all nodes acknowledge it; a node that is offline will have to catch up.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirming(false) }}>Cancel</Button>
            <Button disabled={rotate.isPending} onClick={() => void runRotate()}>{rotate.isPending ? 'Rotating…' : 'Rotate key'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
