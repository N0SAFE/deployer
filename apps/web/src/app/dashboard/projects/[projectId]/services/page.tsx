'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useServiceList, useCreateService, useDeleteService } from '@/domains/service/hooks'
import { useAddServiceDomain } from '@/domains/domain/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import type { ServiceCreateInput } from '@repo/api-contracts/modules/service/crud/create'
import { orchestratorRunnerConfigSchema } from '@repo/contracts-entities'
import { ServiceDependencyGraphPanel } from '../../_components/ServiceDependencyGraphPanel'
import { CreateServiceWizard } from '../../_components/CreateServiceWizard'
import { AuthDashboardProjectsProjectIdServicesServiceId } from '@/routes'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Input } from '@repo/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate, shortId } from '../_utils/helpers'
import { StatusBadge } from '@/components/dashboard'
import { filterProjectTopLevelServices } from '@/domains/service/hierarchy'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'

/** A minimal service shape used in this page. */
interface ServiceRow {
  id: string
  name?: string
  type?: string
  runtime?: string
  status?: string
  state?: string
  projectId?: string
  project_id?: string
  parentId?: string | null
  parent_id?: string | null
}
/** A minimal deployment shape for the latest-deployment column. */
interface DeploymentRow {
  id: string
  serviceId?: string
  createdAt?: string
  status?: string
}

/**
 * Project Services
 *
 * Dedicated first-class page for service management: searchable/filterable
 * service list (top-level services only — sub-services live inside their
 * parent's page), create wizard, delete, and the whole-project dependency
 * graph. Kept separate from Overview so the project dashboard stays lean.
 */
export default function DashboardProjectServicesPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId || ''

  // ── Data fetching ──────────────────────────────────────────────
  const { data: servicesData, isLoading: servicesLoading, error: servicesError, refetch: refetchServices } = useServiceList({
    query: { limit: 100, offset: 0 },
  })
  const { data: deploymentsData, isLoading: deploymentsLoading, error: deploymentsError } = useDeploymentList({
    query: {
      filter: { projectId: { operator: 'eq' as const, value: projectId } },
      limit: 50,
      offset: 0,
    },
  })
  const createService = useCreateService()
  const deleteService = useDeleteService()
  const addServiceDomain = useAddServiceDomain()

  // ── Local state ────────────────────────────────────────────────
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  // ── Derived data ───────────────────────────────────────────────
  const deploymentItems: DeploymentRow[] = deploymentsData?.data ?? []
  const rawServices: ServiceRow[] = servicesData?.data ?? []

  const localServices: ServiceRow[] = useMemo(() => {
    return filterProjectTopLevelServices(rawServices, projectId)
  }, [rawServices, projectId])

  const filteredServices: ServiceRow[] = useMemo(() => {
    let result = localServices
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          (s.name ?? '').toLowerCase().includes(q) ||
          (s.type ?? '').toLowerCase().includes(q) ||
          (s.runtime ?? '').toLowerCase().includes(q) ||
          (s.id ?? '').toLowerCase().includes(q),
      )
    }
    if (statusFilter !== 'all') {
      result = result.filter((s) => (s.status ?? s.state ?? 'active') === statusFilter)
    }
    return result
  }, [localServices, searchQuery, statusFilter])

  const latestDeploymentByServiceId: Record<string, DeploymentRow> = useMemo(() => {
    // Sort by createdAt desc so the FIRST row per service is the latest
    // (the API does not guarantee ordering).
    const sorted = [...deploymentItems].sort((a, b) =>
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
    )
    const map: Record<string, DeploymentRow> = {}
    for (const dep of sorted) {
      const sid = dep.serviceId
      if (sid && !map[sid]) {
        map[sid] = dep
      }
    }
    return map
  }, [deploymentItems])

  const graphServices = useMemo(() => {
    return localServices.map((s) => ({
      id: s.id,
      name: s.name ?? `Service`,
      type: s.type ?? 'unknown',
      projectId,
      isActive: (s.status ?? s.state ?? 'active') === 'active',
    }))
  }, [localServices, projectId])

  // ── Handlers ───────────────────────────────────────────────────
  interface CreateWizardPayload {
    basicInfo?: { name?: string; type?: string }
    provider?: {
      providerId?: string
      config?: Record<string, unknown>
    }
    runner?: {
      runnerId?: string
      build?: Record<string, unknown>
      config?: Record<string, unknown>
    }
    network?: {
      port?: number
      expose?: boolean
      tls?: { enabled?: boolean; certSecretRef?: string; httpRedirect?: boolean }
      portMappings?: Array<{ containerPort: number; hostPort?: number; protocol: string; name?: string }>
      healthCheck?: { type?: string; path?: string; interval?: number; timeout?: number; retries?: number }
      domainEntries?: Array<{
        projectDomainId: string
        subdomain: string | null
        basePath: string | null
        isPrimary: boolean
        sslEnabled: boolean
      }>
    }
  }

  const handleCreateService = async (formData: unknown) => {
    setCreating(true)
    try {
      const data = formData as CreateWizardPayload
      const runnerId = (data.runner?.runnerId ?? 'manual') as "manual" | "compose" | "orchestrator" | "kubernetes" | "nomad" | "static" | "worker-runtime"
      const rc = data.runner?.config ?? {}
      const build = data.runner?.build ?? {}

      const providerConfigBase = {
        ...(data.provider?.config ?? {}),
        rootPath: build.rootPath ?? '/',
        buildContext: build.buildContext ?? '.',
        dockerfilePath: build.dockerfilePath,
      }

      const shared = {
        strategy: rc.strategy ?? 'rolling',
        networkMode: rc.networkMode ?? 'bridge',
        gracefulShutdownSeconds: rc.gracefulShutdownSeconds ?? 30,
      }
      const execution = {
        ...shared,
        startCommand: rc.startCommand ?? '',
        args: rc.args ?? [],
        ports: rc.ports ?? [],
        volumeMounts: rc.volumeMounts ?? [],
        secretRefs: rc.secretRefs ?? [],
      }
      const perRunnerFields: Record<string, Record<string, unknown>> = {
        manual: execution,
        compose: {
          ...shared,
          appName: rc.appName ?? 'stack',
          composeFile: rc.composeFile ?? 'docker-compose.yml',
          profiles: rc.profiles ?? [],
          environment: rc.environment ?? {},
          declaredServices: rc.declaredServices ?? [],
        },
        orchestrator: {
          ...shared,
          composeFile: rc.composeFile ?? 'docker-compose.yml',
          composeProjectName: rc.composeProjectName,
          profiles: rc.profiles ?? [],
          subServices: rc.subServices ?? [],
          environment: rc.environment ?? {},
        },
        kubernetes: {
          ...execution,
          namespace: rc.namespace ?? 'default',
          deploymentName: rc.deploymentName,
          replicas: rc.replicas ?? 1,
          serviceAccountName: rc.serviceAccountName,
        },
        nomad: {
          ...execution,
          jobName: rc.jobName,
          datacenter: rc.datacenter ?? 'dc1',
          nomadNamespace: rc.nomadNamespace,
        },
        'worker-runtime': {
          ...execution,
          queueName: rc.queueName,
          concurrency: rc.concurrency ?? 1,
          maxRetries: rc.maxRetries ?? 0,
        },
        static: {
          strategy: 'recreate',
          startCommand: rc.startCommand ?? '',
          args: rc.args ?? [],
          ports: rc.ports ?? [],
          volumeMounts: rc.volumeMounts ?? [],
          secretRefs: rc.secretRefs ?? [],
          networkMode: rc.networkMode ?? 'bridge',
          gracefulShutdownSeconds: rc.gracefulShutdownSeconds ?? 30,
          outputDir: rc.outputDir ?? 'dist',
          indexFile: rc.indexFile ?? 'index.html',
          errorPage: rc.errorPage,
        },
      }
      const builderConfig = perRunnerFields[runnerId] ?? execution
      const net = data.network ?? {}
      const hc = net.healthCheck ?? { type: 'none' }
      const healthCheckPath = hc.type === 'http' ? (hc as { path?: string }).path ?? '/health' : null
      const healthCheckInterval = hc.type === 'none' ? null : (hc as { interval?: number }).interval ?? 30
      const healthCheckTimeout = hc.type === 'none' ? null : (hc as { timeout?: number }).timeout ?? 10
      const healthCheckRetries = hc.type === 'none' ? null : (hc as { retries?: number }).retries ?? 3

      const parsedOrchestrator = orchestratorRunnerConfigSchema.safeParse(rc)
      const orchestrator = parsedOrchestrator.success ? parsedOrchestrator.data : undefined

      const mapSubService = (
        svc: {
          name: string
          image?: string
          port?: number
          environment?: Record<string, string>
          replicas?: number
          dependsOn?: string[]
          customDomains?: string[]
          expose?: boolean
          healthCheck?: unknown
          resources?: { cpus?: number; memory?: string }
        },
        serviceName: string,
      ): ServiceCreateInput => {
        const env = svc.environment ?? {}
        const mergedEnv = { ...(orchestrator?.environment ?? {}), ...env }
        const parentProviderConfig = (data.provider?.config ?? {}) as Record<string, unknown>
        const parentSourceUrl = typeof parentProviderConfig.sourceUrl === 'string' && parentProviderConfig.sourceUrl
          ? parentProviderConfig.sourceUrl
          : 'https://github.com/N0SAFE/deployer'
        const parentBranch = typeof parentProviderConfig.branch === 'string' && parentProviderConfig.branch
          ? parentProviderConfig.branch
          : 'main'
        const childProviderId = (data.provider?.providerId ?? 'github') as 'github' | 'gitlab' | 'bitbucket' | 'container-registry' | 'artifact-bundle' | 'manual'
        const childImage = svc.image && svc.image.length > 0 ? svc.image : undefined
        const containerImage = childImage ?? 'scratch'
        return {
          projectId,
          name: svc.name || serviceName,
          type: 'application',
          providerId: childProviderId,
          providerConfig: childProviderId === 'container-registry' || childProviderId === 'artifact-bundle'
            ? {
                sourceUrl: parentSourceUrl,
                branch: parentBranch,
                rootPath: '/',
                buildContext: '.',
                image: containerImage,
                autoSyncEnabled: false,
                webhookEnabled: false,
                authSecretRef: 'default',
              }
            : {
                sourceUrl: parentSourceUrl,
                branch: parentBranch,
                rootPath: '/',
                buildContext: '.',
                image: childImage,
                autoSyncEnabled: false,
                webhookEnabled: false,
                authSecretRef: 'default',
              },
          builderId: 'orchestrator',
          builderConfig: orchestrator ?? {
            strategy: 'rolling' as const,
            networkMode: 'bridge' as const,
            gracefulShutdownSeconds: 30,
            composeFile: 'docker-compose.yml',
            profiles: [],
            subServices: [],
            environment: mergedEnv,
            autoDeploySubtree: 'whole-stack',
            previewScope: 'whole-stack',
          },
          port: svc.port ?? null,
          environmentVariables: Object.keys(mergedEnv).length > 0 ? mergedEnv : null,
          customDomains: svc.customDomains?.length ? svc.customDomains : undefined,
          metadata: {
            networking: {
              expose: svc.expose ?? false,
              tls: { enabled: false, httpRedirect: true },
              portMappings: [],
            },
            replicas: svc.replicas ?? 1,
            dependsOn: svc.dependsOn ?? [],
            resources: svc.resources ?? null,
          },
        }
      }

      const subServices = ((rc as { subServices?: unknown[] }).subServices ?? []) as Parameters<typeof mapSubService>[0][]
      const children = subServices.map((svc) => mapSubService(svc, svc.name))

      const created = await createService.mutateAsync({
        name: data.basicInfo?.name ?? '',
        type: (runnerId === 'manual' ? 'application'
          : runnerId === 'compose' ? 'compose'
          : runnerId === 'orchestrator' ? 'sub-services'
          : runnerId === 'worker-runtime' ? 'worker'
          : runnerId),
        providerId: (data.provider?.providerId ?? 'github') as ServiceCreateInput['providerId'],
        providerConfig: providerConfigBase as ServiceCreateInput['providerConfig'],
        builderId: runnerId,
        builderConfig: builderConfig as ServiceCreateInput['builderConfig'],
        port: net.port ?? undefined,
        healthCheckPath,
        healthCheckInterval,
        healthCheckTimeout,
        healthCheckRetries,
        metadata: {
          networking: {
            expose: net.expose ?? false,
            tls: net.tls ?? { enabled: false, httpRedirect: true },
            portMappings: net.portMappings ?? [],
          },
          healthCheck: hc.type === 'none' ? null : {
            type: hc.type,
            ...(hc as Record<string, unknown>),
          },
        },
        ...(children.length > 0 ? { children } : {}),
        projectId,
      })
      const serviceId = (created as { id?: string }).id

      const entries = data.network?.domainEntries ?? []
      if (serviceId && entries.length > 0) {
        let attached = 0
        for (const entry of entries) {
          try {
            await addServiceDomain.mutateAsync({
              params: { serviceId },
              body: {
                projectDomainId: entry.projectDomainId,
                subdomain: entry.subdomain,
                basePath: entry.basePath,
                isPrimary: entry.isPrimary,
                sslEnabled: entry.sslEnabled,
                sslProvider: 'letsencrypt',
              },
            })
            attached += 1
          } catch (err) {
            toast.error('Failed to attach one domain', {
              description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE,
            })
          }
        }
        toast.success(attached > 0 ? `Service created with ${attached} domain${attached > 1 ? 's' : ''}` : 'Service created')
      } else {
        toast.success('Service created successfully')
      }
      setCreateDialogOpen(false)
    } catch (err) {
      toast.error('Failed to create service', {
        description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE,
      })
    } finally {
      setCreating(false)
    }
  }

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const handleDeleteService = async () => {
    if (!deleteConfirmId) return
    try {
      await deleteService.mutateAsync({ params: { id: deleteConfirmId } })
      toast.success('Service deleted')
      setDeleteConfirmId(null)
    } catch (err) {
      toast.error('Failed to delete service', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  if (servicesLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    )
  }

  const loadError = servicesError ?? deploymentsError
  if (loadError) {
    return (
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>Failed to load services</AlertTitle>
        <AlertDescription>
          {isDefinedORPCError(loadError) ? getErrorMessage(loadError, 'An unexpected error occurred.') : 'An unexpected error occurred.'}
        </AlertDescription>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetchServices()}>Retry</Button>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Services</h2>
          <p className="text-sm text-muted-foreground">
            Manage the services of this project. Sub-services are managed inside their parent service.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 size-4" />
          Create service
        </Button>
      </div>

      {/* Stats strip */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {localServices.filter((s) => (s.status ?? s.state ?? 'active') === 'active').length} active
        </Badge>
        <Badge variant="outline">
          {localServices.length} services
        </Badge>
        <Badge variant="outline">
          {deploymentItems.length} deployments
        </Badge>
      </div>

      {/* Search & Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search services..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search services"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v: 'all' | 'active' | 'inactive') => setStatusFilter(v)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Services table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Services</CardTitle>
            <CardDescription>
              {filteredServices.length} of {localServices.length} services
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            Create service
          </Button>
        </CardHeader>
        <CardContent>
          {filteredServices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Siren className="mb-4 size-12 text-muted-foreground/40" />
              <p className="text-lg font-medium">No services found</p>
              <p className="text-sm text-muted-foreground">
                {searchQuery || statusFilter !== 'all'
                  ? 'Try adjusting your search or filters.'
                  : 'Create a service to get started.'}
              </p>
              {!searchQuery && statusFilter === 'all' && (
                <Button className="mt-4" size="sm" onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  Create your first service
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Type &amp; Runtime</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latest deployment</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredServices.map((service, index) => {
                  const latestDep = latestDeploymentByServiceId[service.id]
                  return (
                    <TableRow key={service.id ?? index} className="group">
                      <TableCell>
                        <AuthDashboardProjectsProjectIdServicesServiceId.Link
                          projectId={projectId}
                          serviceId={service.id}
                          className="block"
                        >
                          <div className="flex items-center gap-2">
                            <p className="font-medium underline-offset-4 group-hover:underline">
                              {service.name ?? 'Unnamed'}
                            </p>
                            <Settings className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                          </div>
                          <p className="text-xs text-muted-foreground font-mono">
                            {shortId(service.id)}
                          </p>
                        </AuthDashboardProjectsProjectIdServicesServiceId.Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {service.type && <Badge variant="outline">{service.type}</Badge>}
                          {service.runtime && <Badge variant="outline">{service.runtime}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={service.status ?? service.state ?? 'unknown'} className="text-[11px]" />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {latestDep
                          ? formatDate(latestDep.createdAt ?? '')
                          : deploymentsLoading
                            ? 'Loading...'
                            : 'No deployments'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            title="Open service"
                            aria-label={`Open ${service.name ?? 'service'}`}
                            asChild
                          >
                            <AuthDashboardProjectsProjectIdServicesServiceId.Link projectId={projectId} serviceId={service.id}>
                              <Settings className="size-4" />
                            </AuthDashboardProjectsProjectIdServicesServiceId.Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            title="Delete service"
                            aria-label={`Delete ${service.name ?? 'service'}`}
                            onClick={() => setDeleteConfirmId(service.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dependency Graph Panel */}
      {graphServices.length > 0 && (
        <ServiceDependencyGraphPanel
          services={graphServices}
          serviceEnvironments={{}}
          title="Service dependency graph"
          description="Declared dependency links between services in this project."
        />
      )}

      {/* Create Service Wizard */}
      {createDialogOpen && (
        <CreateServiceWizard
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          projectId={projectId}
          onConfirm={handleCreateService}
          creating={creating}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={(o) => !o && setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Service</DialogTitle>
            <DialogDescription>Are you sure? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the service and all its deployments.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteService} disabled={deleteService.isPending}>
              {deleteService.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
