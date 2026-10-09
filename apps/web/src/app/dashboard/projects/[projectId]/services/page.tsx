'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Plus, Search, Trash2, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from '@/lib/orpc/typed-errors'
import { useServiceList, useCreateService, useDeleteService } from '@/domains/service/hooks'
import { useAddServiceDomain } from '@/domains/domain/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { filterProjectTopLevelServices } from '@/domains/service/hierarchy'
import { AuthDashboardProjectsProjectIdServicesServiceId } from '@/routes'
import { Button } from '@repo/ui/components/shadcn/button'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import { StatusBadge, EmptyState, FilteredEmptyState, StatStrip, StatStripItem } from '@/components/dashboard'
import { ServiceDependencyGraphPanel } from '../../_components/ServiceDependencyGraphPanel'
import { CreateServiceWizard } from '../../_components/CreateServiceWizard'
import { buildCreateServiceInput, type CreateWizardPayload } from '../../_utils/build-create-service-input'
import { ListLoading, InlineError, SectionHeading } from '../../_components/workload/WorkloadStates'
import { RelativeTime } from '../../_components/workload/RelativeTime'
import { IdChip } from '../../_components/workload/CopyButton'
import { latestBy } from '../../_utils/workload'

type ActivityFilter = 'all' | 'active' | 'inactive'

/**
 * Project Services — the services of THIS project (top-level only: sub-services
 * live inside their parent), the create wizard, delete, and the dependency graph.
 */
export default function DashboardProjectServicesPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId || ''

  const servicesQuery = useServiceList({ query: { limit: 100, offset: 0 } })
  const deploymentsQuery = useDeploymentList({
    query: { filter: { projectId: { operator: 'eq' as const, value: projectId } }, limit: 50, offset: 0 },
  })
  const createService = useCreateService()
  const deleteService = useDeleteService()
  const addServiceDomain = useAddServiceDomain()

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ActivityFilter>('all')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const localServices = useMemo(
    () => filterProjectTopLevelServices(servicesQuery.data?.data ?? [], projectId),
    [servicesQuery.data, projectId],
  )

  const filteredServices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return localServices.filter((s) => {
      if (statusFilter === 'active' && !s.isActive) return false
      if (statusFilter === 'inactive' && s.isActive) return false
      if (!q) return true
      return s.name.toLowerCase().includes(q) || s.type.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    })
  }, [localServices, searchQuery, statusFilter])

  const latestByService = useMemo(
    () => latestBy(deploymentsQuery.data?.data ?? [], (d) => d.serviceId),
    [deploymentsQuery.data],
  )

  const graphServices = useMemo(
    () => localServices.map((s) => ({ id: s.id, name: s.name, type: s.type, projectId, isActive: s.isActive })),
    [localServices, projectId],
  )

  const handleCreateService = async (formData: unknown) => {
    setCreating(true)
    try {
      const data = formData as CreateWizardPayload
      const created = await createService.mutateAsync(buildCreateServiceInput(data, projectId))
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
        toast.success(attached > 0 ? `Service created with ${String(attached)} domain${attached > 1 ? 's' : ''}` : 'Service created')
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

  const deletingService = localServices.find((s) => s.id === deleteConfirmId) ?? null
  const filtered = searchQuery.trim() !== '' || statusFilter !== 'all'
  const clearFilters = () => { setSearchQuery(''); setStatusFilter('all') }
  const activeCount = localServices.filter((s) => s.isActive).length
  const createButton = (
    <Button size="sm" onClick={() => { setCreateDialogOpen(true) }}>
      <Plus className="mr-1.5 size-4" />
      Create service
    </Button>
  )

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Services"
        description="The services of this project. Sub-services are managed inside their parent service."
        actions={localServices.length > 0 ? createButton : undefined}
      />

      {servicesQuery.isError ? (
        <InlineError title="Could not load services" error={servicesQuery.error} onRetry={() => void servicesQuery.refetch()} />
      ) : null}

      {servicesQuery.isLoading ? (
        <ListLoading label="Loading services" waitingOn="the services list" columns={4} />
      ) : servicesQuery.isError ? null : localServices.length === 0 ? (
        <EmptyState
          icon={Settings}
          title="No services in this project yet"
          description="A service is one thing you deploy: a web app, an API, a worker or a compose stack. Create the first one from a Git repository, an image or an upload."
          action={{ label: 'Create your first service', onClick: () => { setCreateDialogOpen(true) } }}
        />
      ) : (
        <>
          <StatStrip>
            <StatStripItem label="Services" value={localServices.length} />
            <StatStripItem label="Switched on" value={activeCount} tone={activeCount > 0 ? 'live' : undefined} hint={`${String(localServices.length - activeCount)} off`} />
            <StatStripItem
              label="Deployments"
              value={deploymentsQuery.isError ? undefined : deploymentsQuery.data?.data.length}
              hint={deploymentsQuery.isError ? 'unavailable' : 'latest 50'}
            />
          </StatStrip>

          <Card>
            <CardHeader>
              <CardTitle>All services</CardTitle>
              <CardDescription>{filteredServices.length} of {localServices.length} shown</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-52 flex-1 md:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, type or id"
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value) }}
                    aria-label="Search services"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as ActivityFilter) }}>
                  <SelectTrigger className="w-40" aria-label="Filter by switch"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">On and off</SelectItem>
                    <SelectItem value="active">Switched on</SelectItem>
                    <SelectItem value="inactive">Switched off</SelectItem>
                  </SelectContent>
                </Select>
                {filtered ? <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button> : null}
              </div>

              {filteredServices.length === 0 ? (
                <FilteredEmptyState label="No service matches these filters." onClear={clearFilters} />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>Service</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Switch</TableHead>
                        <TableHead>Latest deployment</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredServices.map((service) => {
                        const latest = latestByService.get(service.id)
                        return (
                          <TableRow key={service.id} className="hover:bg-muted/40">
                            <TableCell>
                              <AuthDashboardProjectsProjectIdServicesServiceId.Link
                                projectId={projectId}
                                serviceId={service.id}
                                className="font-medium hover:underline"
                              >
                                {service.name}
                              </AuthDashboardProjectsProjectIdServicesServiceId.Link>
                              <div><IdChip id={service.id} label={`Copy id of ${service.name}`} /></div>
                            </TableCell>
                            <TableCell><Badge variant="outline">{service.type}</Badge></TableCell>
                            <TableCell><StatusBadge status={service.isActive ? 'active' : 'inactive'} /></TableCell>
                            <TableCell>
                              {deploymentsQuery.isError ? (
                                <span className="text-muted-foreground">—</span>
                              ) : deploymentsQuery.isLoading ? (
                                <span className="text-sm text-muted-foreground">Loading…</span>
                              ) : latest ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge status={latest.status} />
                                  <RelativeTime value={latest.createdAt} className="text-sm text-muted-foreground" />
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">Never deployed</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                <Button asChild variant="outline" size="sm">
                                  <AuthDashboardProjectsProjectIdServicesServiceId.Link projectId={projectId} serviceId={service.id}>
                                    Open
                                  </AuthDashboardProjectsProjectIdServicesServiceId.Link>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-destructive hover:text-destructive"
                                  title="Delete service"
                                  aria-label={`Delete ${service.name}`}
                                  onClick={() => { setDeleteConfirmId(service.id) }}
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
                </div>
              )}
            </CardContent>
          </Card>

          <ServiceDependencyGraphPanel
            services={graphServices}
            serviceEnvironments={{}}
            title="Service dependency graph"
            description="Declared dependency links between services in this project."
          />
        </>
      )}

      {createDialogOpen ? (
        <CreateServiceWizard
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          projectId={projectId}
          onConfirm={handleCreateService}
          creating={creating}
        />
      ) : null}

      <Dialog open={deletingService !== null} onOpenChange={(o) => { if (!o) setDeleteConfirmId(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete service “{deletingService?.name ?? ''}”?</DialogTitle>
            <DialogDescription>
              This permanently deletes the service, its sub-services and all their deployment records, and stops their containers. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteConfirmId(null) }}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleDeleteService()} disabled={deleteService.isPending}>
              {deleteService.isPending ? 'Deleting…' : 'Delete service'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
