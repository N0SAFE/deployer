import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import AnalyticsDashboardClient from '@/components/analytics/AnalyticsDashboardClient'
import { DashboardAnalytics } from '@/routes'

export default DashboardAnalytics.Page(async function AnalyticsPage() {
  const queryClient = getQueryClient()

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AnalyticsDashboardClient />
    </HydrationBoundary>
  )
})