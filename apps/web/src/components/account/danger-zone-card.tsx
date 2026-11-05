'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@deployer/ui/components/shadcn/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@deployer/ui/components/shadcn/card'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@deployer/ui/components/shadcn/dialog'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'

import { useDeleteSelf } from '@/domains/user/hooks'

const CONFIRMATION = 'delete my account'

/**
 * Delete your own account (`AUTH-032`).
 *
 * Two deliberate frictions: the exact phrase (so a mis-click cannot do it) and the server's passkey step-up (so a
 * walked-away tab cannot). The last super admin is refused server-side — deleting the only account able to grant roles
 * back is a lockout, not a lifecycle action.
 */
export function DangerZoneCard() {
    const [open, setOpen] = useState(false)
    const [confirmation, setConfirmation] = useState('')
    const deleteSelf = useDeleteSelf()
    const matches = confirmation.trim().toLowerCase() === CONFIRMATION

    const remove = () => {
        deleteSelf.mutate(
            {},
            {
                onError: (error) => {
                    toast.error(
                        error instanceof Error
                            ? error.message
                            : 'The account could not be deleted'
                    )
                },
            }
        )
    }

    return (
        <Card className="border-destructive/40">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Trash2 className="size-4" />
                    Delete your account
                </CardTitle>
                <CardDescription>
                    The account, its sessions and its API keys are removed
                    immediately and permanently. This cannot be undone.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Dialog
                    open={open}
                    onOpenChange={(next) => {
                        setOpen(next)
                        if (!next) setConfirmation('')
                    }}
                >
                    <DialogTrigger asChild>
                        <Button variant="destructive">Delete my account</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Delete your account?</DialogTitle>
                            <DialogDescription>
                                You will be signed out everywhere. A passkey
                                verification in the last five minutes is
                                required.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2 py-2">
                            <Label htmlFor="delete-confirmation">
                                Type <strong>{CONFIRMATION}</strong> to confirm
                            </Label>
                            <Input
                                id="delete-confirmation"
                                value={confirmation}
                                autoComplete="off"
                                aria-invalid={
                                    confirmation.length > 0 && !matches
                                        ? true
                                        : undefined
                                }
                                onChange={(event) => {
                                    setConfirmation(event.target.value)
                                }}
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setOpen(false)
                                }}
                            >
                                Keep my account
                            </Button>
                            <Button
                                variant="destructive"
                                disabled={!matches || deleteSelf.isPending}
                                onClick={remove}
                            >
                                {deleteSelf.isPending
                                    ? 'Deleting…'
                                    : 'Delete permanently'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    )
}
