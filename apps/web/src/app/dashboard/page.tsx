import { AuthDashboard } from '@/routes'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { PageHeader } from '@/components/dashboard'
import { DashboardOverviewClient } from './dashboard-client'

import type { Metadata } from 'next'
/**
 * Dashboard Overview Page using SessionRoute pattern
 *
 * Uses AuthDashboard.SessionRoute to:
 * 1. Fetch session ONCE on the server
 * 2. Pass it as a prop to this component
 * 3. Hydrate it to React Query cache
 * 4. Client components read from cache without refetching
 *
 * The page is intentionally thin: the command-center bento (live metrics,
 * recent deployments, quick actions, invitations, organizations) lives in
 * DashboardOverviewClient so all data fetches share one client boundary.
 */
export default AuthDashboard.SessionRoute(({ session }) => {
  // Real role from the session (was hardcoded "member" skeleton) — the
  // platform grants `superAdmin` (bypass) and `admin`; anything else is a
  // regular member. Powers the admin-tools card + "Your role" metric.
  const userRole = session?.user.role ?? 'member'
  const isAdmin = userRole === 'superAdmin' || userRole === 'admin'

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Overview"
        title="Command center"
        description={`Welcome back, ${session?.user.name ?? 'Operator'}. Here's what's happening across your projects.`}
        badge={<Badge variant="outline">v3</Badge>}
      />

      {/* Bento command center — live metrics, deployments, actions (client) */}
      <DashboardOverviewClient isAdmin={isAdmin} userRole={userRole} />
    </div>
  )
})

export const metadata: Metadata = {
    title: "Dashboard",
    description: "Platform overview at a glance",
}
