import { AuthDashboardProfile } from '@/routes'
import { ProfileForm } from './profile-form'
import { PageTimingLogger } from '@/lib/timing'
import { PageHeader } from '@/components/dashboard'
import {
  ActiveSessionsCard,
  ApiKeysCard,
  ConnectedAccountsCard,
  PasskeysCard,
  SecurityPostureCard,
} from '@/components/account/security-cards'

import type { Metadata } from 'next'
/**
 * Profile Page using SessionRoute pattern
 * 
 * Uses AuthDashboardProfile.SessionRoute to:
 * 1. Fetch session ONCE on the server
 * 2. Pass it as a prop AND hydrate to React Query cache
 * 3. ProfileForm client component reads from cache instantly
 * 
 * No loading states needed - session data is immediately available.
 *
 * Beyond the profile form, this page is the account's security surface: the
 * cards below surface what each Better Auth plugin knows about this user —
 * passkeys, devices with access, API keys and linked providers. They read
 * through `@/domains/account/hooks` so no plugin's transport leaks here.
 */
export default AuthDashboardProfile.SessionRoute(({ session }) => {
  // Declared on the user by the two-factor plugin (see the auth factory's
  // additionalFields). Absent means "not enrolled".
  const twoFactorEnabled = Boolean(
    (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Manage your account settings and profile information."
      />

      {/* Profile form - client component for interactivity */}
      <ProfileForm initialSession={session} />

      {/* Security posture at a glance, before the detail cards */}
      <SecurityPostureCard enabled={twoFactorEnabled} />

      <PasskeysCard />

      <ActiveSessionsCard />

      <ApiKeysCard />

      <ConnectedAccountsCard />

      {/* Timing Logger */}
      <PageTimingLogger pageName="Profile" />
    </div>
  )
})

export const metadata: Metadata = {
    title: "Profile",
    description: "Your profile and preferences",
}
