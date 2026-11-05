'use client'

import { LogOut } from 'lucide-react'

import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@deployer/ui/components/shadcn/dialog'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'

import { useRevokeUserSession, useUserSessions } from '@/domains/admin/hooks'

/**
 * Where an account is signed in (`session:list`), and the one-session revoke (`session:revoke`).
 *
 * Revoking needs a passkey proof — it may be the session an intruder is using, and the point is to end it NOW. The list
 * carries no token: a row describes the credential, it is not it.
 */
export function SessionsDialog({
    user,
    onClose,
}: {
    user: { id: string; name: string }
    onClose: () => void
}) {
    const query = useUserSessions(user.id)
    const revoke = useRevokeUserSession()
    const sessions = query.data?.data ?? []

    const end = (sessionId: string) => {
        revoke.mutate(
            { userId: user.id, sessionId },
            {
                onSuccess: () => {
                    void query.refetch()
                },
            }
        )
    }

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) onClose()
            }}
        >
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Sessions of {user.name}</DialogTitle>
                    <DialogDescription>
                        Every browser and device holding a live session for this
                        account, newest first. Revoking one signs that device
                        out immediately and needs a passkey tap.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2 py-2">
                    {query.isLoading ? (
                        Array.from({ length: 3 }, (_, index) => (
                            <Skeleton key={index} className="h-14 w-full" />
                        ))
                    ) : sessions.length === 0 ? (
                        <p className="text-muted-foreground py-6 text-center text-sm">
                            No live sessions.
                        </p>
                    ) : (
                        sessions.map((session) => (
                            <div
                                key={session.id}
                                className="flex items-center justify-between gap-3 rounded-lg border p-3"
                            >
                                <div className="min-w-0 space-y-1 text-sm">
                                    <p className="flex flex-wrap items-center gap-2">
                                        <span>
                                            {new Date(
                                                String(session.createdAt)
                                            ).toLocaleString()}
                                        </span>
                                        {session.impersonatedBy ===
                                        null ? null : (
                                            <Badge variant="secondary">
                                                impersonation
                                            </Badge>
                                        )}
                                    </p>
                                    <p className="text-muted-foreground truncate text-xs">
                                        {session.ipAddress ?? 'unknown address'}{' '}
                                        ·{' '}
                                        {session.userAgent ?? 'unknown client'}
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        expires{' '}
                                        {new Date(
                                            String(session.expiresAt)
                                        ).toLocaleString()}
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={revoke.isPending}
                                    onClick={() => {
                                        end(session.id)
                                    }}
                                >
                                    <LogOut className="size-4" />
                                    Revoke
                                </Button>
                            </div>
                        ))
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
