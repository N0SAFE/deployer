'use client'

import { Fingerprint } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'

import { useStepUpStatus } from '@/domains/account/hooks'
import { authClient } from '@/lib/auth'

/**
 * "Confirm it's you" (`AUTH-062`).
 *
 * Destructive actions (granting a role, banning an account, impersonating) ask for a passkey proof inside the last
 * five minutes. The passkey ceremony is Better Auth's; the API records the proof against the session the ceremony
 * minted, which is why this reloads afterwards instead of patching state.
 */
export function StepUpCard() {
  const [verifying, setVerifying] = useState(false)
  const status = useStepUpStatus()
  const open = status.data?.critical === true
  const expiresAt = status.data?.expiresAt
  // The contract types these as `Date`, but the value crossed HTTP as JSON: normalise before formatting so the card
  // works with both the server's Date and the browser's string.
  const expiresLabel =
    expiresAt === null || expiresAt === undefined ? null : new Date(String(expiresAt)).toLocaleTimeString()

  const verify = async () => {
    setVerifying(true)
    try {
      const result = await authClient.signIn.passkey()
      if (result.error) {
        toast.error(result.error.message ?? 'The passkey ceremony did not complete')
        return
      }
      toast.success('Confirmed. Critical actions are unlocked for five minutes.')
      window.location.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The passkey ceremony did not complete')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="size-4" />
          Confirm it&apos;s you
        </CardTitle>
        <CardDescription>
          Critical actions — changing someone&apos;s role, banning an account, impersonating a user — require a passkey
          tap within the last five minutes. A TOTP code is not enough: it can be phished in real time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          {status.isLoading ? (
            <span className="text-muted-foreground">Checking this session…</span>
          ) : open && expiresLabel !== null ? (
            <span className="text-emerald-600">
              Verified — critical actions are unlocked until {expiresLabel}.
            </span>
          ) : status.data?.steppedUp === true ? (
            <span className="text-amber-600">
              A TOTP code was used. That is not phishing-resistant, so critical actions still need a passkey.
            </span>
          ) : (
            <span className="text-muted-foreground">Not verified in the last five minutes.</span>
          )}
        </p>
        <Button variant="outline" onClick={() => void verify()} disabled={verifying}>
          {verifying ? 'Waiting for your passkey…' : open ? 'Verify again' : 'Verify with a passkey'}
        </Button>
      </CardContent>
    </Card>
  )
}
