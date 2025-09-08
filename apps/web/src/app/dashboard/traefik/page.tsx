import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import TraefikDashboard from '@/components/traefik/TraefikDashboard'
import { DashboardTraefik } from '@/routes/index'

export default DashboardTraefik.Page(async function TraefikPage() {
  const startTime = Date.now()
  const queryClient = getQueryClient()
  
  console.log('🔄 [Traefik] Starting server prefetch...')
  
  // Traefik endpoints may not be fully implemented yet
  // This page will still work with client-side hydration
  // but we can add server prefetching later when traefik endpoints are ready
  
  const endTime = Date.now()
  console.log(`✅ [Traefik] Page loaded in ${endTime - startTime}ms (client-side rendering)`)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TraefikDashboard />
    </HydrationBoundary>
  )
})