'use client'

import { useParams } from 'next/navigation'
import { PageSkeleton } from '@/components/dashboard'
import { useProject } from '@/domains/project/hooks'
import { ProjectContractsCard } from '../_components/project-contracts-card'
import { InlineError } from '../../_components/workload/WorkloadStates'
import { GeneralConfigCard } from '../../_components/configuration/GeneralConfigCard'
import {
  DeploymentConfigCard,
  NotificationConfigCard,
  ResourceConfigCard,
  SecurityConfigCard,
} from '../../_components/configuration/ProjectConfigSections'

/**
 * Project settings — PROJECT-LEVEL configuration only: identity, deployment
 * defaults, security, resource defaults and notifications. Environments and
 * services have their own pages.
 */
export default function DashboardProjectConfigurationPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const projectQuery = useProject(projectId)

  if (projectQuery.isLoading) return <PageSkeleton blocks={3} withStrip={false} label="Loading project settings" />
  if (projectQuery.error) {
    return <InlineError title="Could not load the project" error={projectQuery.error} onRetry={() => { void projectQuery.refetch() }} />
  }
  const project = projectQuery.data
  if (!project) {
    return <InlineError title="Project not found" error={new Error('The project does not exist or has been deleted.')} />
  }

  return (
    <div className="space-y-6">
      <GeneralConfigCard projectId={projectId} project={project} />
      <DeploymentConfigCard projectId={projectId} />
      <SecurityConfigCard projectId={projectId} />
      <ResourceConfigCard projectId={projectId} />
      <NotificationConfigCard projectId={projectId} />
      <ProjectContractsCard projectId={projectId} />
    </div>
  )
}
