'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useProject } from '@/domains/project/hooks'
import { useService, useServiceDependencies } from '@/domains/service/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import {
  Siren, ArrowLeft, ArrowRight, Activity, GitBranch,
} from 'lucide-react'
import {
  AuthDashboardProjectsProjectIdServicesServiceId,
  AuthDashboardProjectsProjectIdServicesServiceIdDeployments,
} from '@/routes'
import { StatusBadge, StatusDot } from '@/components/dashboard'
import { EmptyState } from '@/components/dashboard'
import { ENV_NAMES } from '@repo/contracts-common'

/** Known fields we read from the service entity + its effective config. */
interface ServiceFields {
  id: string
  name?: string
  type?: string
  runnerType?: string
  providerId?: string
  status?: string
  state?: string
  description?: string
  isActive?: boolean
  port?: number | null
  enabledEnvironments?: string[]
  effectiveConfig?: {
    port?: number | null
    resourceLimits?: { memory?: string; cpu?: string; storage?: string } | null
    environmentVariables?: Record<string, string> | null
    healthCheck?: { path?: string | null; interval?: number | null; timeout?: number | null; retries?: number | null } | null
    customDomains?: string[] | null
  } | null
  updatedAt?: string
}

interface DepRecord {
  id?: string
  serviceId?: string
  dependsOnServiceId?: string
  name?: string
  type?: string
  isRequired?: boolean
}

interface SubDepsNode {
  serviceId: string
  serviceName?: string
  serviceType?: string
  dependencies?: DepRecord[]
  children?: SubDepsNode[]
}

/**
 * Service Overview — the lean status dashboard.
 *
 * Deliberately minimal: a status band, a sub-service chip row (when this
 * service is a parent), and recent deployments. Everything heavy (replicas,
 * dependency graph, env vars editor, resources) lives in its own tab.
 */
export default function DashboardServiceOverviewPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const { data: projectData, isLoading: projectLoading } = useProject(projectId)
  const { data: serviceData, isLoading: serviceLoading } = useService(serviceId)
  const { data: depsData } = useServiceDependencies(serviceId)
  const { data: deploymentsData, isLoading: deploymentsLoading } = useDeploymentList({
    query: {
      filter: { serviceId: { operator: 'eq' as const, value: serviceId } },
      limit: 5,
      offset: 0,
    },
  })

  // Sub-service detection — a service with a parentId is a sub-service and
  // gets the special sub-service banner.
  const isSubService = Boolean((serviceData as unknown as { parentId?: string | null } | undefined)?.parentId)
  const parentId = (serviceData as unknown as { parentId?: string | null } | undefined)?.parentId ?? undefined
  const { data: parentData } = useService(parentId ?? '')

  // Namespace-aware deps: own edges + sub-service edges (each sub-service is a
  // namespace for everything below it). Only the sub-services matter for the
  // overview chip row; the own-edge list lives in the configuration tab.
  const subServices = useMemo(() => {
    const d = depsData as unknown as
      | { dependencies?: DepRecord[]; subServices?: SubDepsNode[] }
      | DepRecord[]
      | undefined
    if (Array.isArray(d)) return [] as SubDepsNode[]
    return d?.subServices ?? []
  }, [depsData])

  const flatSubServices = useMemo(() => {
    const out: SubDepsNode[] = []
    const walk = (nodes: SubDepsNode[]) => {
      for (const n of nodes) {
        out.push(n)
        walk(n.children ?? [])
      }
    }
    walk(subServices)
    return out
  }, [subServices])

  const recentDeployments = useMemo(() => {
    const d = deploymentsData as unknown as { data?: { id?: string; status?: string; environment?: string; createdAt?: string }[] } | undefined
    return d?.data ?? []
  }, [deploymentsData])

  if (projectLoading || serviceLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (!projectData || !serviceData) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Not found</AlertTitle>
        <AlertDescription>The service or its project does not exist or has been deleted.</AlertDescription>
      </Alert>
    )
  }

  const s = serviceData as ServiceFields
  const enabledEnvs = (s.enabledEnvironments ?? ENV_NAMES) as string[]
  const ec = s.effectiveConfig ?? null
  const parentName = (parentData as unknown as { name?: string } | undefined)?.name
  const serviceStatus = s.status ?? s.state ?? 'unknown'

  return (
    <div className="space-y-6">
      {/* ── Sub-service hero (special view marker) ── */}
      {isSubService && (
        <SubServiceBanner
          parentId={parentId ?? ''}
          parentName={parentName}
          projectId={projectId}
          serviceName={s.name}
        />
      )}

      {/* ── Status band ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="size-4 text-muted-foreground" /> Status
            {isSubService ? <Badge variant="secondary" className="text-[10px]">sub-service</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={serviceStatus} />
            {s.type && <Badge variant="outline">{s.type}</Badge>}
            {s.runnerType && s.runnerType !== s.type && <Badge variant="outline">{s.runnerType}</Badge>}
            {ec?.port ?? s.port ? <Badge variant="outline">port {ec?.port ?? s.port}</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {enabledEnvs.map((env) => (
              <Badge key={env} variant="secondary" className="gap-1 capitalize">{env}</Badge>
            ))}
          </div>
          {ec?.healthCheck?.path ? (
            <p className="text-xs text-muted-foreground">
              Health check: <code className="font-mono">{ec.healthCheck.path}</code> · {ec.healthCheck.interval ?? '—'}s interval · {ec.healthCheck.timeout ?? '—'}s timeout
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No health check configured.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Sub-services chips (only when this service is a parent) ── */}
      {flatSubServices.length > 0 && (
        <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="size-4 text-muted-foreground" /> Sub-services
            </CardTitle>
            <CardDescription className="text-xs">Children of this service — first-class, inherit config unless overridden.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {flatSubServices.map((node) => (
                <AuthDashboardProjectsProjectIdServicesServiceId.Link
                  key={node.serviceId}
                  projectId={projectId}
                  serviceId={node.serviceId}
                >
                  <Badge variant="secondary" className="gap-1 text-[11px]">
                    <GitBranch className="size-3" />
                    {node.serviceName ?? node.serviceId}
                    {node.dependencies && node.dependencies.length > 0 ? ` · ${node.dependencies.length} dep${node.dependencies.length === 1 ? '' : 's'}` : ''}
                  </Badge>
                </AuthDashboardProjectsProjectIdServicesServiceId.Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Recent deployments (activity pulse) ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="text-sm">Recent deployments</CardTitle><CardDescription className="text-xs">Latest activity for this service.</CardDescription></div>
          <Button asChild size="sm" variant="ghost" className="h-7 gap-1 text-[11px]">
            <AuthDashboardProjectsProjectIdServicesServiceIdDeployments.Link projectId={projectId} serviceId={serviceId}>
              View all <ArrowRight className="size-3" />
            </AuthDashboardProjectsProjectIdServicesServiceIdDeployments.Link>
          </Button>
        </CardHeader>
        <CardContent>
          {deploymentsLoading ? (
            <div className="space-y-1.5">
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ) : recentDeployments.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No deployments yet"
              description="Deployments appear here when you push code or trigger a build."
              compact
            />
          ) : (
            <div className="space-y-1.5">
              {recentDeployments.map((dep, i) => (
                <div key={dep.id ?? i} className="flex items-center gap-2.5 rounded-md border bg-background/40 px-3 py-2 text-xs">
                  <StatusDot status={dep.status ?? 'unknown'} />
                  <StatusBadge status={dep.status ?? 'unknown'} className="text-[10px]" />
                  <Badge variant="outline" className="capitalize text-[10px]">{dep.environment ?? 'production'}</Badge>
                  <span className="ml-auto text-muted-foreground tabular-nums">
                    {dep.createdAt ? new Date(dep.createdAt).toLocaleString() : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Sub-service hero banner — the "special view" marker for sub-services.
 */
function SubServiceBanner({
  parentId,
  parentName,
  projectId,
  serviceName,
}: {
  parentId: string
  parentName?: string
  projectId: string
  serviceName?: string
}) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/6 p-4 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary" className="gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          <GitBranch className="size-3" />
          Sub-service
        </Badge>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{serviceName ?? 'This service'}</span>{' '}
          is a sub-service — it inherits its parent&apos;s configuration (environment variables,
          resources, health check) unless overridden here.
        </p>
        {parentId ? (
          <AuthDashboardProjectsProjectIdServicesServiceId.Link
            projectId={projectId}
            serviceId={parentId}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            Parent: {parentName ?? 'service'}
          </AuthDashboardProjectsProjectIdServicesServiceId.Link>
        ) : null}
      </div>
    </div>
  )
}

