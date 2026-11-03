'use client'

import { CheckCircle2, KeyRound, Loader2, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'

import { authClient } from '@/lib/auth'
import { AuthDashboard } from '@/routes'

type Phase =
  | { kind: 'checking' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; email: string; role: string }
  | { kind: 'done' }

/** The reason the endpoint gives when it cannot honour an invitation, or a fallback sentence. */
function failureMessage(data: unknown): string {
  return typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string'
    ? data.message
    : 'This invitation is not valid.'
}

/** The invitation token, read once from the URL (same reason as the device page: no prerender-time suspension). */
function readToken(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('token') ?? ''
}

/**
 * Invitation acceptance (`AUTH-010`).
 *
 * The account already exists — `invite.create` provisions it so the invitation names a real user with a real role. This
 * page proves the token, sets the name and password, and signs in. The token is spent by the plugin BEFORE any account
 * write, so a double submit cannot provision twice.
 */
export default function InvitePage() {
  const [token] = React.useState(readToken)
  // A missing token is known before the first paint, so it must not be set from inside the effect (which would be a
  // synchronous setState during render) — it is the initial state instead.
  const [phase, setPhase] = React.useState<Phase>(() =>
    readToken() === '' ? { kind: 'invalid', message: 'This link has no invitation token.' } : { kind: 'checking' },
  )
  const [name, setName] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!token) return
    void authClient.invite
      .check({ token })
      .then((result) => {
        const data = result.data
        // The endpoint answers either the invitation or a reason it cannot be used, so narrow on the field.
        if (result.error || data === null || !data.valid || !('email' in data)) {
          setPhase({ kind: 'invalid', message: failureMessage(data) })
          return
        }
        setPhase({ kind: 'ready', email: data.email, role: data.role })
      })
      .catch((error: unknown) => {
        setPhase({ kind: 'invalid', message: error instanceof Error ? error.message : 'The invitation could not be checked.' })
      })
  }, [token])

  const accept = async () => {
    setBusy(true)
    try {
      const validated = await authClient.invite.validate({ token, password, name })
      if (validated.error) {
        toast.error(validated.error.message ?? 'The invitation could not be accepted')
        return
      }

      if (phase.kind === 'ready') {
        const signedIn = await authClient.signIn.email({ email: phase.email, password })
        if (signedIn.error) {
          // Acceptance succeeded; only the convenience sign-in failed.
          toast.success('Account set up. Sign in with your new password.')
          setPhase({ kind: 'done' })
          return
        }
        window.location.assign(AuthDashboard())
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The invitation could not be accepted')
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
            Accept your invitation
          </CardTitle>
          <CardDescription>Set a password to finish creating your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {phase.kind === 'checking' && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Checking the invitation…
            </p>
          )}

          {phase.kind === 'invalid' && (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertTitle>This invitation cannot be used</AlertTitle>
              <AlertDescription>{phase.message}</AlertDescription>
            </Alert>
          )}

          {phase.kind === 'done' && (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>Account ready</AlertTitle>
              <AlertDescription>Sign in with your email and the password you just set.</AlertDescription>
            </Alert>
          )}

          {phase.kind === 'ready' && (
            <>
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">Email: </span>
                  <span className="font-medium">{phase.email}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Role: </span>
                  <span className="font-medium">{phase.role}</span>
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-name">Your name</Label>
                <Input
                  id="invite-name"
                  value={name}
                  autoComplete="name"
                  onChange={(event) => { setName(event.target.value) }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-password">Password</Label>
                <Input
                  id="invite-password"
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  aria-invalid={password.length > 0 && password.length < 8 ? true : undefined}
                  onChange={(event) => { setPassword(event.target.value) }}
                />
                <p className="text-muted-foreground text-xs">At least eight characters.</p>
              </div>
              <Button
                className="w-full"
                disabled={busy || name.trim() === '' || password.length < 8}
                onClick={() => void accept()}
              >
                {busy ? 'Setting up…' : 'Set up my account'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
