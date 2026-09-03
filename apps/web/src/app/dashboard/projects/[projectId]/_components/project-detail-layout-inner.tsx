'use client'

import { isDefinedORPCError, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useParams } from 'next/navigation'
import { useSelectedLayoutSegment } from 'next/navigation'
import { AuthDashboardProjects, AuthDashboardProjectsProjectIdConfiguration } from '@/routes'
import { useProject } from '@/domains/project/hooks'
import { ProjectSectionNav } from './project-section-nav'
import { ProjectDetailSkeleton } from './project-detail-skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren, ArrowLeft, Settings } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { PageHeader } from '@/components/dashboard'
import type { ReactNode } from 'react'

/**
 * ProjectDetailLayoutInner — client shell for the project detail layout.
 *
 * Reads URL data (useParams/useSelectedLayoutSegment) and project data via
 * React Query. Rendered inside a Suspense boundary in the server layout so
 * the dashboard shell stays in the static shell during prerendering.
 */
export function ProjectDetailLayoutInner({ children }: { children: ReactNode }) {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId
  const segment = useSelectedLayoutSegment()

  const { data: projectData, isLoading, error } = useProject(projectId)

  // Service pages have their OWN shell (ServiceDetailLayout): breadcrumb,
  // service identity, service section nav. The project shell (header + project
  // tabs) is deliberately NOT rendered there so service-page navigation never
  // leaks into project-page tabs.
  if (segment === 'services') {
    return <>{children}</>
  }

  // Determine active tab from URL segment
  const activeSection = segment === undefined || segment === null
    ? 'overview'
    : segment === 'services' ? 'services'
    : segment === 'environments' ? 'environments'
    : segment === 'dependencies' ? 'dependencies'
    : segment === 'deployments' ? 'deployments'
    : segment === 'configuration' ? 'configuration'
    : segment === 'team' ? 'team'
    : segment === 'domains' ? 'domains'
    : 'overview'

  // Loading state
  if (isLoading) {
    return <ProjectDetailSkeleton />
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center p-12">
        <Alert variant="destructive" className="max-w-md">
          <Siren className="size-4" />
          <AlertTitle>Failed to load project</AlertTitle>
          <AlertDescription>
            {isDefinedORPCError(error) ? getErrorMessage(error) : 'An unexpected error occurred. Please try again.'}
          </AlertDescription>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </Alert>
      </div>
    )
  }

  // Not-found state
  if (!projectData) {
    return (
      <div className="flex items-center justify-center p-12">
        <Alert variant="destructive" className="max-w-md">
          <Siren className="size-4" />
          <AlertTitle>Project not found</AlertTitle>
          <AlertDescription>
            The project you are looking for does not exist or has been deleted.
          </AlertDescription>
          <AuthDashboardProjects.Link>
            <Button variant="outline" size="sm" className="mt-4">
              Back to projects
            </Button>
          </AuthDashboardProjects.Link>
        </Alert>
      </div>
    )
  }

  const projectName = projectData.name ?? 'Untitled Project'
  const projectDescription = 'description' in projectData && projectData.description
    ? projectData.description
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-2">
        <AuthDashboardProjects.Link>
          <Button variant="ghost" size="icon" className="mt-0.5 size-8 shrink-0">
            <span className="sr-only">Back to projects</span>
            <ArrowLeft className="size-4" />
          </Button>
        </AuthDashboardProjects.Link>
        <PageHeader
          eyebrow="Project"
          title={projectName}
          description={projectDescription ?? undefined}
          actions={
            <AuthDashboardProjectsProjectIdConfiguration.Link projectId={projectId}>
              <Button variant="outline" size="sm">
                <Settings className="mr-1 size-4" />
                Configuration
              </Button>
            </AuthDashboardProjectsProjectIdConfiguration.Link>
          }
        />
      </div>

      {/* Tab Navigation */}
      <ProjectSectionNav projectId={projectId} active={activeSection} />

      {/* Tab Content */}
      {children}
    </div>
  )
}