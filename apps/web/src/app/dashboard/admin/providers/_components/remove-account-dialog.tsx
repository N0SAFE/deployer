'use client'

import type { ReactNode } from 'react'
import { Siren } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'

/**
 * Confirmation for removing an integration account. Names the object, states the
 * consequence, and — when something blocks the removal — says why instead of
 * offering a button the API will reject.
 */
export function RemoveAccountDialog({
  open,
  onOpenChange,
  kind,
  name,
  description = 'This deletes the stored credentials from this platform. It cannot be undone.',
  consequences,
  blockedReason,
  pending,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** e.g. "GitHub App", "Cloudflare account". */
  kind: string
  name: string
  /** Subtitle under the title; defaults to the credentials wording. */
  description?: ReactNode
  consequences: ReactNode
  blockedReason?: ReactNode
  pending: boolean
  /** The API's own reason when the removal was refused. */
  error?: string | null
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Remove {kind} “{name}”?
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {blockedReason ? (
          <Alert variant="destructive">
            <Siren className="size-4" />
            <AlertTitle>This account cannot be removed right now</AlertTitle>
            <AlertDescription>{blockedReason}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>{consequences}</p>
            {error ? (
              <Alert variant="destructive">
                <Siren className="size-4" />
                <AlertTitle>Removal refused</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); }}>
            {blockedReason ? 'Close' : 'Keep account'}
          </Button>
          {blockedReason ? null : (
            <Button variant="destructive" onClick={onConfirm} disabled={pending}>
              {pending ? 'Removing…' : `Remove ${name}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
