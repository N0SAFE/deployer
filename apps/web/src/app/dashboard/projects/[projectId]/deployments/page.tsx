'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useProjectDetail } from '../_hooks/use-project-detail'
import { useDeploymentFilters } from '../_hooks/use-project-filters'
import { useTriggerDeployment, useCancelDeployment, useRollbackDeployment, useRetryDeployment, useDeleteDeployment } from '@/domains/deployment/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { useProjectEnvironments } from '@/domains/project/hooks'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@repo/ui/components/shadcn/dialog'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Siren, RefreshCw, Rocket, RotateCcw, XCircle, Play, Trash2, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate, shortId } from '../_utils/helpers'
import { StatusBadge } from '@/components/dashboard'
import { filterProjectTopLevelServices } from '@/domains/service/hierarchy'
import { AuthDashboardProjectsProjectIdServicesServiceIdLogs } from '@/routes'
import { z } from 'zod/v4'

const triggerSchema = z.object({
  serviceId: z.string().min(1, 'Select a service'),
  // Environments are first-class primitives (free-form names) — any env the
  // project defines can be a deploy target.
  environment: z.string().min(1, 'Select an environment'),
})

export default function ProjectDeploymentsPage() {
  const { projectId, deployments, isLoading, error, refetchDeployments } = useProjectDetail()
  const { filters, setFilters } = useDeploymentFilters()

  const triggerDeployment = useTriggerDeployment()
  const cancelDeployment = useCancelDeployment()
  const rollbackDeployment = useRollbackDeployment()
  const retryDeployment = useRetryDeployment()
  const deleteDeployment = useDeleteDeployment()
  const { data: servicesData } = useServiceList({ query: { limit: 100, offset: 0 } })
  const { data: environmentsData } = useProjectEnvironments(projectId)

  // Real environment primitives of this project (free-form names + kinds).
  const projectEnvironments = useMemo(() => {
    if (!environmentsData) return []
    const list = Array.isArray(environmentsData) ? environmentsData : (environmentsData as { environments?: unknown[] }).environments ?? []
    return list as Array<{ id: string; name: string; kind?: string }>
  }, [environmentsData])

  // ── Service filter state (not URL-synced — derived per project) ──
  const [serviceFilter, setServiceFilter] = useState('all')

  // TOP-LEVEL services of this project only — sub-services are deployed from
  // their own page (inside the parent service), not from the project-level
  // trigger selector.
  const localServices = useMemo(() => {
    if (!servicesData?.data) return []
    return filterProjectTopLevelServices(servicesData.data, projectId)
  }, [servicesData, projectId])

  // ── Filter state ────────────────────────────────────────────────
  const filteredDeployments = useMemo(() => {
    if (!deployments || deployments.length === 0) return []
    let result = deployments
    if (filters.status && filters.status !== 'all') {
      result = result.filter((d: any) => (d.status ?? d.state ?? '').toLowerCase() === filters.status)
    }
    if (filters.environment && filters.environment !== 'all') {
      result = result.filter((d: any) => (d.environment ?? '').toLowerCase() === filters.environment)
    }
    if (serviceFilter && serviceFilter !== 'all') {
      result = result.filter((d: any) => (d.serviceId ?? d.service_id) === serviceFilter)
    }
    return result
  }, [deployments, filters, serviceFilter])

  // Distinct environments present in this project's deployments
  const availableEnvironments = useMemo(() => {
    const set = new Set<string>()
    for (const d of deployments ?? []) {
      const env = (d as any).environment
      if (env) set.add(String(env))
    }
    return Array.from(set).sort()
  }, [deployments])

  // ── Trigger dialog ──────────────────────────────────────────────
  const [triggerOpen, setTriggerOpen] = useState(false)

  const triggerForm = useForm({
    defaultValues: { serviceId: '', environment: 'production' },
    onSubmit: async ({ value }) => {
      const parsed = triggerSchema.safeParse(value)
      if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Invalid input'); return }
      const svc = localServices.find((s: any) => s.id === parsed.data.serviceId) as Record<string, unknown> | undefined
      if (!svc) { toast.error('Selected service not found'); return }
      const providerId = String(svc.providerId ?? svc.provider_type ?? '')
      const source = providerId === 'github' ? {
        sourceType: 'github' as const,
        repositoryUrl: String((svc.providerConfig ?? svc.provider_config) ? ((svc.providerConfig ?? svc.provider_config) as Record<string, unknown>).sourceUrl ?? ((svc.providerConfig ?? svc.provider_config) as Record<string, unknown>).repositoryUrl ?? '' : ''),
        branch: String((svc.providerConfig ?? svc.provider_config) ? ((svc.providerConfig ?? svc.provider_config) as Record<string, unknown>).branch ?? 'main' : ''),
      } : undefined
      try {
        await triggerDeployment.mutateAsync({
          body: {
            serviceId: parsed.data.serviceId,
            environment: parsed.data.environment,
            ...(source ? { source } : {}),
          },
        } as any)
        toast.success('Deployment triggered')
        setTriggerOpen(false)
        triggerForm.reset()
      } catch (err) { toast.error('Failed to trigger deployment', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
    },
  })

  // ── Cancel confirm ──────────────────────────────────────────────
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelId, setCancelId] = useState<string | null>(null)

  const handleCancel = async () => {
    if (!cancelId) return
    try {
      await cancelDeployment.mutateAsync({ params: { id: cancelId } } as any)
      toast.success('Deployment cancelled'); setCancelOpen(false); setCancelId(null)
    } catch (err) { toast.error('Failed to cancel', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  // ── Rollback confirm ────────────────────────────────────────────
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [rollbackId, setRollbackId] = useState<string | null>(null)

  const handleRollback = async () => {
    if (!rollbackId) return
    try {
      await rollbackDeployment.mutateAsync({ params: { id: rollbackId } } as any)
      toast.success('Rollback initiated'); setRollbackOpen(false); setRollbackId(null)
    } catch (err) { toast.error('Failed to rollback', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  // ── Retry ───────────────────────────────────────────────────────
  const handleRetry = async (id: string) => {
    try {
      await retryDeployment.mutateAsync({ params: { id } } as any)
      toast.success('Retrying deployment')
    } catch (err) { toast.error('Failed to retry', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  // ── Delete confirm ──────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteDeployment.mutateAsync({ params: { id: deleteId } } as any)
      toast.success('Deployment deleted'); setDeleteOpen(false); setDeleteId(null)
    } catch (err) { toast.error('Failed to delete', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  // ── Render ──────────────────────────────────────────────────────
  if (isLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>
  if (error) return (
    <Alert variant="destructive">
      <Siren className="size-4" />
      <AlertTitle>Failed to load deployments</AlertTitle>
      <AlertDescription>
        {isDefinedORPCError(error) ? getErrorMessage(error) : 'An unexpected error occurred.'}
        <button
          type="button"
          onClick={() => void refetchDeployments()}
          className="ml-2 inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-2 py-0.5 text-xs font-medium text-destructive underline-offset-2 hover:underline"
        >
          <RefreshCw className="size-3" /> Retry
        </button>
      </AlertDescription>
    </Alert>
  )

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Deployments</CardTitle>
            <CardDescription>{filteredDeployments.length} deployment{filteredDeployments.length !== 1 ? 's' : ''}</CardDescription>
          </div>
          <Dialog open={triggerOpen} onOpenChange={setTriggerOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Rocket className="mr-2 size-4" />New Deployment</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle>Trigger Deployment</DialogTitle><DialogDescription>Select service and environment to deploy.</DialogDescription></DialogHeader>
              <div className="grid gap-4 py-4">
                <triggerForm.Field name="serviceId">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label>Service</Label>
                      <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                        <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
                        <SelectContent>
                          {localServices.map((s: any) => (<SelectItem key={s.id} value={s.id}>{s.name ?? s.id}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </triggerForm.Field>
                <triggerForm.Field name="environment">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label>Environment</Label>
                      <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {projectEnvironments.length === 0 ? (
                            <SelectItem value="__none__" disabled>No environments defined</SelectItem>
                          ) : (
                            projectEnvironments.map((env) => (
                              <SelectItem key={env.id} value={env.name} className="capitalize">
                                {env.name}{env.kind ? ` · ${env.kind}` : ''}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </triggerForm.Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTriggerOpen(false)}>Cancel</Button>
                <triggerForm.Subscribe selector={(s) => s.isSubmitting}>
                  {(isSubmitting) => (
                    <Button onClick={triggerForm.handleSubmit} disabled={isSubmitting || triggerDeployment.isPending}>
                      {triggerDeployment.isPending ? 'Triggering...' : 'Deploy'}
                    </Button>
                  )}
                </triggerForm.Subscribe>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {/* Filter bar — status / environment / service */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="grid gap-1.5">
              <Label className="text-[11px] text-muted-foreground">Status</Label>
              <Select value={filters.status} onValueChange={(v) => setFilters({ status: v as never })}>
                <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px] text-muted-foreground">Environment</Label>
              <Select value={filters.environment ?? 'all'} onValueChange={(v) => setFilters({ environment: v })}>
                <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All environments</SelectItem>
                  {availableEnvironments.map((env) => (
                    <SelectItem key={env} value={env} className="capitalize">{env}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[11px] text-muted-foreground">Service</Label>
              <Select value={serviceFilter} onValueChange={setServiceFilter}>
                <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {localServices.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.name ?? s.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(filters.status !== 'all' || (filters.environment ?? 'all') !== 'all' || serviceFilter !== 'all') && (
              <Button size="sm" variant="ghost" className="mt-4 h-8" onClick={() => { setFilters({ status: 'all', environment: 'all' }); setServiceFilter('all') }}>
                Clear filters
              </Button>
            )}
          </div>

          {filteredDeployments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Rocket className="mb-4 size-12 text-muted-foreground/40" />
              <p className="text-lg font-medium">No deployments yet</p>
              <p className="text-sm text-muted-foreground">Trigger a deployment to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-40">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDeployments.map((dep: any, index: number) => {
                  const status = (dep.status ?? dep.state ?? '').toLowerCase()
                  return (
                    <TableRow key={dep.id ?? index}>
                      <TableCell className="font-mono text-xs">{shortId(dep.id)}</TableCell>
                      <TableCell><StatusBadge status={status} className="text-[11px]" /></TableCell>
                      <TableCell>{dep.environment ?? '-'}</TableCell>
                      <TableCell>{dep.serviceName ?? dep.service_id ?? dep.serviceId ?? '-'}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{formatDate(dep.createdAt ?? dep.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {/* Link to the service logs for this deployment */}
                          {dep.serviceId || dep.service_id ? (
                            <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                              projectId={projectId}
                              serviceId={dep.serviceId ?? dep.service_id}
                            >
                              <Button variant="ghost" size="icon" className="size-7" title="View service logs" aria-label="View service logs">
                                <ScrollText className="size-3.5" />
                              </Button>
                            </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                          ) : null}
                          {(status === 'pending' || status === 'queued' || status === 'building' || status === 'deploying') && (
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => { setCancelId(dep.id); setCancelOpen(true) }} title="Cancel"><XCircle className="size-3.5" /></Button>
                          )}
                          {(status === 'success' || status === 'failed') && (
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => { setRollbackId(dep.id); setRollbackOpen(true) }} title="Rollback"><RotateCcw className="size-3.5" /></Button>
                          )}
                          {status === 'failed' && (
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => handleRetry(dep.id)} title="Retry"><Play className="size-3.5" /></Button>
                          )}
                          {status !== 'pending' && status !== 'queued' && status !== 'building' && status !== 'deploying' && (
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => { setDeleteId(dep.id); setDeleteOpen(true) }} title="Delete"><Trash2 className="size-3.5" /></Button>
                          )}
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

      {/* Cancel Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cancel Deployment</DialogTitle><DialogDescription>This will stop the running deployment <strong className="font-mono">{shortId(cancelId ?? '')}</strong>.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Close</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelDeployment.isPending}>{cancelDeployment.isPending ? 'Cancelling...' : 'Cancel Deployment'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback Dialog */}
      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rollback Deployment</DialogTitle><DialogDescription>Revert deployment <strong className="font-mono">{shortId(rollbackId ?? '')}</strong> to the previous version.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackOpen(false)}>Close</Button>
            <Button onClick={handleRollback} disabled={rollbackDeployment.isPending}>{rollbackDeployment.isPending ? 'Rolling back...' : 'Rollback'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Delete Deployment</DialogTitle><DialogDescription>This permanently removes the deployment record <strong className="font-mono">{shortId(deleteId ?? '')}</strong>.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteDeployment.isPending}>{deleteDeployment.isPending ? 'Deleting...' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
