'use client'

import { useForm } from '@tanstack/react-form'
import { Siren, RefreshCw, Rocket, RotateCcw, XCircle, Play, Trash2, ScrollText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod/v4'

import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@deployer/ui/components/shadcn/dialog'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'

import { StatusBadge, EmptyState, FilteredEmptyState } from '@/components/dashboard'
import { useTriggerDeployment, useCancelDeployment, useRollbackDeployment, useRetryDeployment, useDeleteDeployment } from '@/domains/deployment/hooks'
import { useProjectEnvironments } from '@/domains/project/hooks'
import { filterProjectTopLevelServices } from '@/domains/service/hierarchy'
import { useServiceList } from '@/domains/service/hooks'
import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { AuthDashboardProjectsProjectIdServicesServiceIdLogs } from '@/routes'

import { useProjectDetail } from '../_hooks/use-project-detail'
import { useDeploymentFilters } from '../_hooks/use-project-filters'
import { formatDate, shortId } from '../_utils/helpers'



/**
 * The provider fields this page reads. The service's `providerConfig` is an
 * opaque record, so it is parsed once here instead of stringified field by field.
 */
const providerConfigSchema = z
  .object({
    sourceUrl: z.string().optional(),
    repositoryUrl: z.string().optional(),
    branch: z.string().optional(),
  })
  .catchall(z.unknown())

const triggerSchema = z.object({
  serviceId: z.string().min(1, 'Select a service'),
  // The deployment API accepts these four targets; the form offers the project's
  // own environment names, so an unknown one is rejected here rather than at the API.
  environment: z.enum(['development', 'preview', 'production', 'staging']),
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
    return list as { id: string; name: string; kind?: string }[]
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
    if (deployments.length === 0) return []
    let result = deployments
    if (filters.status !== 'all') {
      result = result.filter((d) => d.status.toLowerCase() === filters.status)
    }
    if (filters.environment && filters.environment !== 'all') {
      result = result.filter((d) => d.environment.toLowerCase() === filters.environment)
    }
    if (serviceFilter && serviceFilter !== 'all') {
      result = result.filter((d) => d.serviceId === serviceFilter)
    }
    return result
  }, [deployments, filters, serviceFilter])

  // Distinct environments present in this project's deployments
  const availableEnvironments = useMemo(() => {
    const set = new Set<string>()
    for (const d of deployments) {
      const env = d.environment
      set.add(env)
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
      const svc = localServices.find((s) => s.id === parsed.data.serviceId)
      if (!svc) { toast.error('Selected service not found'); return }
      const providerConfig = providerConfigSchema.parse(svc.providerConfig ?? {})
      // `source` is REQUIRED and discriminated by provider: a deployment always
      // names where it builds from. Anything that is not a known git provider
      // carries the service's provider config as the custom payload.
      const repositoryUrl = providerConfig.sourceUrl ?? providerConfig.repositoryUrl ?? ''
      const branch = providerConfig.branch ?? 'main'
      const source = svc.providerId === 'github'
        ? { sourceType: 'github' as const, repositoryUrl, branch }
        : svc.providerId === 'gitlab'
          ? { sourceType: 'gitlab' as const, repositoryUrl, branch }
          : { sourceType: 'custom' as const, customData: providerConfig }
      try {
        await triggerDeployment.mutateAsync({
          serviceId: parsed.data.serviceId,
          environment: parsed.data.environment,
          source,
        })
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
      await cancelDeployment.mutateAsync({ params: { id: cancelId } })
      toast.success('Deployment cancelled'); setCancelOpen(false); setCancelId(null)
    } catch (err) { toast.error('Failed to cancel', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  // ── Rollback confirm ────────────────────────────────────────────
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [rollbackId, setRollbackId] = useState<string | null>(null)

  /**
   * The deployment to restore when rolling back `rollbackId`: the most recent
   * SUCCESSFUL deployment of the same service that came before it. The API needs
   * an explicit target (`targetDeploymentId`), so the page resolves it instead of
   * sending the row's own id and letting the service refuse with a 409.
   */
  const rollbackTarget = useMemo(() => {
    if (rollbackId === null) return null
    const current = deployments.find((deployment) => deployment.id === rollbackId)
    if (current === undefined) return null
    const currentAt = new Date(current.createdAt).getTime()
    return (
      deployments
        .filter(
          (deployment) =>
            deployment.id !== current.id &&
            deployment.serviceId === current.serviceId &&
            deployment.status === 'success' &&
            new Date(deployment.createdAt).getTime() < currentAt,
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null
    )
  }, [deployments, rollbackId])

  const handleRollback = async () => {
    if (!rollbackId) return
    if (rollbackTarget === null) {
      toast.error('No successful deployment to roll back to')
      return
    }
    try {
      await rollbackDeployment.mutateAsync({
        params: { id: rollbackId },
        body: { targetDeploymentId: rollbackTarget.id },
      })
      toast.success('Rollback initiated'); setRollbackOpen(false); setRollbackId(null)
    } catch (err) { toast.error('Failed to rollback', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  // ── Retry ───────────────────────────────────────────────────────
  const handleRetry = async (id: string) => {
    try {
      await retryDeployment.mutateAsync({ params: { id } })
      toast.success('Retrying deployment')
    } catch (err) { toast.error('Failed to retry', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE }) }
  }

  // ── Delete confirm ──────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteDeployment.mutateAsync({ params: { id: deleteId } })
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
                      <Select value={field.state.value} onValueChange={(v) => { field.handleChange(v); }}>
                        <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
                        <SelectContent>
                          {localServices.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </triggerForm.Field>
                <triggerForm.Field name="environment">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label>Environment</Label>
                      <Select value={field.state.value} onValueChange={(v) => { field.handleChange(v); }}>
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
                <Button variant="outline" onClick={() => { setTriggerOpen(false); }}>Cancel</Button>
                <triggerForm.Subscribe selector={(s) => s.isSubmitting}>
                  {(isSubmitting) => (
                    <Button onClick={() => { void triggerForm.handleSubmit(); }} disabled={isSubmitting || triggerDeployment.isPending}>
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
              <Select value={filters.status} onValueChange={(v) => { setFilters({ status: v as never }); }}>
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
              <Select value={filters.environment} onValueChange={(v) => { setFilters({ environment: v }); }}>
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
                  {localServices.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(filters.status !== 'all' || filters.environment !== 'all' || serviceFilter !== 'all') && (
              <Button size="sm" variant="ghost" className="mt-4 h-8" onClick={() => { setFilters({ status: 'all', environment: 'all' }); setServiceFilter('all') }}>
                Clear filters
              </Button>
            )}
          </div>

          {filteredDeployments.length === 0 ? (
            /*
              Two different facts, previously told the same way. Filtering to a
              service with no deploys showed "No deployments yet — trigger a
              deployment to get started", which is false: deployments exist,
              you just filtered them out.
            */
            serviceFilter !== 'all' ? (
              <FilteredEmptyState
                label="No deployments for this service."
                onClear={() => { setServiceFilter('all') }}
              />
            ) : (
              <EmptyState
                icon={Rocket}
                title="No deployments yet"
                description="Trigger a deployment to get started."
                action={{ label: 'Trigger deployment', onClick: () => { setTriggerOpen(true) } }}
              />
            )
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
                {filteredDeployments.map((dep) => {
                  const status = dep.status.toLowerCase()
                  // Read the id once and reuse it: the row already needed it for
                  // the ID cell, and the action labels below need it too.
                  const displayId = shortId(dep.id)
                  return (
                    <TableRow key={dep.id}>
                      <TableCell className="font-mono text-xs">{displayId}</TableCell>
                      <TableCell><StatusBadge status={status} className="text-[11px]" /></TableCell>
                      <TableCell>{dep.environment}</TableCell>
                      <TableCell>{dep.serviceId}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{formatDate(dep.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {/* Link to the service logs for this deployment */}
                          {dep.serviceId ? (
                            <AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link
                              projectId={projectId}
                              serviceId={dep.serviceId}
                            >
                              <Button variant="ghost" size="icon" className="size-7" title="View service logs" aria-label="View service logs">
                                <ScrollText className="size-3.5" />
                              </Button>
                            </AuthDashboardProjectsProjectIdServicesServiceIdLogs.Link>
                          ) : null}
                          {(status === 'pending' || status === 'queued' || status === 'building' || status === 'deploying') && (
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => { setCancelId(dep.id); setCancelOpen(true) }} title="Cancel" aria-label={`Cancel deployment ${displayId}`}><XCircle className="size-3.5" /></Button>
                          )}
                          {(status === 'success' || status === 'failed') && (
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => { setRollbackId(dep.id); setRollbackOpen(true) }} title="Rollback" aria-label={`Roll back deployment ${displayId}`}><RotateCcw className="size-3.5" /></Button>
                          )}
                          {status === 'failed' && (
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => { void handleRetry(dep.id) }} title="Retry" aria-label={`Retry deployment ${displayId}`}><Play className="size-3.5" /></Button>
                          )}
                          {status !== 'pending' && status !== 'queued' && status !== 'building' && status !== 'deploying' && (
                            <Button variant="ghost" size="icon" className="size-7" onClick={() => { setDeleteId(dep.id); setDeleteOpen(true) }} title="Delete" aria-label={`Delete deployment ${displayId}`}><Trash2 className="size-3.5" /></Button>
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
            <Button variant="outline" onClick={() => { setCancelOpen(false); }}>Close</Button>
            <Button variant="destructive" onClick={() => { void handleCancel(); }} disabled={cancelDeployment.isPending}>{cancelDeployment.isPending ? 'Cancelling...' : 'Cancel Deployment'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback Dialog */}
      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rollback Deployment</DialogTitle><DialogDescription>Revert deployment <strong className="font-mono">{shortId(rollbackId ?? '')}</strong> to the previous version.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRollbackOpen(false); }}>Close</Button>
            <Button onClick={() => { void handleRollback(); }} disabled={rollbackDeployment.isPending}>{rollbackDeployment.isPending ? 'Rolling back...' : 'Rollback'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Delete Deployment</DialogTitle><DialogDescription>This permanently removes the deployment record <strong className="font-mono">{shortId(deleteId ?? '')}</strong>.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteOpen(false); }}>Cancel</Button>
            <Button variant="destructive" onClick={() => { void handleDelete(); }} disabled={deleteDeployment.isPending}>{deleteDeployment.isPending ? 'Deleting...' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
