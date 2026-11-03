'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@deployer/ui/components/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@deployer/ui/components/shadcn/dialog'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'

import { useRequestApproval } from '@/domains/approvals/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'

/**
 * File the approval a refusal asked for (`SEC-072`).
 *
 * The dialog never invents the digest: it is the one the API echoed, which is what makes the eventual approval cover
 * exactly the action that was refused. The reason is required — it is the whole context the approver gets.
 */
export function RequestApprovalDialog({
  subject,
  permission,
  actionHash,
  scope,
  onClose,
}: {
  subject: string
  permission: string
  actionHash: string
  scope: Record<string, unknown>
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const request = useRequestApproval()
  const trimmed = reason.trim()

  const submit = () => {
    request.mutate(
      { permission, actionHash, scope, reason: trimmed },
      {
        onSuccess: () => {
          toast.success('Request filed. An approver will see it under Settings → Approvals.')
          onClose()
        },
        onError: (error) => {
          toast.error(getErrorMessage(error))
        },
      },
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask for approval</DialogTitle>
          <DialogDescription>
            You cannot do this alone. A second person decides, and their approval covers exactly this action — not a
            similar one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <p>
            <span className="text-muted-foreground">Action: </span>
            <span className="font-mono">{permission}</span> on <span className="font-medium">{subject}</span>
          </p>
          <div className="space-y-2">
            <Label htmlFor="approval-reason">Why</Label>
            <Input
              id="approval-reason"
              placeholder="e.g. duplicate account created by mistake"
              value={reason}
              aria-invalid={trimmed.length > 0 && trimmed.length < 5 ? true : undefined}
              onChange={(event) => { setReason(event.target.value) }}
            />
            <p className="text-muted-foreground text-xs">
              At least five characters. This is what the approver reads before deciding.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={request.isPending || trimmed.length < 5} onClick={submit}>
            {request.isPending ? 'Filing…' : 'File request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
