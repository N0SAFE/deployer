import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import getQueryClient from '@/lib/getQueryClient'
import { createServerORPC } from '@/lib/orpc/server'
import { CICDDashboard } from '@/components/cicd/CICDDashboard'

export default async function CICDPage() {
  const startTime = Date.now()
  const queryClient = getQueryClient()
  const projectId = 'default'
  
  try {
    console.log('🔄 [CICD] Starting server prefetch...')
    
    const orpc = await createServerORPC()
    
    // Prefetch CI/CD data in parallel
    await Promise.all([
      // List pipelines for the project
      queryClient.prefetchQuery(orpc.ciCd.pipeline.listPipelines.queryOptions({ input: { projectId } })),
      
      // List recent builds/runs
      queryClient.prefetchQuery(orpc.ciCd.build.listBuilds.queryOptions({ input: { limit: 20 } })),
      
      // List webhooks for the project
      queryClient.prefetchQuery(orpc.ciCd.webhook.listWebhooks.queryOptions({ input: { limit: 10 } }))
    ])
    
    const endTime = Date.now()
    console.log(`✅ [CICD] Prefetch completed in ${endTime - startTime}ms`)
    
  } catch (error) {
    const endTime = Date.now()
    console.error(`❌ [CICD] Prefetch failed in ${endTime - startTime}ms:`, error)
    // Continue with client-side rendering as fallback
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CICDDashboard projectId={projectId} />
    </HydrationBoundary>
  )
}