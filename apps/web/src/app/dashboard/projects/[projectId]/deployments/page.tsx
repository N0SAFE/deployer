'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Rocket, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useDeploymentFilters } from '../_hooks/use-project-filters'
import {
  useTriggerDeployment, useCancelDeployment, useRollbackDeployment, useRetryDeployment, useDeleteDeployment, useDeploymentList,
} from '@/domains/deployment/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { useProjectEnvironments } from '@/domains/project/hooks'
import { filterProjectTopLevelServices } from '@/domains/service/hierarchy'
import { useNow } from '@/components/dashboard/use-now'
import { EmptyState, FilteredEmptyState } from '@/components/dashboard'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { ListLoading, InlineError, SectionHeading, errorReason } from '../../_components/workload/WorkloadStates'
import { findRollbackTarget } from '../../_utils/workload'
import { filterDeployments, sortDeployments, hasActiveFilters, type StatusFilter } from '../../_utils/deployment-list'
import { buildTriggerSource } from '../../_utils/trigger-source'
import { ProjectDeploymentsTable, type ProjectDeploymentRow, type RowAction } from './_components/project-deployments-table'
import { ConfirmDialog } from './_components/confirm-dialog'
import { TriggerDialog, type TriggerChoice } from './_components/trigger-dialog'

const COPY: Record<RowAction, { title: string; body: string; confirm: string; destructive: boolean; done: string }> = {
  cancel: { title: 'Cancel this run?', body: 'The run is stopped where it is. Nothing is rolled back automatically.', confirm: 'Cancel run', destructive: true, done: 'Run cancelled' },
  rollback: { title: 'Roll back to the previous successful run?', body: 'The service is redeployed from the most recent earlier successful run in the same environment.', confirm: 'Roll back', destructive: false, done: 'Rollback started' },
  retry: { title: 'Retry this run?', body: 'Starts a new run from the same source.', confirm: 'Retry run', destructive: false, done: 'Run queued again' },
  delete: { title: 'Delete this deployment record?', body: 'Only the history entry is removed. Whatever is currently running is not touched. This cannot be undone.', confirm: 'Delete record', destructive: true, done: 'Record deleted' },
}

export default function ProjectDeploymentsPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId
  const now = useNow(30_000)
  const { filters, setFilters } = useDeploymentFilters()

  const deploymentsQuery = useDeploymentList({
    query: { filter: { projectId: { operator: 'eq' as const, value: projectId } }, limit: 100, offset: 0 },
  })
  const servicesQuery = useServiceList({ query: { limit: 100, offset: 0 } })
  const environmentsQuery = useProjectEnvironments(projectId)
  const trigger = useTriggerDeployment()
  const cancel = useCancelDeployment()
  const rollback = useRollbackDeployment()
  const retry = useRetryDeployment()
  const remove = useDeleteDeployment()

  const [triggerOpen, setTriggerOpen] = useState(false)
  const [pending, setPending] = useState<{ action: RowAction; row: ProjectDeploymentRow } | null>(null)

  const deployments = useMemo(() => deploymentsQuery.data?.data ?? [], [deploymentsQuery.data])
  const services = useMemo(
    () => filterProjectTopLevelServices(servicesQuery.data?.data ?? [], projectId),
    [servicesQuery.data, projectId],
  )
  const serviceNames = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services])
  const environments = environmentsQuery.data?.environments ?? []
  const nameOf = useMemo(() => (id: string) => serviceNames.get(id) ?? '', [serviceNames])

  const f = { search: filters.q, status: filters.status, environment: filters.environment, serviceId: filters.service }
  const rows = useMemo(
    () => sortDeployments(filterDeployments(deployments, { search: filters.q, status: filters.status, environment: filters.environment, serviceId: filters.service }, nameOf), 'newest', nameOf),
    [deployments, filters.q, filters.status, filters.environment, filters.service, nameOf],
  )
  const environmentNames = useMemo(
    () => Array.from(new Set(deployments.map((d) => d.environment).filter((e): e is NonNullable<typeof e> => Boolean(e)))).sort(),
    [deployments],
  )

  const clearFilters = () => { setFilters({ status: 'all', environment: 'all', service: 'all', q: '' }) }
  const rollbackTargetOf = (row: ProjectDeploymentRow) => findRollbackTarget(deployments, row)

  const handleTrigger = async (choice: TriggerChoice) => {
    const svc = services.find((s) => s.id === choice.serviceId)
    if (!svc) { toast.error('That service no longer exists'); return }
    const environment = choice.environment as 'production' | 'staging' | 'preview' | 'development'
    try {
      await trigger.mutateAsync({ serviceId: svc.id, environment, source: buildTriggerSource(svc.providerId, svc.providerConfig) })
      toast.success(`Deployment of ${svc.name} started`)
      setTriggerOpen(false)
    } catch (err) {
      toast.error('Could not start the deployment', { description: errorReason(err) })
    }
  }

  const runAction = async () => {
    if (!pending) return
    const { action, row } = pending
    try {
      if (action === 'cancel') await cancel.mutateAsync({ params: { id: row.id } })
      else if (action === 'retry') await retry.mutateAsync({ params: { id: row.id } })
      else if (action === 'delete') await remove.mutateAsync({ params: { id: row.id } })
      else {
        const target = rollbackTargetOf(row)
        if (!target) { toast.error('No earlier successful run to roll back to'); setPending(null); return }
        await rollback.mutateAsync({ params: { id: row.id }, body: { targetDeploymentId: target.id } })
      }
      toast.success(COPY[action].done)
      setPending(null)
    } catch (err) {
      toast.error(`${COPY[action].confirm} failed`, { description: errorReason(err) })
    }
  }

  const busy = cancel.isPending || rollback.isPending || retry.isPending || remove.isPending
  const filtered = hasActiveFilters(f)
  const deployButton = (
    <Button size="sm" onClick={() => { setTriggerOpen(true) }} disabled={services.length === 0}>
      <Rocket className="mr-1.5 size-4" />
      Deploy a service
    </Button>
  )

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Deployments"
        description="Every deployment run of this project’s services, newest first."
        actions={deployButton}
      />

      {deploymentsQuery.isError ? (
        <InlineError title="Could not load deployments" error={deploymentsQuery.error} onRetry={() => void deploymentsQuery.refetch()} />
      ) : null}
      {servicesQuery.isError ? (
        <InlineError title="Could not load services" error={servicesQuery.error} onRetry={() => void servicesQuery.refetch()} />
      ) : null}

      {deploymentsQuery.isLoading ? (
        <ListLoading label="Loading deployments" waitingOn="the deployment history" columns={6} />
      ) : deploymentsQuery.isError ? null : deployments.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="No deployments yet"
          description={services.length === 0
            ? 'This project has no services to deploy. Create a service first.'
            : 'Choose “Deploy a service” to start the first run.'}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Runs</CardTitle>
            <CardDescription>
              {rows.length} of {deployments.length} shown
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-52 flex-1 md:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filters.q}
                  onChange={(e) => { setFilters({ q: e.target.value }) }}
                  placeholder="Search service or id"
                  className="pl-9"
                  aria-label="Search deployments"
                />
              </div>
              <Select value={filters.status} onValueChange={(v) => { setFilters({ status: v as StatusFilter }) }}>
                <SelectTrigger className="w-40" aria-label="Filter by status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="in-progress">In progress</SelectItem>
                  <SelectItem value="success">Succeeded</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filters.environment} onValueChange={(v) => { setFilters({ environment: v }) }}>
                <SelectTrigger className="w-44" aria-label="Filter by environment"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All environments</SelectItem>
                  {environmentNames.map((env) => (<SelectItem key={env} value={env} className="capitalize">{env}</SelectItem>))}
                </SelectContent>
              </Select>
              <Select value={filters.service} onValueChange={(v) => { setFilters({ service: v }) }}>
                <SelectTrigger className="w-44" aria-label="Filter by service"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {services.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
                </SelectContent>
              </Select>
              {filtered ? <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button> : null}
            </div>

            {rows.length === 0 ? (
              <FilteredEmptyState label="No deployment matches these filters." onClear={clearFilters} />
            ) : (
              <ProjectDeploymentsTable
                rows={rows}
                projectId={projectId}
                serviceNames={serviceNames}
                canRollback={(row) => rollbackTargetOf(row) !== null}
                now={now}
                busy={busy}
                onAction={(action, row) => { setPending({ action, row }) }}
              />
            )}
          </CardContent>
        </Card>
      )}

      {triggerOpen ? (
        <TriggerDialog
          services={services}
          environments={environments}
          pending={trigger.isPending}
          onSubmit={(choice) => void handleTrigger(choice)}
          onClose={() => { setTriggerOpen(false) }}
        />
      ) : null}
      {pending ? (
        <ConfirmDialog
          title={COPY[pending.action].title}
          description={`${serviceNames.get(pending.row.serviceId) ?? 'Sub-service'} · ${pending.row.environment ?? 'unknown environment'}. ${COPY[pending.action].body}`}
          confirmLabel={COPY[pending.action].confirm}
          destructive={COPY[pending.action].destructive}
          pending={busy}
          onConfirm={() => void runAction()}
          onClose={() => { setPending(null) }}
        />
      ) : null}
    </div>
  )
}
