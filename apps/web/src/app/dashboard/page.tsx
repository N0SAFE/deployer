import { AuthDashboard } from '@/routes'
import { DashboardOverviewClient } from './dashboard-client'

import type { Metadata } from 'next'

/**
 * Dashboard overview. The session is fetched once on the server and hydrated
 * to the React Query cache; everything else lives in the client component so
 * all data fetches share one client boundary.
 */
export default AuthDashboard.SessionRoute(({ session }) => {
	return <DashboardOverviewClient operatorName={session?.user.name ?? 'Operator'} />
})

export const metadata: Metadata = {
	title: 'Dashboard',
	description: 'Platform overview at a glance',
}
