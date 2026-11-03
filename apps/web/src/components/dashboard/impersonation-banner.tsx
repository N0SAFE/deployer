'use client'

import { ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@deployer/ui/components/shadcn/button'

import { authClient, useSession } from '@/lib/auth'

/**
 * "You are acting as someone else" (`AUTH-067`).
 *
 * The server already refuses writes from an impersonated session; the banner is what keeps the operator from mistaking
 * the target's view for their own. It is mounted in the dashboard layout so no page can forget it.
 */
export function ImpersonationBanner() {
  const { data: session } = useSession()
  const [stopping, setStopping] = useState(false)

  const impersonatedBy = session?.session.impersonatedBy
  if (session === null || impersonatedBy === null || impersonatedBy === undefined) return null
  const label = session.user.email

  const stop = async () => {
    setStopping(true)
    try {
      await authClient.stopImpersonating({})
      // The cookie now belongs to the admin again; a reload re-reads identity everywhere instead of patching
      // user-scoped state in place.
      window.location.reload()
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-amber-600" />
        <span>
          You are impersonating <strong>{label}</strong>. This session is read-only
          and expires automatically.
        </span>
      </div>
      <Button size="sm" variant="outline" onClick={() => void stop()} disabled={stopping}>
        <X className="size-4" />
        {stopping ? 'Stopping…' : 'Stop impersonating'}
      </Button>
    </div>
  )
}
