'use client'

import { Fingerprint } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'

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
      <CardContent>
        <Button variant="outline" onClick={() => void verify()} disabled={verifying}>
          {verifying ? 'Waiting for your passkey…' : 'Verify with a passkey'}
        </Button>
      </CardContent>
    </Card>
  )
}
