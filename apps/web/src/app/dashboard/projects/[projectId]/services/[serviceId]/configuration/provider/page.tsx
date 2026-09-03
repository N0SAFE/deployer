'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useState, useEffect, useMemo } from 'react'
import { useForm } from '@tanstack/react-form'
import { useParams } from 'next/navigation'
import { useService, useUpdateService } from '@/domains/service/hooks'
import { useAllProviders, useAllBuilders, useProviderSchema, useBuilderSchema, useCompatibleBuilders } from '@/domains/provider-schema/hooks'
import { useGitHubRepos } from '@/domains/github-apps/hooks'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Siren, Save, GitFork, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { AuthDashboardAdminProvidersCodeGithub } from '@/routes'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'
import { SearchableSelect } from '@/app/dashboard/projects/_components/steps/searchable-select'

/** A config schema field as returned by the provider-schema API. */
interface ConfigField {
  key: string
  label: string
  description?: string
  type: string
  required: boolean
  defaultValue?: unknown
  options?: { label: string; value: unknown }[]
  placeholder?: string
  ui?: Record<string, unknown>
}

/** A config schema as returned by the provider-schema API. */
interface ConfigSchemaType {
  id: string
  version: string
  title: string
  description: string
  fields: ConfigField[]
}

/** GitHub repository info from the OAuth-powered list endpoint. */
interface GitHubRepo {
  id: number
  full_name: string
  html_url: string
  default_branch: string
  description: string | null
  private: boolean
}

/** Repo picker shown when GitHub provider is selected and user is OAuth-connected. */
function GitHubRepoPicker({
  repos,
  isLoading,
  selectedUrl,
  onSelect,
}: {
  repos: GitHubRepo[]
  isLoading: boolean
  selectedUrl: string
  onSelect: (url: string, branch: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label>Repository</Label>
      <SearchableSelect
        value={selectedUrl}
        onChange={(val) => {
          const repo = repos.find((r) => r.html_url === val)
          if (repo) onSelect(repo.html_url, repo.default_branch)
        }}
        options={repos.map((repo) => ({
          value: repo.html_url,
          label: repo.full_name,
          description: repo.private ? 'Private repository' : repo.description ?? undefined,
          badge: repo.private ? 'private' : undefined,
        }))}
        placeholder={isLoading ? 'Loading repos…' : 'Search or select a repository…'}
        searchPlaceholder="Type to filter repositories…"
        emptyMessage="No repositories match."
      />
      {repos.length === 0 && !isLoading && (
        <div className="text-xs text-muted-foreground space-y-1">
          <p>No repositories found. Connect a GitHub App to access your repositories.</p>
          <AuthDashboardAdminProvidersCodeGithub.Link className="text-primary underline inline-flex items-center gap-1">
            Configure GitHub provider <ExternalLink className="size-3" />
          </AuthDashboardAdminProvidersCodeGithub.Link>
        </div>
      )}
    </div>
  )
}

function DynamicField({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (val: unknown) => void }) {
  const id = `field-${field.key}`
  const strVal = value !== null && value !== undefined ? String(value) : field.defaultValue !== undefined ? String(field.defaultValue) : ''
  const boolVal = value !== null && value !== undefined ? Boolean(value) : field.defaultValue !== undefined ? Boolean(field.defaultValue) : false

  switch (field.type) {
    case 'text':
    case 'url':
      return (
        <div className="space-y-1.5">
          <Label htmlFor={id}>{field.label}{field.required ? ' *' : ''}</Label>
          {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
          <Input id={id} type={field.type === 'url' ? 'url' : 'text'} value={strVal} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
        </div>
      )
    case 'boolean':
      return (
        <div className="flex items-center gap-3">
          <Switch id={id} checked={boolVal} onCheckedChange={onChange} />
          <Label htmlFor={id}>{field.label}</Label>
        </div>
      )
    case 'select': {
      const options = field.options ?? []
      return (
        <div className="space-y-1.5">
          <Label htmlFor={id}>{field.label}{field.required ? ' *' : ''}</Label>
          <Select value={strVal} onValueChange={(v) => { onChange(v) }}>
            <SelectTrigger id={id}><SelectValue placeholder={`Select ${field.label}`} /></SelectTrigger>
            <SelectContent>
              {options.map((opt: { label: string; value: unknown }) => (
                <SelectItem key={String(opt.value)} value={String(opt.value)}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }
    case 'json': {
      const raw = value ? JSON.stringify(value, null, 2) : (field.defaultValue ? JSON.stringify(field.defaultValue, null, 2) : '{}')
      return (
        <div className="space-y-1.5">
          <Label htmlFor={id}>{field.label}{field.required ? ' *' : ''}</Label>
          {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
          <textarea
            id={id}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono"
            value={raw}
            onChange={(e) => { try { onChange(JSON.parse(e.target.value)) } catch { /* keep valid */ } }}
            placeholder={field.placeholder ?? '{}'}
          />
        </div>
      )
    }
    default:
      return (
        <div className="space-y-1.5">
          <Label>{field.label}</Label>
          <Input value={strVal} disabled />
        </div>
      )
  }
}

function buildConfigFromFields(fields: ConfigField[], formValues: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  for (const f of fields) {
    const val = formValues[f.key]
    if (val !== undefined && val !== null && val !== '') {
      config[f.key] = val
    } else if (f.defaultValue !== undefined && f.defaultValue !== null && !(f.key in formValues)) {
      config[f.key] = f.defaultValue
    }
  }
  return config
}

const UI_TO_ENTITY: Record<string, string> = {
  repositoryUrl: 'sourceUrl',
  dockerfilePath: 'dockerfilePath',
  buildArgs: 'buildArgs',
  buildContext: 'buildContext',
}

export default function DashboardServiceConfigurationProviderPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId ?? ''
  const serviceId = params.serviceId ?? ''

  const { data: serviceData, isLoading: serviceLoading } = useService(serviceId)
  const updateService = useUpdateService()
  const { data: providersData, isLoading: providersLoading } = useAllProviders()
  const { data: buildersData, isLoading: buildersLoading } = useAllBuilders()

  const service = (serviceData ?? null) as Record<string, unknown> | null
  const providers = (providersData as { providers?: { id: string; name: string; description: string }[] })?.providers ?? []
  const builders = (buildersData as { builders?: { id: string; name: string; description: string }[] })?.builders ?? []

  const [editing, setEditing] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [selectedBuilderId, setSelectedBuilderId] = useState('')

  const { data: providerSchema, isLoading: schemaLoading } = useProviderSchema(selectedProviderId)
  const { data: builderSchema, isLoading: builderSchemaLoading } = useBuilderSchema(selectedBuilderId)
  const { data: compatibleBuildersData } = useCompatibleBuilders(selectedProviderId)
  const { data: gitHubReposData, isLoading: gitHubReposLoading } = useGitHubRepos()

  const compatibleBuilderIds = useMemo(() => {
    const data = compatibleBuildersData as { builders?: { id: string }[] } | undefined
    return new Set((data?.builders ?? []).map((b: { id: string }) => b.id))
  }, [compatibleBuildersData])

  const filteredBuilders = useMemo(() => {
    if (!selectedProviderId) return builders
    return builders.filter((b: { id: string }) => compatibleBuilderIds.has(b.id))
  }, [builders, selectedProviderId, compatibleBuilderIds])

  const gitHubRepos: GitHubRepo[] = useMemo(() => {
    const data = gitHubReposData as { repos?: GitHubRepo[] } | undefined
    return data?.repos ?? []
  }, [gitHubReposData])

  // TanStack Form for provider config
  const providerForm = useForm({
    defaultValues: {} as Record<string, unknown>,
    onSubmit: async ({ value }) => {
      await saveConfig(value, providerForm, builderForm)
    },
  })

  // TanStack Form for builder config
  const builderForm = useForm({
    defaultValues: {} as Record<string, unknown>,
    onSubmit: async ({ value }) => {
      await saveConfig(value, providerForm, builderForm)
    },
  })

  async function saveConfig(
    _value: Record<string, unknown>,
    pf: typeof providerForm,
    bf: typeof builderForm,
  ) {
    const pSchema = (providerSchema ?? { fields: [] }) as ConfigSchemaType
    const rawPC = buildConfigFromFields(pSchema.fields, pf.state.values)
    const providerConfig: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rawPC)) { providerConfig[UI_TO_ENTITY[k] ?? k] = v }

    const bSchema = (builderSchema ?? { fields: [] }) as ConfigSchemaType
    const rawBC = buildConfigFromFields(bSchema.fields, bf.state.values)
    const builderConfig: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rawBC)) { builderConfig[UI_TO_ENTITY[k] ?? k] = v }

    try {
      await (updateService as unknown as { mutateAsync: (input: Record<string, unknown>) => Promise<unknown> }).mutateAsync({
        id: serviceId,
        providerId: selectedProviderId || undefined,
        providerConfig: Object.keys(providerConfig).length > 0 ? providerConfig : null,
        builderId: selectedBuilderId || undefined,
        builderConfig: Object.keys(builderConfig).length > 0 ? builderConfig : null,
      })
      toast.success('Provider configuration saved')
      setEditing(false)
    } catch (err) {
      toast.error('Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  // Reset builder when provider changes
  useEffect(() => {
    if (editing) {
      setSelectedBuilderId('')
      builderForm.reset()
    }
  }, [selectedProviderId])

  // Sync provider form default values when schema loads
  useEffect(() => {
    if (providerSchema) {
      const schema = providerSchema as ConfigSchemaType
      const defaults: Record<string, unknown> = {}
      for (const f of schema.fields) {
        if (f.defaultValue !== undefined) defaults[f.key] = f.defaultValue
      }
      // Preserve existing service config values
      const pc = (service?.providerConfig ?? service?.provider_config) as Record<string, unknown> | null | undefined
      if (pc) {
        for (const [k, v] of Object.entries(pc)) {
          const uiKey = Object.entries(UI_TO_ENTITY).find(([, e]) => e === k)?.[0] ?? k
          defaults[uiKey] = v
        }
      }
      providerForm.reset(defaults)
    }
  }, [providerSchema])

  // Sync builder form default values when schema loads
  useEffect(() => {
    if (builderSchema) {
      const schema = builderSchema as ConfigSchemaType
      const defaults: Record<string, unknown> = {}
      for (const f of schema.fields) {
        if (f.defaultValue !== undefined) defaults[f.key] = f.defaultValue
      }
      const bc = (service?.builderConfig ?? service?.builder_config) as Record<string, unknown> | null | undefined
      if (bc) {
        for (const [k, v] of Object.entries(bc)) {
          defaults[k] = v
        }
      }
      builderForm.reset(defaults)
    }
  }, [builderSchema])

  function GitHubRepoPickerWrapper({ repoUrl, branch, onSelectRepo }: { repoUrl: string; branch: string; onSelectRepo: (url: string, branch: string) => void }) {
    return (
      <GitHubRepoPicker
        repos={gitHubRepos}
        isLoading={gitHubReposLoading}
        selectedUrl={repoUrl}
        onSelect={onSelectRepo}
      />
    )
  }

  const startEditing = () => {
    const cp = String(service?.providerId ?? service?.provider_type ?? '')
    const cb = String(service?.builderId ?? service?.runnerType ?? service?.runner_type ?? '')
    setSelectedProviderId(cp)
    setSelectedBuilderId(cb)
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setSelectedProviderId('')
    setSelectedBuilderId('')
    providerForm.reset({})
    builderForm.reset({})
  }

  const isSaving = updateService.isPending

  const isLoading = serviceLoading || providersLoading || buildersLoading
  if (isLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>
  if (!service) return <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Not found</AlertTitle><AlertDescription>Service not found.</AlertDescription></Alert>

  const cp = String(service.providerId ?? service.provider_type ?? '')
  const cb = String(service.builderId ?? service.runnerType ?? service.runner_type ?? '')
  const pm = providers.find((p: { id: string }) => p.id === cp)
  const bm = builders.find((b: { id: string }) => b.id === cb)

  return (
    <div className="space-y-6">
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="provider" />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Provider &amp; Runner</CardTitle>
            <CardDescription>Select a source provider and a build runner for <strong>{String(service.name ?? serviceId)}</strong>.</CardDescription>
          </div>
          {editing ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={cancelEditing}>Cancel</Button>
              <Button size="sm" onClick={() => { providerForm.handleSubmit(); builderForm.handleSubmit(); }} disabled={isSaving || schemaLoading || builderSchemaLoading}>
                {isSaving ? 'Saving...' : <><Save className="mr-1 size-4" />Save</>}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={startEditing}>Edit</Button>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <Label className="text-base font-medium">Provider</Label>
              {editing ? (
                <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                  <SelectTrigger><SelectValue placeholder="Select a provider" /></SelectTrigger>
                  <SelectContent>
                    {providers.map((p: { id: string; name: string; description: string }) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span>{p.name} <span className="text-xs text-muted-foreground">— {p.description}</span></span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : pm ? (
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="px-3 py-1">{pm.name}</Badge>
                  <span className="text-xs text-muted-foreground">{pm.description}</span>
                </div>
              ) : cp ? <Badge variant="outline">{cp}</Badge> : <p className="text-sm text-muted-foreground">Not configured</p>}
            </div>
            <div className="space-y-3">
              <Label className="text-base font-medium">Builder / Runner</Label>
              {editing ? (
                <Select value={selectedBuilderId} onValueChange={setSelectedBuilderId} disabled={!selectedProviderId}>
                  <SelectTrigger><SelectValue placeholder={selectedProviderId ? 'Select a builder' : 'Select a provider first'} /></SelectTrigger>
                  <SelectContent>
                    {filteredBuilders.map((b: { id: string; name: string; description: string }) => (
                      <SelectItem key={b.id} value={b.id}>
                        <span>{b.name} <span className="text-xs text-muted-foreground">— {b.description}</span></span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : bm ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="px-3 py-1">{bm.name}</Badge>
                  <span className="text-xs text-muted-foreground">{bm.description}</span>
                </div>
              ) : cb ? <Badge variant="outline">{cb}</Badge> : <p className="text-sm text-muted-foreground">Not configured</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {cp && <Badge variant="outline">Provider: {cp}</Badge>}
            {cb && <Badge variant="outline">Builder: {cb}</Badge>}
          </div>
        </CardContent>
      </Card>

      {editing && selectedProviderId && providerSchema && (
        <Card>
          <CardHeader>
            <CardTitle>{(providerSchema as ConfigSchemaType).title}</CardTitle>
            <CardDescription>{(providerSchema as ConfigSchemaType).description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Show GitHub repo picker when GitHub provider is selected */}
            {selectedProviderId === 'github' && (
              <providerForm.Field name="repositoryUrl">
                {(field) => (
                  <GitHubRepoPickerWrapper
                    repoUrl={(field.state.value as string) ?? ''}
                    branch={(providerForm.store.state.values.branch as string) ?? 'main'}
                    onSelectRepo={(url, branch) => {
                      field.handleChange(url)
                      providerForm.setFieldValue('branch', branch)
                    }}
                  />
                )}
              </providerForm.Field>
            )}
            {/* Render remaining fields (skip repositoryUrl for GitHub, it's handled above) */}
            {(providerSchema as ConfigSchemaType).fields
              .filter((f) => !(selectedProviderId === 'github' && f.key === 'repositoryUrl'))
              .map((fieldDef: ConfigField) => (
                <providerForm.Field key={fieldDef.key} name={fieldDef.key}>
                  {(field) => (
                    <DynamicField
                      field={fieldDef}
                      value={field.state.value}
                      onChange={(val) => field.handleChange(val)}
                    />
                  )}
                </providerForm.Field>
              ))}
          </CardContent>
        </Card>
      )}

      {editing && selectedBuilderId && builderSchema && (
        <Card>
          <CardHeader>
            <CardTitle>{(builderSchema as ConfigSchemaType).title}</CardTitle>
            <CardDescription>{(builderSchema as ConfigSchemaType).description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(builderSchema as ConfigSchemaType).fields.map((fieldDef: ConfigField) => (
              <builderForm.Field key={fieldDef.key} name={fieldDef.key}>
                {(field) => (
                  <DynamicField
                    field={fieldDef}
                    value={field.state.value}
                    onChange={(val) => field.handleChange(val)}
                  />
                )}
              </builderForm.Field>
            ))}
          </CardContent>
        </Card>
      )}

      {!editing && (
        <Card>
          <CardHeader>
            <CardTitle>Current Configuration</CardTitle>
            <CardDescription>Provider and builder settings for this service.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <Label>Provider Config</Label>
                <pre className="mt-1 rounded-md bg-muted p-3 text-xs font-mono overflow-auto max-h-32">
                  {JSON.stringify(service.providerConfig ?? service.provider_config ?? null, null, 2)}
                </pre>
              </div>
              <div>
                <Label>Builder Config</Label>
                <pre className="mt-1 rounded-md bg-muted p-3 text-xs font-mono overflow-auto max-h-32">
                  {JSON.stringify(service.builderConfig ?? service.builder_config ?? null, null, 2)}
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
