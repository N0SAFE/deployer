'use client'

import { KeyRound, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import {
    Alert,
    AlertDescription,
    AlertTitle,
} from '@deployer/ui/components/shadcn/alert'
import { Button } from '@deployer/ui/components/shadcn/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'

import { authClient } from '@/lib/auth'
import { AuthSignin } from '@/routes'

/** The reset token, read once from the URL (same reason as the device page: no prerender-time suspension). */
function readToken(): string {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('token') ?? ''
}

/**
 * Set a new password from the emailed link (`AUTH-015`).
 *
 * The token is Better Auth's: single-use and expiring. On success we send the person to sign in rather than minting a
 * session here, so the new password is exercised once on purpose.
 */
export default function ResetPasswordPage() {
    const [token] = React.useState(readToken)
    const [password, setPassword] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [done, setDone] = React.useState(false)

    const submit = async () => {
        setBusy(true)
        try {
            const result = await authClient.resetPassword({
                newPassword: password,
                token,
            })
            if (result.error) {
                toast.error(
                    result.error.message ?? 'The link is invalid or expired'
                )
                return
            }
            setDone(true)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex min-h-dvh items-center justify-center p-6">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <KeyRound className="size-5" />
                        Choose a new password
                    </CardTitle>
                    <CardDescription>
                        The link came from your email; it works once and
                        expires.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {token === '' ? (
                        <Alert variant="destructive">
                            <TriangleAlert className="size-4" />
                            <AlertTitle>This link is incomplete</AlertTitle>
                            <AlertDescription>
                                Open the link from the message again, or request
                                a new one.
                            </AlertDescription>
                        </Alert>
                    ) : done ? (
                        <Alert>
                            <KeyRound className="size-4" />
                            <AlertTitle>Password changed</AlertTitle>
                            <AlertDescription>
                                <AuthSignin.Link>Sign in</AuthSignin.Link> with
                                the new password.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="new-password">
                                    New password
                                </Label>
                                <Input
                                    id="new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={password}
                                    aria-invalid={
                                        password.length > 0 &&
                                        password.length < 8
                                            ? true
                                            : undefined
                                    }
                                    onChange={(event) => {
                                        setPassword(event.target.value)
                                    }}
                                />
                                <p className="text-muted-foreground text-xs">
                                    At least eight characters.
                                </p>
                            </div>
                            <Button
                                className="w-full"
                                disabled={busy || password.length < 8}
                                onClick={() => void submit()}
                            >
                                {busy ? 'Saving…' : 'Set the password'}
                            </Button>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
