'use client'

import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { PageSkeleton } from '@/components/dashboard'
import { getErrorMessage, isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import {
  useCloneProjectEnvironment,
  useCreateProjectEnvironment,
  useDeleteProjectEnvironment,
  useProjectEnvironments,
  useProjectEnvironmentStatus,
  useProjectServiceEnvironmentLinks,
  useProjectVariableTemplates,
  useRefreshProjectEnvironmentStatus,
  useUpdateProjectEnvironment,
  useUpsertServiceEnvironmentLink,
} from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { ConfirmDialog } from '../../_components/ConfirmDialog'
import { InlineError } from '../../_components/workload/WorkloadStates'
import { EnvironmentFormDialog, type EnvironmentFormValues } from '../../_components/environments/EnvironmentFormDialog'
import { EnvironmentsTable } from '../../_components/environments/EnvironmentsTable'
import { ServiceEnvironmentMatrix } from '../../_components/environments/ServiceEnvironmentMatrix'
import { VariableTemplatesCard } from '../../_components/environments/VariableTemplatesCard'
import { envLinkKey, type ProjectEnvironment, type ServiceEnvLink } from '../../_components/environments/types'

type EnvDialog =
  | { kind: 'create' }
  | { kind: 'edit'; env: ProjectEnvironment }
  | { kind: 'clone'; env: ProjectEnvironment }
  | { kind: 'delete'; env: ProjectEnvironment }
  | null

const errDescription = (err: unknown): string => (isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE)

/**
 * Project Environments
 *
 * Environments are first-class primitives: free-form name + KIND
 * (stable | preview | ephemeral) + per-env rules + optional trigger.
 * Also owns the Service × Environment matrix (which services are active
 * in which environment) and reusable variable templates.
 */
export default function DashboardProjectEnvironmentsPage() {
  const { projectId } = useParams<{ projectId: string }>()

  const envsQuery = useProjectEnvironments(projectId)
  const { data: envStatusesData } = useProjectEnvironmentStatus(projectId)
  const { data: envLinksData } = useProjectServiceEnvironmentLinks(projectId)
  const { data: servicesData } = useServiceList({ query: { limit: 100, offset: 0 } })
  const { data: variableTemplatesData } = useProjectVariableTemplates(projectId)

  const createEnvironment = useCreateProjectEnvironment()
  const updateEnvironment = useUpdateProjectEnvironment()
  const deleteEnvironment = useDeleteProjectEnvironment()
  const cloneEnvironment = useCloneProjectEnvironment()
  const upsertLink = useUpsertServiceEnvironmentLink()
  const refreshStatus = useRefreshProjectEnvironmentStatus()

  const [dialog, setDialog] = useState<EnvDialog>(null)
  const closeDialog = () => { setDialog(null) }
  const [pendingLinkKeys, setPendingLinkKeys] = useState<ReadonlySet<string>>(new Set())

  const environments = useMemo(() => envsQuery.data?.environments ?? [], [envsQuery.data])

  const statusById = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of envStatusesData?.statuses ?? []) map.set(s.environmentId, s.status)
    return map
  }, [envStatusesData])

  const projectServices = useMemo(
    () => (servicesData?.data ?? []).filter((s) => s.projectId === projectId),
    [servicesData, projectId],
  )

  const links = useMemo(() => {
    const map = new Map<string, ServiceEnvLink>()
    for (const l of envLinksData?.links ?? []) map.set(envLinkKey(l.serviceId, l.environmentId), l)
    return map
  }, [envLinksData])

  const templates = useMemo(() => variableTemplatesData?.templates ?? [], [variableTemplatesData])

  const toggleLink = useCallback(async (serviceId: string, environmentId: string, enabled: boolean) => {
    const key = envLinkKey(serviceId, environmentId)
    setPendingLinkKeys((prev) => new Set(prev).add(key))
    try {
      await upsertLink.mutateAsync({ params: { id: projectId }, body: { serviceId, environmentId, isEnabled: enabled } })
      toast.success(enabled ? 'Service enabled in environment' : 'Service disabled in environment')
    } catch (err) {
      toast.error('Failed to update link', { description: errDescription(err) })
    } finally {
      setPendingLinkKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }, [upsertLink, projectId])

  const submitEnvironment = async (values: EnvironmentFormValues) => {
    if (!dialog || dialog.kind === 'delete') return
    const description = values.description || undefined
    try {
      if (dialog.kind === 'create') {
        await createEnvironment.mutateAsync({ params: { id: projectId }, body: { name: values.name.trim(), kind: values.kind, description } })
        toast.success('Environment created')
      } else if (dialog.kind === 'edit') {
        await updateEnvironment.mutateAsync({ params: { id: projectId, environmentId: dialog.env.id }, body: { name: values.name.trim(), kind: values.kind, description } })
        toast.success('Environment updated')
      } else {
        await cloneEnvironment.mutateAsync({ params: { id: projectId, environmentId: dialog.env.id }, body: { name: values.name.trim(), kind: values.kind } })
        toast.success('Environment cloned')
      }
      closeDialog()
    } catch (err) {
      const verb = dialog.kind === 'create' ? 'create' : dialog.kind === 'edit' ? 'update' : 'clone'
      toast.error(`Failed to ${verb} environment`, { description: errDescription(err) })
    }
  }

  const confirmDelete = async (env: ProjectEnvironment) => {
    try {
      await deleteEnvironment.mutateAsync({ params: { id: projectId, environmentId: env.id } })
      toast.success('Environment deleted')
      closeDialog()
    } catch (err) {
      toast.error('Failed to delete environment', { description: errDescription(err) })
    }
  }

  if (envsQuery.isLoading) return <PageSkeleton blocks={3} withStrip={false} label="Loading environments" />

  if (envsQuery.error) {
    return (
      <InlineError
        title="Could not load environments"
        error={envsQuery.error}
        onRetry={() => { void envsQuery.refetch() }}
      />
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Environments</CardTitle>
            <CardDescription>
              Where this project deploys to. Stable environments are long-lived, preview environments follow a branch or PR, ephemeral ones are short-lived. Each can carry its own variables and settings.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => { void envsQuery.refetch() }} title="Refresh environments" aria-label="Refresh environments">
              <RefreshCw className="size-4" />
            </Button>
            <Button size="sm" onClick={() => { setDialog({ kind: 'create' }) }}><Plus className="mr-2 size-4" />Add environment</Button>
          </div>
        </CardHeader>
        <CardContent>
          <EnvironmentsTable
            environments={environments}
            statusById={statusById}
            refreshing={refreshStatus.isPending}
            onRefreshStatus={(env) => {
              void refreshStatus
                .mutateAsync({ params: { id: projectId, environmentId: env.id } })
                .catch((err: unknown) => { toast.error('Failed to refresh status', { description: errDescription(err) }) })
            }}
            onEdit={(env) => { setDialog({ kind: 'edit', env }) }}
            onClone={(env) => { setDialog({ kind: 'clone', env }) }}
            onDelete={(env) => { setDialog({ kind: 'delete', env }) }}
            onCreate={() => { setDialog({ kind: 'create' }) }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Services per environment</CardTitle>
          <CardDescription>Choose which services deploy in which environment. Sub-services inherit their parent&apos;s configuration unless overridden per link.</CardDescription>
        </CardHeader>
        <CardContent>
          <ServiceEnvironmentMatrix
            environments={environments}
            services={projectServices}
            links={links}
            pendingKeys={pendingLinkKeys}
            onToggle={(serviceId, environmentId, enabled) => { void toggleLink(serviceId, environmentId, enabled) }}
          />
        </CardContent>
      </Card>

      <VariableTemplatesCard projectId={projectId} templates={templates} />

      {dialog && dialog.kind !== 'delete' ? (
        <EnvironmentFormDialog
          key={`${dialog.kind}-${dialog.kind === 'create' ? 'new' : dialog.env.id}`}
          mode={dialog.kind}
          initial={
            dialog.kind === 'create'
              ? { name: '', kind: 'stable', description: '' }
              : dialog.kind === 'edit'
                ? { name: dialog.env.name, kind: dialog.env.kind, description: dialog.env.description ?? '' }
                : { name: `${dialog.env.name} (clone)`, kind: dialog.env.kind, description: '' }
          }
          pending={createEnvironment.isPending || updateEnvironment.isPending || cloneEnvironment.isPending}
          onSubmit={submitEnvironment}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title="Delete environment"
          objectName={dialog.env.name}
          consequence="the environment and its configuration are removed from this project. This cannot be undone."
          confirmLabel="Delete environment"
          pending={deleteEnvironment.isPending}
          onClose={closeDialog}
          onConfirm={() => { void confirmDelete(dialog.env) }}
        />
      ) : null}
    </div>
  )
}
