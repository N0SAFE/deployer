'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle2, Shield, ShieldAlert, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import { QueryError } from '../../_components/query-error'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { Switch } from '@deployer/ui/components/shadcn/switch'
import { StatStrip, StatStripItem } from '@/components/dashboard'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { useMeshTrustStrictModeSet, useMeshTrustStrictReadiness, useMeshTrustStrictRollback } from '@/domains/mesh/hooks'
import { useHydrated } from '@/lib/use-hydrated'

type Pending = { kind: 'toggle'; enabled: boolean } | { kind: 'rollback' } | null

/** Strict mode: every node must acknowledge a new key before it takes effect. Every change is confirmed. */
export function StrictModeCard() {
  const hydrated = useHydrated()
  const { data: readiness, isLoading: loadingRaw, error: readinessError, refetch: refetchReadiness } = useMeshTrustStrictReadiness()
  const setStrict = useMeshTrustStrictModeSet()
  const rollback = useMeshTrustStrictRollback()
  const [pending, setPending] = useState<Pending>(null)
  const loading = !hydrated || loadingRaw
  const enforced = readiness?.strictEnforced ?? false

  const apply = async () => {
    if (!pending) return
    try {
      if (pending.kind === 'toggle') {
        await setStrict.mutateAsync({ enabled: pending.enabled })
        toast.success(pending.enabled ? 'Strict mode enabled' : 'Strict mode disabled')
      } else {
        await rollback.mutateAsync({ force: false })
        toast.success('Strict mode rollback initiated')
      }
      setPending(null)
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      toast.error(`Failed to update strict mode: ${message}`)
    }
  }

  const busy = setStrict.isPending || rollback.isPending

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-primary" /> Strict mode</CardTitle>
            <CardDescription>
              When on, a new trust key only becomes active after every node has acknowledged it, so no node is left unable to talk to the rest.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {readiness?.rollbackRecommended ? (
              <Badge variant="destructive" className="gap-1"><AlertCircle className="size-3" /> Rollback recommended</Badge>
            ) : null}
            <div className="flex items-center gap-2">
              <span id="mesh-strict-mode-label" className="text-xs text-muted-foreground">Strict mode</span>
              <Switch
                aria-labelledby="mesh-strict-mode-label"
                checked={enforced}
                onCheckedChange={(checked) => { setPending({ kind: 'toggle', enabled: checked }) }}
                disabled={busy || loading}
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : readiness ? (
          <>
            <StatStrip bare>
              <StatStripItem icon={readiness.ready ? CheckCircle2 : XCircle} label="Ready to enforce" value={readiness.ready ? 'Ready' : 'Not ready'} tone={readiness.ready ? 'live' : 'danger'} />
              <StatStripItem
                icon={readiness.converged ? CheckCircle2 : AlertCircle}
                label="Nodes acknowledged"
                value={`${String(Math.round(readiness.ackRatio * 100))}%`}
                hint={`${String(readiness.receivedAcks)}/${String(readiness.expectedAcks)} nodes · min ${String(readiness.minAckRatio * 100)}%`}
                tone={readiness.converged ? 'live' : 'pending'}
              />
              <StatStripItem label="Oldest acknowledgement" value={`${String(readiness.maxAckAgeSeconds)}s`} />
              <StatStripItem label="Active key age" value={readiness.lastRotationAgeSeconds != null ? `${String(Math.round(readiness.lastRotationAgeSeconds / 60))}m` : '—'} />
            </StatStrip>

            {readiness.reasons.length > 0 ? (
              <div className="space-y-2 rounded-lg border bg-card p-3">
                <p className="text-xs font-semibold text-muted-foreground">Why it is {readiness.ready ? 'ready' : 'not ready'}</p>
                <ul className="space-y-1">
                  {readiness.reasons.map((reason) => (
                    <li key={reason} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5">{readiness.ready ? '✓' : '✗'}</span><span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {readiness.rollbackTriggers.length > 0 ? (
              <div className="space-y-2 rounded-lg border bg-red-50 p-3 dark:bg-red-950/20">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="size-4 text-red-500" />
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">Problems detected</p>
                </div>
                <ul className="space-y-1">
                  {readiness.rollbackTriggers.map((trigger) => <li key={trigger} className="text-xs text-red-600 dark:text-red-400">{trigger}</li>)}
                </ul>
                {readiness.rollbackRecommended ? (
                  <Button variant="destructive" size="sm" className="mt-2" onClick={() => { setPending({ kind: 'rollback' }) }} disabled={busy}>
                    Roll back strict mode…
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : readinessError ? (
          <QueryError what="strict-mode readiness" onRetry={() => { void refetchReadiness() }} />
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Shield className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Strict mode data is not available yet.</p>
          </div>
        )}
      </CardContent>

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'rollback' ? 'Roll back strict mode?' : pending?.kind === 'toggle' && pending.enabled ? 'Turn strict mode on?' : 'Turn strict mode off?'}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === 'rollback'
                ? 'Strict mode is switched off and the mesh returns to accepting keys without waiting for every node. Do this if nodes are being cut off.'
                : pending?.kind === 'toggle' && pending.enabled
                  ? 'From now on a new trust key waits for every node to acknowledge it. A node that stays offline will block rotations until it returns.'
                  : 'New trust keys will take effect without waiting for every node. A node that missed the rotation may be unable to talk to its peers until it catches up.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPending(null) }}>Cancel</Button>
            <Button variant={pending?.kind === 'rollback' ? 'destructive' : 'default'} disabled={busy} onClick={() => void apply()}>
              {busy ? 'Applying…' : pending?.kind === 'rollback' ? 'Roll back' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
