'use client'

import { Mail } from 'lucide-react'
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
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'

import { authClient } from '@/lib/auth'
import { AuthDashboardSettingsAccount } from '@/routes'

/**
 * Change the account email (`AUTH-015`).
 *
 * Better Auth sends a confirmation to the NEW address (proof of control) and a warning to the old one (the alarm if
 * somebody else started it). The change applies only when the link is followed, so a typo cannot lock anyone out. When
 * the deployment has no mail transport the endpoint is not mounted, and this card would fail loudly rather than pretend.
 */
export function ChangeEmailCard() {
    const [email, setEmail] = useState('')
    const [busy, setBusy] = useState(false)

    const submit = async () => {
        setBusy(true)
        try {
            const result = await authClient.changeEmail({
                newEmail: email.trim(),
                callbackURL: AuthDashboardSettingsAccount(),
            })
            if (result.error) {
                toast.error(
                    result.error.message ?? 'The change could not be requested'
                )
                return
            }
            toast.success(
                `Confirmation sent to ${email.trim()}. The change applies once you follow the link.`
            )
            setEmail('')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Mail className="size-4" />
                    Email address
                </CardTitle>
                <CardDescription>
                    Changing it sends a confirmation to the new address and a
                    warning to the current one. Nothing changes until the link
                    is followed.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                    <Label htmlFor="new-email">New email</Label>
                    <Input
                        id="new-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => {
                            setEmail(event.target.value)
                        }}
                    />
                </div>
                <Button
                    variant="outline"
                    disabled={busy || email.trim() === ''}
                    onClick={() => void submit()}
                >
                    {busy ? 'Sending…' : 'Request change'}
                </Button>
            </CardContent>
        </Card>
    )
}
