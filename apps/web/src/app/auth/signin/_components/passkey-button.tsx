'use client'

import * as React from 'react'
import { Fingerprint } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Spinner } from '@deployer/ui/components/atomics/atoms/Icon'
import { authClient } from '@/lib/auth'
import { getPostSignInTarget } from '../_utils/url'

function subscribeNoop(): () => void {
  return () => undefined
}

function readIsLastUsed(method: string): boolean {
  try {
    return authClient.isLastUsedLoginMethod(method)
  } catch {
    // The helper is absent when the plugin is not registered.
    return false
  }
}

/**
 * "Last used" badge, driven by the Last Login Method plugin (a cookie read, no
 * request). Read after mount only: the helper touches `document.cookie`, so
 * reading during render would diverge between server and client HTML.
 */
export function LastUsedBadge({ method }: { method: string }) {
  const isLast = React.useSyncExternalStore(
    subscribeNoop,
    () => readIsLastUsed(method),
    () => false,
  )

  if (!isLast) return null

  return (
    <Badge variant="secondary" className="ml-2 text-xs font-normal">
      last used
    </Badge>
  )
}

/**
 * Passkey sign-in: use this device's fingerprint, face or security key instead
 * of typing a password. Only works for accounts that already registered a
 * passkey (Account settings → Security), and only renders when the passkey
 * client plugin is registered.
 */
export function PasskeySignInButton() {
  const hasPasskeyPlugin = typeof (authClient as { passkey?: unknown }).passkey !== 'undefined'
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (!hasPasskeyPlugin) return null

  const fail = (message: string) => {
    // A cancelled prompt is the common case and needs no alarm.
    if (!/cancel|abort|not allowed/i.test(message)) setError(message)
  }

  const handleClick = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.signIn.passkey({ autoFill: false })
      if (result.error) {
        fail(result.error.message ?? 'Passkey sign-in failed')
        return
      }
      // Full reload: the session cookie changed, so cached user-scoped data is stale.
      window.location.href = getPostSignInTarget()
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Passkey sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full text-base"
        disabled={busy}
        onClick={() => void handleClick()}
      >
        {busy ? <Spinner /> : <Fingerprint className="size-4" aria-hidden />}
        <span className="ml-2">Sign in with a passkey</span>
        <LastUsedBadge method="passkey" />
      </Button>
      <p className="text-muted-foreground text-center text-sm">
        Use this device&apos;s fingerprint, face or security key — no password. Needs a passkey saved in your
        account settings first.
      </p>
      {error ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {error}
        </p>
      ) : null}
    </div>
  )
}
