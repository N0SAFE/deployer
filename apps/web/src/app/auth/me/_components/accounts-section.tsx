'use client'

/**
 * "Accounts in this browser" — the multi-session surface of the account page.
 *
 * Presentation only: the list, the mutations, and the reload-after-switch rule
 * live in `_hooks/use-device-accounts`. This file renders them and owns the
 * confirmation dialog, which is pure view state.
 */

import * as React from 'react'
import {
    AlertCircle,
    ArrowLeftRight,
    LogOut,
    RefreshCw,
    UserPlus,
    Users,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@repo/ui/components/shadcn/avatar'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button, buttonVariants } from '@repo/ui/components/shadcn/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Spinner } from '@repo/ui/components/atomics/atoms/Icon'
import { AuthMe, AuthSignin } from '@/routes'
import { useSession } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useDeviceAccounts } from '../_hooks/use-device-accounts'
import type { DeviceAccount } from '../_models/device-account.types'
import { getInitials } from '../_utils/initials'

export function AccountsSection() {
    const { data: session } = useSession()
    const {
        accounts,
        isLoading,
        error,
        pendingToken,
        activeSessionToken,
        switchAccount,
        removeAccount,
        reload,
    } = useDeviceAccounts()

    const [accountToSignOut, setAccountToSignOut] =
        React.useState<DeviceAccount | null>(null)
    const isBusy = pendingToken !== null

    const confirmSignOut = React.useCallback(async () => {
        if (!accountToSignOut) {
            return
        }
        await removeAccount(accountToSignOut.session.token)
        setAccountToSignOut(null)
    }, [accountToSignOut, removeAccount])

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <ArrowLeftRight className="h-5 w-5" />
                            Accounts in this browser
                        </CardTitle>
                        <CardDescription>
                            Switch accounts without signing out of the others.
                        </CardDescription>
                    </div>
                    <AuthSignin.Link
                        search={{ redirectTo: AuthMe() }}
                        className={buttonVariants({
                            variant: 'outline',
                            size: 'sm',
                        })}
                    >
                        <UserPlus />
                        Add account
                    </AuthSignin.Link>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {error && (
                    <div
                        role="alert"
                        className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                    >
                        <p className="text-destructive flex items-center gap-2 text-sm">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            {error}
                        </p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void reload()}
                        >
                            <RefreshCw />
                            Try again
                        </Button>
                    </div>
                )}

                {isLoading ? (
                    <div role="status" aria-live="polite" className="space-y-3">
                        <span className="sr-only">
                            Loading the accounts open in this browser
                        </span>
                        <Skeleton className="h-18 w-full rounded-lg" />
                        <Skeleton className="h-18 w-full rounded-lg" />
                    </div>
                ) : accounts.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center">
                        <Users className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
                        <p className="text-sm font-medium">
                            {session?.user.email
                                ? `Only ${session.user.email} is open in this browser.`
                                : 'Only this account is open in this browser.'}
                        </p>
                        <p className="text-muted-foreground mt-1 text-sm">
                            Add another account to switch between them without
                            signing in again.
                        </p>
                    </div>
                ) : (
                    <ul className="space-y-3">
                        {accounts.map((account) => {
                            const isActive =
                                account.session.token === activeSessionToken
                            const isPending =
                                pendingToken === account.session.token

                            return (
                                <li
                                    key={account.session.id}
                                    className="relative flex flex-wrap items-center gap-4 rounded-lg border p-4 pl-5"
                                >
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            'absolute inset-y-3 left-0 w-0.5 rounded-full',
                                            isActive
                                                ? 'bg-primary'
                                                : 'bg-border'
                                        )}
                                    />
                                    <Avatar size="lg">
                                        <AvatarFallback>
                                            {getInitials(
                                                account.user.name,
                                                account.user.email
                                            )}
                                        </AvatarFallback>
                                    </Avatar>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="truncate font-medium">
                                                {account.user.name}
                                            </p>
                                            {isActive && <Badge>Active</Badge>}
                                        </div>
                                        <p className="text-muted-foreground truncate text-sm">
                                            {account.user.email}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {!isActive && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={isBusy}
                                                aria-label={`Switch to ${account.user.email}`}
                                                onClick={() =>
                                                    void switchAccount(
                                                        account.session.token
                                                    )
                                                }
                                            >
                                                {isPending ? (
                                                    <>
                                                        <Spinner />
                                                        Switching…
                                                    </>
                                                ) : (
                                                    <>
                                                        <ArrowLeftRight />
                                                        Switch
                                                    </>
                                                )}
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isBusy}
                                            className="text-muted-foreground hover:text-destructive"
                                            aria-label={`Sign out of ${account.user.email}`}
                                            onClick={() => {
                                                setAccountToSignOut(account)
                                            }}
                                        >
                                            <LogOut />
                                        </Button>
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                )}

                <p className="text-muted-foreground text-xs">
                    Accounts you add stay signed in here until you sign out of
                    them.
                </p>
            </CardContent>

            <Dialog
                open={accountToSignOut !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setAccountToSignOut(null)
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Sign out of this account</DialogTitle>
                        <DialogDescription>
                            {accountToSignOut?.session.token ===
                            activeSessionToken
                                ? "This is the account you're using now. You'll switch to another signed-in account, or be signed out of this browser if there are none left."
                                : `You'll need to sign in again to use ${accountToSignOut?.user.email ?? 'this account'} in this browser. Your other accounts stay signed in.`}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setAccountToSignOut(null)
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={isBusy}
                            onClick={() => void confirmSignOut()}
                        >
                            <LogOut />
                            Sign out
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
