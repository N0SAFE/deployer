'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'

export interface UserRef {
  id: string
  name: string
}

/** Ban confirmation. Mounted only while a user is selected, so the fields always start empty. */
export function BanUserDialog({
  user,
  pending,
  onClose,
  onConfirm,
}: {
  user: UserRef
  pending: boolean
  onClose: () => void
  onConfirm: (input: { reason: string | undefined; expiresInSeconds: number | undefined }) => void
}) {
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('')
  const daysNumber = days.trim() === '' ? undefined : Number(days)
  const daysInvalid = daysNumber !== undefined && (!Number.isInteger(daysNumber) || daysNumber < 1)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ban {user.name}?</DialogTitle>
          <DialogDescription>They will be signed out and unable to sign in until the ban expires or you unban them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="banReason">Reason (optional)</Label>
            <Input id="banReason" placeholder="e.g. violation of terms of service" value={reason} onChange={(e) => { setReason(e.target.value) }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="banDuration">Duration in days (optional)</Label>
            <Input id="banDuration" type="number" min="1" placeholder="Permanent" value={days} aria-invalid={daysInvalid ? true : undefined} onChange={(e) => { setDays(e.target.value) }} />
            {daysInvalid ? (
              <p role="alert" className="text-sm text-destructive">Use a whole number of days, or leave empty for a permanent ban.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Leave empty for a permanent ban.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={pending || daysInvalid}
            onClick={() => { onConfirm({ reason: reason.trim() === '' ? undefined : reason.trim(), expiresInSeconds: daysNumber === undefined ? undefined : daysNumber * 86_400 }) }}
          >
            {pending ? 'Banning…' : `Ban ${user.name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveUserDialog({ user, pending, onClose, onConfirm }: { user: UserRef; pending: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {user.name}?</DialogTitle>
          <DialogDescription>
            Their account is deleted permanently and they lose access immediately. This cannot be undone. To only suspend access, ban them instead.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Keep user</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>{pending ? 'Removing…' : `Remove ${user.name}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
