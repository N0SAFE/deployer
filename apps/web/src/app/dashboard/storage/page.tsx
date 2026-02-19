import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import StorageDashboard from '@/components/storage/StorageDashboard'
import { DashboardStorage } from '@/routes'

export default DashboardStorage.Page(async function StoragePage() {
  const queryClient = getQueryClient()

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <StorageDashboard />
    </HydrationBoundary>
  )
})