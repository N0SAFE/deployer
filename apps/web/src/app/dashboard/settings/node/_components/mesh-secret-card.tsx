'use client'

import { useState } from 'react'
import { Eye, EyeOff, KeyRound, RefreshCw, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import { useMeshNodeConfig, useMeshRegenerateNodeConfigSecret } from '@/domains/mesh/hooks'
import { formatDateTime } from '@/lib/format/date'

/**
 * Danger zone: the mesh shared secret peers present to this node. Regenerating it
 * invalidates every peer service token, so it is confirmed first, and the new value
 * is shown once, masked until the operator reveals it.
 */
export function MeshSecretCard() {
  const { data: nodeConfig } = useMeshNodeConfig()
  const regenerate = useMeshRegenerateNodeConfigSecret()
  const [confirming, setConfirming] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)

  const run = async () => {
    try {
      const result = await regenerate.mutateAsync({})
      setSecret(result.meshSharedSecret)
      setReveal(false)
      setConfirming(false)
      toast.success('Mesh shared secret regenerated')
    } catch (error) {
      const message = isDefinedORPCError(error) ? getErrorMessage(error) : 'Unknown error'
      toast.error(`Failed to regenerate secret: ${message}`)
    }
  }

  const copy = () => {
    if (!secret) return
    void navigator.clipboard.writeText(secret).then(() => { toast.success('Secret copied to clipboard') })
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="size-5 text-destructive" /> Mesh shared secret</CardTitle>
        <CardDescription>
          The secret peers present to prove they may talk to this node. Regenerating it signs every peer out of the mesh: each one must re-enroll before it can talk to this node again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Current status</p>
            {nodeConfig?.meshSharedSecretUpdatedAt ? (
              <>
                <Badge variant="default"><Shield className="mr-1 size-3" /> Secret set</Badge>
                <p className="text-sm text-muted-foreground">Last rotated {formatDateTime(nodeConfig.meshSharedSecretUpdatedAt)}</p>
              </>
            ) : (
              <Badge variant="secondary">No secret configured</Badge>
            )}
          </div>
          <Button variant="destructive" size="sm" className="gap-1" onClick={() => { setConfirming(true) }} disabled={regenerate.isPending}>
            <RefreshCw className="size-3.5" /> Regenerate secret
          </Button>
        </div>

        {secret ? (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">New secret generated</p>
            <p className="text-xs text-amber-700 dark:text-amber-500">Copy it now. It is not shown again once you dismiss this.</p>
            <code className="block break-all rounded bg-amber-100 p-2 font-mono text-xs dark:bg-amber-900/30">
              {reveal ? secret : '•'.repeat(32)}
            </code>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1" onClick={() => { setReveal(!reveal) }}>
                {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {reveal ? 'Hide' : 'Reveal'}
              </Button>
              <Button variant="outline" size="sm" onClick={copy}>Copy</Button>
              <Button variant="ghost" size="sm" onClick={() => { setSecret(null) }}>Dismiss</Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate the mesh shared secret?</DialogTitle>
            <DialogDescription>
              Every existing peer token stops working immediately. Peers must re-enroll with the new secret before they can reach this node again. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirming(false) }}>Cancel</Button>
            <Button variant="destructive" disabled={regenerate.isPending} onClick={() => void run()}>
              {regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
