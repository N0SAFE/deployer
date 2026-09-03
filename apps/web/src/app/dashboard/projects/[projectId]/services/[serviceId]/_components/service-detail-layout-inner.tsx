'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useParams, useSelectedLayoutSegment } from 'next/navigation'
import { AuthDashboardProjects, AuthDashboardProjectsProjectId, AuthDashboardProjectsProjectIdServicesServiceId } from '@/routes'
import { useProject } from '@/domains/project/hooks'
import { useService, useToggleServiceActive } from '@/domains/service/hooks'
import { ServiceSectionNav } from './service-section-nav'
import { ServiceDetailSkeleton } from './service-detail-skeleton'
import { statusBadgeVariant } from '../../../_utils/helpers'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { ChevronRight, Siren, Home } from 'lucide-react'
import { toast } from 'sonner'
import type { ReactNode } from 'react'

type ServiceSection = 'overview' | 'configuration' | 'deployments' | 'logs' | 'previews' | 'monitoring'

/**
 * ServiceDetailLayoutInner — client shell for the service "namespace".
 *
 * Reads URL data (useParams/useSelectedLayoutSegment) and service data via
 * React Query. Rendered inside a Suspense boundary in the server layout so
 * the dashboard shell stays in the static shell during prerendering.
 */
export function ServiceDetailLayoutInner({ children }: { children: ReactNode }) {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId
  const segment = useSelectedLayoutSegment()

  const { data: projectData, isLoading: projectLoading } = useProject(projectId)
  const { data: serviceData, isLoading: serviceLoading } = useService(serviceId)
  const toggleActive = useToggleServiceActive()

  // Breadcrumb: the service's parent (if any) — sub-services are first-class
  // pages linked to their parent, so show the trail Projects › Project ›
  // Parent › Service. Only fetch the parent when we know its id.
  const parentId = (serviceData as unknown as { parentId?: string | null } | undefined)?.parentId
  const { data: parentData } = useService(parentId ?? '')

  // Active section: 'configuration' wins for all configuration sub-segments
  // (general/provider/network/environment).
  const active: ServiceSection =
    segment === null || segment === undefined || segment === ''
      ? 'overview'
      : segment === 'configuration'
        ? 'configuration'
        : (segment as ServiceSection)

  const isLoading = projectLoading || serviceLoading

  if (isLoading) {
    return <ServiceDetailSkeleton />
  }

  if (!projectData || !serviceData) {
    return (
      <div className="flex items-center justify-center p-12">
        <Alert variant="destructive" className="max-w-md">
          <Siren className="size-4" />
          <AlertTitle>Service not found</AlertTitle>
          <AlertDescription>
            The service or its project does not exist, or you do not have access to it.
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

  const service = serviceData as unknown as {
    id: string
    name?: string
    description?: string | null
    type?: string
    runnerType?: string
    status?: string
    state?: string
    isActive?: boolean
    parentId?: string | null
  }
  const serviceName = service.name ?? 'Unnamed Service'
  const serviceStatus = service.status ?? service.state ?? 'unknown'
  const runnerType = service.runnerType ?? service.type ?? 'application'
  const isActive = service.isActive ?? true
  const isSubService = Boolean(service.parentId)

  const handleToggleActive = async () => {
    try {
      await toggleActive.mutateAsync({ params: { id: serviceId }, body: { isActive: !isActive } })
      toast.success(isActive ? 'Service deactivated' : 'Service activated')
    } catch (err) {
      toast.error('Failed to toggle', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const projectName = (projectData as unknown as { name?: string }).name ?? 'Project'

  return (
    <div className="space-y-6">
      {/* ── Header: breadcrumb + identity + active toggle ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          {/* Breadcrumb trail: Projects › Project › [Parent ›] Service */}
          <nav className="flex items-center gap-1 text-xs text-muted-foreground" aria-label="Breadcrumb">
            <AuthDashboardProjects.Link className="flex items-center gap-1 transition-colors hover:text-foreground">
              <Home className="size-3" />
              Projects
            </AuthDashboardProjects.Link>
            <ChevronRight className="size-3" />
            <AuthDashboardProjectsProjectId.Link projectId={projectId} className="max-w-40 truncate transition-colors hover:text-foreground">
              {projectName}
            </AuthDashboardProjectsProjectId.Link>
            {parentData ? (
              <>
                <ChevronRight className="size-3" />
                <AuthDashboardProjectsProjectIdServicesServiceId.Link
                  projectId={projectId}
                  serviceId={parentData.id}
                  className="max-w-40 truncate transition-colors hover:text-foreground"
                >
                  {(parentData as unknown as { name?: string }).name ?? 'Parent'}
                </AuthDashboardProjectsProjectIdServicesServiceId.Link>
              </>
            ) : null}
            <ChevronRight className="size-3" />
            <span className="max-w-48 truncate font-medium text-foreground">{serviceName}</span>
          </nav>
          <div className={isSubService ? 'rounded-xl border border-amber-500/30 bg-amber-500/6 px-3 py-2' : undefined}>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{serviceName}</h1>
              {isSubService && (
                <Badge variant="secondary" className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  Sub-service
                </Badge>
              )}
              <Badge variant={statusBadgeVariant(serviceStatus) as 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'} className="capitalize">
                {serviceStatus}
              </Badge>
              <Badge variant="outline" className="capitalize">{runnerType}</Badge>
              <Badge variant={isActive ? 'secondary' : 'destructive'}>{isActive ? 'Active' : 'Inactive'}</Badge>
            </div>
            {isSubService ? (
              <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-400/80">
                Inherits configuration from its parent service unless overridden here.
              </p>
            ) : null}
            {service.description ? <p className="mt-1 text-sm text-muted-foreground">{service.description}</p> : null}
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Active
          <Switch checked={isActive} onCheckedChange={() => { void handleToggleActive() }} disabled={toggleActive.isPending} />
        </label>
      </div>

      {/* ── Section navigation ── */}
      <ServiceSectionNav projectId={projectId} serviceId={serviceId} active={active} />

      {/* ── Page content ── */}
      {children}
    </div>
  )
}