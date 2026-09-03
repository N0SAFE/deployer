import { AuthDashboardProfile } from '@/routes'
import { ProfileForm } from './profile-form'
import { PageTimingLogger } from '@/lib/timing'
import { PageHeader } from '@/components/dashboard'

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
 */
export default AuthDashboardProfile.SessionRoute(({ session }) => {
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
      
      {/* Timing Logger */}
      <PageTimingLogger pageName="Profile" />
    </div>
  )
})

export const metadata: Metadata = {
    title: "Profile",
    description: "Your profile and preferences",
}
