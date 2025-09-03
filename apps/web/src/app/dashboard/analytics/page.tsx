import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import AnalyticsDashboardClient from '@/components/analytics/AnalyticsDashboardClient'

export default async function AnalyticsPage() {
  const startTime = Date.now()
  const queryClient = getQueryClient()
  
  try {
    console.log('🔄 [Analytics] Starting server prefetch...')
    
    // Analytics endpoints may not be fully implemented yet
    // This page will still work with client-side hydration
    // but we can add server prefetching later when analytics endpoints are ready
    
    const endTime = Date.now()
    console.log(`✅ [Analytics] Page loaded in ${endTime - startTime}ms (client-side rendering)`)
    
  } catch (error) {
    const endTime = Date.now()
    console.error(`❌ [Analytics] Error in ${endTime - startTime}ms:`, error)
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AnalyticsDashboardClient />
    </HydrationBoundary>
  )
}