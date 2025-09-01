'use client'

import OrchestrationDashboard from '@/components/orchestration/OrchestrationDashboard'

export default function OrchestrationPage() {
  // For now, we'll use a default project ID
  // In the future, this could come from user context or URL params
  const projectId = 'default'

  return <OrchestrationDashboard projectId={projectId} />
}