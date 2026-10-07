'use client'

/**
 * Device authorization approval page.
 *
 * The one page two flows share, because both are the same protocol:
 *
 * 1. **CLI login** (`useDeviceAuthorization`) — the CLI prints a user code and
 *    polls; this page turns that code into a real session.
 * 2. **Agent capability approval** (`agentAuth({ deviceAuthorizationPage })`)
 *    — an agent requests capabilities; this page grants or denies them.
 *
 * The plugin renders neither, which is why this exists. Approval is deliberate:
 * a code alone must not be enough, so the user is shown WHAT is being approved
 * before the request is sent.
 *
 * The code lives in the URL (`?user_code=ABCD-1234`) so a CLI can print a link
 * that pre-fills the field — the user never retypes it.
 */

import * as React from 'react'
import { KeyRound, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { authClient } from '@/lib/auth'

type Outcome =
    | { kind: 'idle' }
    | { kind: 'approved'; detail?: string }
    | { kind: 'denied' }
    | { kind: 'error'; message: string }

/**
 * Read the pre-filled code from the URL.
 *
 * Uses `window.location.search` rather than `useSearchParams()`: the latter
 * reads URL data, which suspends during prerendering in a Client Component and
 * makes Next.js report `CLIENT_HOOK_DYNAMIC` for this route. The code is only
 * ever needed once, to seed `useState`, and this page is interactive from the
 * first client render — so a lazy initializer on the client is equivalent and
 * keeps the route fully static. The same pattern is used by the sign-in form
 * (`app/auth/signin/page.tsx`), which reads the post-sign-in target this way.
 */
function readInitialUserCode(): string {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('user_code') ?? ''
}

/**
 * The form itself.
 */
function DeviceApprovalForm() {
    const [userCode, setUserCode] = React.useState(readInitialUserCode)
    const [busy, setBusy] = React.useState(false)
    const [outcome, setOutcome] = React.useState<Outcome>({ kind: 'idle' })

    const submit = async (approve: boolean) => {
        const code = userCode.trim()
        if (!code) {
            toast.error('Enter the code shown on your device')
            return
        }

        setBusy(true)
        try {
            // `/device/approve` and `/device/deny` are the plugin's own
            // endpoints; a code that is unknown or expired is rejected there.
            const result = approve
                ? await authClient.$fetch<{ detail?: string }>('/device/approve', {
                      method: 'POST',
                      body: { userCode: code },
                  })
                : await authClient.$fetch('/device/deny', {
                      method: 'POST',
                      body: { userCode: code },
                  })

            if (result.error) {
                setOutcome({
                    kind: 'error',
                    message: result.error.message ?? 'The code was rejected',
                })
                return
            }

            setOutcome(
                approve
                    ? { kind: 'approved', detail: (result.data as { detail?: string } | null)?.detail }
                    : { kind: 'denied' },
            )
        } catch (err) {
            setOutcome({
                kind: 'error',
                message: err instanceof Error ? err.message : 'The request failed',
            })
        } finally {
            setBusy(false)
        }
    }

    if (outcome.kind === 'approved') {
        return (
            <Alert>
                <ShieldCheck className="size-4" />
                <AlertTitle>Approved</AlertTitle>
                <AlertDescription>
                    {outcome.detail ??
                        'You can close this page. The device will finish signing in on its own.'}
                </AlertDescription>
            </Alert>
        )
    }

    if (outcome.kind === 'denied') {
        return (
            <Alert>
                <TriangleAlert className="size-4" />
                <AlertTitle>Denied</AlertTitle>
                <AlertDescription>
                    The request was rejected. Nothing was granted.
                </AlertDescription>
            </Alert>
        )
    }

    return (
        <div className="space-y-4">
            {outcome.kind === 'error' && (
                <Alert variant="destructive">
                    <TriangleAlert className="size-4" />
                    <AlertTitle>Could not complete the request</AlertTitle>
                    <AlertDescription>{outcome.message}</AlertDescription>
                </Alert>
            )}

            <div className="space-y-2">
                <Label htmlFor="user-code">Device code</Label>
                <Input
                    id="user-code"
                    value={userCode}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ABCD-1234"
                    className="font-mono tracking-widest uppercase"
                    onChange={(e) => setUserCode(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void submit(true)
                    }}
                />
                <p className="text-muted-foreground text-xs">
                    Shown on the device that requested access.
                </p>
            </div>

            <div className="flex gap-2">
                <Button disabled={busy} onClick={() => void submit(true)}>
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    <span className="ml-2">Approve</span>
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void submit(false)}>
                    Deny
                </Button>
            </div>
        </div>
    )
}

export default function DevicePage() {
    return (
        <div className="flex min-h-dvh items-center justify-center p-6">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <KeyRound className="size-5" />
                        Approve device access
                    </CardTitle>
                    <CardDescription>
                        Confirm the code shown on your device or tool. Approving signs it
                        in as you — only do this if you started the request.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* A user code is short and human-typed; showing the session's
                        identity here is what lets a person notice it is the wrong
                        account before approving. */}
                    <CurrentIdentity />
                    <DeviceApprovalForm />
                </CardContent>
            </Card>
        </div>
    )
}

/** Who this approval would act as. */
function CurrentIdentity() {
    const { data: session, isPending } = authClient.useSession()

    if (isPending) {
        return <Skeleton className="h-10 w-full" />
    }

    if (!session?.user) {
        return (
            <Alert variant="destructive">
                <TriangleAlert className="size-4" />
                <AlertTitle>Not signed in</AlertTitle>
                <AlertDescription>
                    Sign in first, then reopen this page with the device code.
                </AlertDescription>
            </Alert>
        )
    }

    return (
        <div className="bg-muted/40 flex items-center justify-between rounded-lg border px-3 py-2">
            <div className="min-w-0">
                <div className="truncate text-sm font-medium">{session.user.name}</div>
                <div className="text-muted-foreground truncate text-xs">
                    {session.user.email}
                </div>
            </div>
            <Badge variant="outline">acting as</Badge>
        </div>
    )
}
