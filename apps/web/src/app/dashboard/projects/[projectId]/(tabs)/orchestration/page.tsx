'use client'

import OrchestrationDashboard from '@/components/orchestration/OrchestrationDashboard'
import { useParams } from '@/routes/hooks'
import { DashboardProjectsProjectIdTabsOrchestration } from '@/routes/index'

export default function OrchestrationPage() {
    const { projectId } = useParams(DashboardProjectsProjectIdTabsOrchestration)
    return <OrchestrationDashboard projectId={projectId} />
}
