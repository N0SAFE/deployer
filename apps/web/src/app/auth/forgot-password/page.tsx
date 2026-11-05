'use client'

import { KeyRound, MailCheck } from 'lucide-react'
import { useState } from 'react'
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
import { AuthResetPassword, AuthSignin } from '@/routes'

/**
 * Request a password reset (`AUTH-015`).
 *
 * The answer is the same whether or not the address exists — an endpoint that says "no such account" is an account
 * enumerator. Whether a message actually leaves depends on the deployment's transport; this page never claims delivery.
 */
export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('')
    const [sent, setSent] = useState(false)
    const [busy, setBusy] = useState(false)

    const submit = async () => {
        setBusy(true)
        try {
            const result = await authClient.requestPasswordReset({
                email: email.trim(),
                redirectTo: AuthResetPassword(),
            })
            if (result.error) {
                toast.error(
                    result.error.message ?? 'The request could not be sent'
                )
                return
            }
            setSent(true)
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
                        Reset your password
                    </CardTitle>
                    <CardDescription>
                        Enter the address on the account and we will send a link
                        that sets a new password.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {sent ? (
                        <Alert>
                            <MailCheck className="size-4" />
                            <AlertTitle>
                                If that address has an account, a link is on its
                                way
                            </AlertTitle>
                            <AlertDescription>
                                The link expires on its own. Nothing here says
                                whether the address exists.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    autoComplete="email"
                                    value={email}
                                    onChange={(event) => {
                                        setEmail(event.target.value)
                                    }}
                                />
                            </div>
                            <Button
                                className="w-full"
                                disabled={busy || email.trim() === ''}
                                onClick={() => void submit()}
                            >
                                {busy ? 'Sending…' : 'Send the link'}
                            </Button>
                        </>
                    )}
                    <p className="text-muted-foreground text-center text-sm">
                        <AuthSignin.Link>Back to sign in</AuthSignin.Link>
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}
