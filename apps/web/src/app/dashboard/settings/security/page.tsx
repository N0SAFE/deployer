'use client'

import { ShieldAlert } from 'lucide-react'
import { PageHeader, ScopeLabel } from '@/components/dashboard'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { useIsPlatformAdmin } from '../_components/use-is-admin'
import { StrictModeCard } from './_components/strict-mode-card'
import { TrustKeyringCard } from './_components/trust-keyring-card'

/**
 * Settings → Security. The mesh trust keyring and strict mode. Both are
 * mesh-wide, so they live apart from the per-node configuration.
 */
export default function SettingsSecurityPage() {
  const isAdmin = useIsPlatformAdmin()

  if (!isAdmin) {
    return (
      <Alert>
        <ShieldAlert className="size-4" />
        <AlertTitle>Administrators only</AlertTitle>
        <AlertDescription>Only platform administrators can view or change mesh security settings.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Security"
        badge={<ScopeLabel scope="mesh" />}
        description="How the nodes of your mesh prove they belong together."
      />

      <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
        <p>
          <span className="font-medium">The trust keyring</span> holds the keys nodes use to sign what they send each other. Without a valid key, a machine on your network cannot pretend to be one of your nodes or read mesh traffic. Rotate the key if you suspect it leaked, or on a regular schedule.
        </p>
        <p>
          <span className="font-medium">Strict mode</span> protects against the opposite problem: a rotation that quietly leaves some nodes behind. When on, a new key only takes effect after every node confirms it. The trade-off is that an offline node can delay a rotation.
        </p>
      </div>

      <section className="space-y-3">
        <TrustKeyringCard />
      </section>
      <section className="space-y-3">
        <StrictModeCard />
      </section>
    </div>
  )
}
