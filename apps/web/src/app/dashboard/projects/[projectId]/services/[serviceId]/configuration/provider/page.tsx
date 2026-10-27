'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from '@/lib/orpc/typed-errors'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useParams } from 'next/navigation'
import { useService, useUpdateService } from '@/domains/service/hooks'
import { useAllProviders, useAllBuilders, useProviderSchema, useBuilderSchema, useCompatibleBuilders } from '@/domains/provider-schema/hooks'
import { useGitHubRepos } from '@/domains/github-apps/hooks'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { PageSkeleton } from '@/components/dashboard'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'
import { InlineError } from '@/app/dashboard/projects/_components/workload/WorkloadStates'
import { DynamicField } from '@/app/dashboard/projects/_components/provider-config/DynamicField'
import { GitHubRepoPicker, type GitHubRepo } from '@/app/dashboard/projects/_components/provider-config/GitHubRepoPicker'
import {
  buildConfigFromFields,
  entityToUiKey,
  initialFormValues,
  toEntityConfig,
} from '@/app/dashboard/projects/_components/provider-config/config-fields'

type UpdateInput = Parameters<ReturnType<typeof useUpdateService>['mutateAsync']>[0]

export default function DashboardServiceConfigurationProviderPage() {
  const { projectId, serviceId } = useParams<{ projectId: string; serviceId: string }>()

  const serviceQuery = useService(serviceId)
  const updateService = useUpdateService()
  const providersQuery = useAllProviders()
  const buildersQuery = useAllBuilders()

  const service = serviceQuery.data
  const providers = useMemo(() => providersQuery.data?.providers ?? [], [providersQuery.data])
  const builders = useMemo(() => buildersQuery.data?.builders ?? [], [buildersQuery.data])

  const [editing, setEditing] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedBuilderId, setSelectedBuilderId] = useState('')

  const { data: providerSchema, isLoading: schemaLoading } = useProviderSchema(selectedProviderId)
  const { data: builderSchema, isLoading: builderSchemaLoading } = useBuilderSchema(selectedBuilderId)
  const { data: compatibleBuildersData } = useCompatibleBuilders(selectedProviderId)
  const { data: gitHubReposData, isLoading: gitHubReposLoading } = useGitHubRepos()

  const compatibleBuilderIds = useMemo(
    () => new Set((compatibleBuildersData?.builders ?? []).map((b) => b.id)),
    [compatibleBuildersData],
  )
  const filteredBuilders = useMemo(
    () => (selectedProviderId ? builders.filter((b) => compatibleBuilderIds.has(b.id)) : builders),
    [builders, selectedProviderId, compatibleBuilderIds],
  )
  const gitHubRepos = useMemo<GitHubRepo[]>(() => gitHubReposData?.repos ?? [], [gitHubReposData])

  const saveConfig = async () => {
    const providerConfig = toEntityConfig(buildConfigFromFields(providerSchema?.fields ?? [], providerForm.state.values))
    const builderConfig = toEntityConfig(buildConfigFromFields(builderSchema?.fields ?? [], builderForm.state.values))
    try {
      await updateService.mutateAsync({
        id: serviceId,
        // The config shape is chosen at runtime by the provider/builder schema the
        // API served, so it cannot be statically typed to the contract's per-provider
        // unions. The server validates it; these four assertions are the one boundary.
        providerId: (selectedProviderId || undefined) as UpdateInput['providerId'],
        providerConfig: (Object.keys(providerConfig).length > 0 ? providerConfig : null) as UpdateInput['providerConfig'],
        builderId: (selectedBuilderId || undefined) as UpdateInput['builderId'],
        builderConfig: (Object.keys(builderConfig).length > 0 ? builderConfig : null) as UpdateInput['builderConfig'],
      })
      toast.success('Provider configuration saved')
      setEditing(false)
    } catch (err) {
      toast.error('Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const providerForm = useForm({ defaultValues: {}, onSubmit: saveConfig })
  const builderForm = useForm({ defaultValues: {}, onSubmit: saveConfig })

  // Seed each form when its schema arrives: schema defaults overlaid with what is already persisted.
  const persistedProviderConfig = service?.providerConfig
  const persistedBuilderConfig = service?.builderConfig
  useEffect(() => {
    if (providerSchema) providerForm.reset(initialFormValues(providerSchema.fields, persistedProviderConfig, entityToUiKey))
  }, [providerSchema, persistedProviderConfig, providerForm])
  useEffect(() => {
    if (builderSchema) builderForm.reset(initialFormValues(builderSchema.fields, persistedBuilderConfig))
  }, [builderSchema, persistedBuilderConfig, builderForm])

  const startEditing = () => {
    setSelectedProviderId(service?.providerId ?? '')
    setSelectedBuilderId(service?.builderId ?? '')
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setSelectedProviderId('')
    setSelectedBuilderId('')
    providerForm.reset({})
    builderForm.reset({})
  }

  // Changing the provider invalidates the chosen builder (it may not be compatible).
  const changeProvider = (id: string) => {
    setSelectedProviderId(id)
    setSelectedBuilderId('')
    builderForm.reset({})
  }

  const isLoading = serviceQuery.isLoading || providersQuery.isLoading || buildersQuery.isLoading
  if (isLoading) return <PageSkeleton blocks={2} withStrip={false} label="Loading provider configuration" />
  const loadError = serviceQuery.error ?? providersQuery.error ?? buildersQuery.error
  if (loadError) {
    return (
      <InlineError
        title="Could not load the provider configuration"
        error={loadError}
        onRetry={() => { void serviceQuery.refetch(); void providersQuery.refetch(); void buildersQuery.refetch() }}
      />
    )
  }
  if (!service) return <InlineError title="Service not found" error={new Error('This service does not exist or was deleted.')} />

  const currentProvider = providers.find((p) => p.id === service.providerId)
  const currentBuilder = builders.find((b) => b.id === service.builderId)

  return (
    <div className="space-y-6">
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="provider" />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Provider &amp; runner</CardTitle>
            <CardDescription>Select a source provider and a build runner for <strong>{service.name}</strong>.</CardDescription>
          </div>
          {editing ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={cancelEditing} disabled={updateService.isPending}>Cancel</Button>
              <Button
                size="sm"
                onClick={() => { void providerForm.handleSubmit() }}
                disabled={updateService.isPending || schemaLoading || builderSchemaLoading}
              >
                {updateService.isPending ? 'Saving…' : <><Save className="mr-1 size-4" />Save changes</>}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={startEditing}>Edit</Button>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <Label className="text-base font-medium">Provider</Label>
              {editing ? (
                <Select value={selectedProviderId} onValueChange={changeProvider}>
                  <SelectTrigger aria-label="Provider"><SelectValue placeholder="Select a provider" /></SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span>{p.name} <span className="text-sm text-muted-foreground">— {p.description}</span></span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : currentProvider ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default" className="px-3 py-1">{currentProvider.name}</Badge>
                  <span className="text-sm text-muted-foreground">{currentProvider.description}</span>
                </div>
              ) : <Badge variant="outline">{service.providerId}</Badge>}
            </div>
            <div className="space-y-3">
              <Label className="text-base font-medium">Builder / runner</Label>
              {editing ? (
                <Select value={selectedBuilderId} onValueChange={setSelectedBuilderId} disabled={!selectedProviderId}>
                  <SelectTrigger aria-label="Builder"><SelectValue placeholder={selectedProviderId ? 'Select a builder' : 'Select a provider first'} /></SelectTrigger>
                  <SelectContent>
                    {filteredBuilders.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        <span>{b.name} <span className="text-sm text-muted-foreground">— {b.description}</span></span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : currentBuilder ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="px-3 py-1">{currentBuilder.name}</Badge>
                  <span className="text-sm text-muted-foreground">{currentBuilder.description}</span>
                </div>
              ) : <Badge variant="outline">{service.builderId}</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>

      {editing && selectedProviderId && providerSchema ? (
        <Card>
          <CardHeader>
            <CardTitle>{providerSchema.title}</CardTitle>
            <CardDescription>{providerSchema.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedProviderId === 'github' ? (
              <providerForm.Field name="repositoryUrl">
                {(field) => (
                  <GitHubRepoPicker
                    repos={gitHubRepos}
                    isLoading={gitHubReposLoading}
                    selectedUrl={typeof field.state.value === 'string' ? field.state.value : ''}
                    onSelect={(url, branch) => {
                      field.handleChange(url)
                      providerForm.setFieldValue('branch', branch)
                    }}
                  />
                )}
              </providerForm.Field>
            ) : null}
            {providerSchema.fields
              .filter((f) => !(selectedProviderId === 'github' && f.key === 'repositoryUrl'))
              .map((fieldDef) => (
                <providerForm.Field key={fieldDef.key} name={fieldDef.key}>
                  {(field) => <DynamicField field={fieldDef} value={field.state.value} onChange={(val) => { field.handleChange(val) }} />}
                </providerForm.Field>
              ))}
          </CardContent>
        </Card>
      ) : null}

      {editing && selectedBuilderId && builderSchema ? (
        <Card>
          <CardHeader>
            <CardTitle>{builderSchema.title}</CardTitle>
            <CardDescription>{builderSchema.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {builderSchema.fields.map((fieldDef) => (
              <builderForm.Field key={fieldDef.key} name={fieldDef.key}>
                {(field) => <DynamicField field={fieldDef} value={field.state.value} onChange={(val) => { field.handleChange(val) }} />}
              </builderForm.Field>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {editing ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Current configuration</CardTitle>
            <CardDescription>Provider and builder settings stored for this service.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
              <div>
                <Label>Provider config</Label>
                <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-muted p-3 font-mono text-sm">{JSON.stringify(service.providerConfig, null, 2)}</pre>
              </div>
              <div>
                <Label>Builder config</Label>
                <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-muted p-3 font-mono text-sm">{JSON.stringify(service.builderConfig, null, 2)}</pre>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
