'use client'

import type { ReactNode } from 'react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'

/**
 * Confirmation for destructive actions. Names the object and states the
 * consequence; the confirm button repeats the verb ("Delete environment", not "OK").
 */
export function ConfirmDialog({
  title,
  objectName,
  consequence,
  confirmLabel,
  pending,
  onConfirm,
  onClose,
}: {
  title: string
  objectName: string
  consequence: ReactNode
  confirmLabel: string
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            <strong className="font-mono text-foreground">{objectName}</strong> — {consequence}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
