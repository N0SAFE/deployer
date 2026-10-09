'use client'

import type { ReactNode } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'

/**
 * Confirmation for destructive Docker actions. Name the object and state the
 * consequence; the confirm button repeats the verb ("Remove volume", not "OK").
 */
export function DockerConfirmDialog({ open, onOpenChange, title, objectName, consequence, confirmLabel, pending = false, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  objectName: string
  consequence: ReactNode
  confirmLabel: string
  pending?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            <code className="font-mono text-foreground">{objectName}</code> — {consequence}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false) }} disabled={pending}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>{pending ? 'Working…' : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
