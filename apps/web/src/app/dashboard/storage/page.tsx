import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import StorageDashboard from '@/components/storage/StorageDashboard'
import { DashboardStorage } from '@/routes'

export default DashboardStorage.Page(async function StoragePage() {
  const startTime = Date.now()
  const queryClient = getQueryClient()
  
  console.log('🔄 [Storage] Starting server prefetch...')
  
  // Storage endpoints may not be fully implemented yet
  // This page will still work with client-side hydration
  // but we can add server prefetching later when storage endpoints are ready
  
  const endTime = Date.now()
  console.log(`✅ [Storage] Page loaded in ${endTime - startTime}ms (client-side rendering)`)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <StorageDashboard />
    </HydrationBoundary>
  )
})