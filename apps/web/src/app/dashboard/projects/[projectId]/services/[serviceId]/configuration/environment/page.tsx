'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useService, useUpdateService } from '@/domains/service/hooks'
import {
  useProjectVariableTemplates,
  useProjectServiceEnvironmentLinks,
  useUpsertServiceEnvironmentLink,
} from '@/domains/project/hooks'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Save, Plus, X, Globe, KeyRound, Rocket, LayoutTemplate, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { ENV_NAMES, type EnvName } from '@deployer/contracts-common'
import { PageSkeleton } from '@/components/dashboard'
import { InlineError } from '@/app/dashboard/projects/_components/workload/WorkloadStates'
import { ServiceConfigSubNav } from '../../_components/service-config-subnav'
import {
  AuthDashboardProjectsProjectIdConfigurationEnvironmentsEnvironmentId,
  AuthDashboardProjectsProjectIdServicesServiceIdDeployments,
} from '@/routes'

const ENV_META: Record<EnvName, { color: string; label: string }> = {
  production: { color: 'text-red-500', label: 'Production' },
  staging: { color: 'text-amber-500', label: 'Staging' },
  preview: { color: 'text-sky-500', label: 'Preview' },
  development: { color: 'text-emerald-500', label: 'Development' },
}

type ServiceData = NonNullable<ReturnType<typeof useService>['data']>

export default function DashboardServiceConfigurationEnvironmentPage() {
  const { projectId, serviceId } = useParams<{ projectId: string; serviceId: string }>()
  const query = useService(serviceId)

  if (query.isLoading) return <PageSkeleton blocks={3} withStrip={false} label="Loading service environment" />
  if (query.error) return <InlineError title="Could not load the service" error={query.error} onRetry={() => { void query.refetch() }} />
  if (!query.data) return <InlineError title="Service not found" error={new Error('This service does not exist or was deleted.')} />
  // Keyed so the variable list seeds once per service and a refetch never overwrites edits.
  return <EnvironmentForm key={query.data.id} projectId={projectId} serviceId={serviceId} service={query.data} />
}

function EnvironmentForm({ projectId, serviceId, service }: { projectId: string; serviceId: string; service: ServiceData }) {
  const { data: templatesData } = useProjectVariableTemplates(projectId)
  const { data: envLinksData } = useProjectServiceEnvironmentLinks(projectId)
  const upsertServiceEnvironmentLink = useUpsertServiceEnvironmentLink()
  const updateService = useUpdateService()

  const [editing, setEditing] = useState(false)
  const [editEnabledEnvs, setEditEnabledEnvs] = useState<EnvName[]>([])
  const [vars, setVars] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(service.environmentVariables ?? {}).map(([key, value]) => ({ key, value })),
  )
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  const templates = useMemo(() => templatesData?.templates ?? [], [templatesData])

  /**
   * Enabled environments come from the `service_environments` link rows — the
   * only place membership is actually persisted. The service entity has no
   * `enabledEnvironments` field, so the previous `?? ENV_NAMES` fallback read a
   * phantom property and answered "all four" for every service regardless of
   * configuration (and the save sent that same phantom key, which Zod stripped).
   */
  const envIdByName = useMemo(() => {
    const map = new Map<EnvName, string>()
    for (const link of envLinksData?.links ?? []) {
      if (link.serviceId !== serviceId) continue
      if ((ENV_NAMES as readonly string[]).includes(link.environmentName)) {
        map.set(link.environmentName as EnvName, link.environmentId)
      }
    }
    return map
  }, [envLinksData, serviceId])

  const enabledEnvs = useMemo<EnvName[]>(() => {
    const enabled = new Set<EnvName>()
    for (const link of envLinksData?.links ?? []) {
      if (link.serviceId !== serviceId || !link.isEnabled) continue
      if ((ENV_NAMES as readonly string[]).includes(link.environmentName)) {
        enabled.add(link.environmentName as EnvName)
      }
    }
    return ENV_NAMES.filter((env) => enabled.has(env))
  }, [envLinksData, serviceId])

  const handleSave = async () => {
    try {
      const envVars: Record<string, string> = {}
      for (const v of vars) { if (v.key.trim()) envVars[v.key.trim()] = v.value }

      // Membership is persisted on the link rows, not on the service.
      await Promise.all(
        ENV_NAMES.map(async (env) => {
          const environmentId = envIdByName.get(env)
          if (!environmentId) return
          const shouldBeEnabled = editEnabledEnvs.includes(env)
          const currentlyEnabled = enabledEnvs.includes(env)
          if (shouldBeEnabled === currentlyEnabled) return
          await upsertServiceEnvironmentLink.mutateAsync({
            params: { id: projectId },
            body: { serviceId, environmentId, isEnabled: shouldBeEnabled },
          })
        }),
      )

      await updateService.mutateAsync({ id: serviceId, environmentVariables: envVars })
      toast.success('Environment configuration saved')
      setEditing(false)
    } catch (err) {
      toast.error('Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const applyTemplate = (template: (typeof templates)[number]) => {
    setVars((prev) => {
      const map = new Map(prev.map((v) => [v.key, v.value]))
      for (const tv of template.variables) { if (tv.key.trim()) map.set(tv.key.trim(), tv.defaultValue ?? '') }
      return [...map.entries()].map(([key, value]) => ({ key, value }))
    })
    if (!editing) setEditing(true)
    toast.success('Template variables applied')
  }

  return (
    <div className="space-y-6">
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="environment" />

      {/* ── Environment cards ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="flex items-center gap-2 text-sm"><Globe className="size-4 text-muted-foreground" /> Environments</CardTitle><CardDescription className="text-xs">Deploy targets with per-env config links.</CardDescription></div>
          {editing
            ? <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { setEditing(false); setEditEnabledEnvs([...enabledEnvs]) }}>Cancel</Button><Button size="sm" onClick={() => { void handleSave() }} disabled={updateService.isPending}>{updateService.isPending ? 'Saving…' : 'Save'}</Button></div>
            : <Button size="sm" variant="outline" onClick={() => { setEditing(true); setEditEnabledEnvs([...enabledEnvs]) }}>Edit</Button>}
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ENV_NAMES.map((env) => {
              const meta = ENV_META[env]
              const enabled = (editing ? editEnabledEnvs : enabledEnvs).includes(env)
              return (
                <div key={env} className={`rounded-lg border bg-background/40 p-3 transition-opacity ${enabled ? '' : 'opacity-50'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`flex items-center gap-1.5 text-sm font-medium ${meta.color}`}>
                      <Globe className="size-3.5" /> {meta.label}
                    </span>
                    {editing ? (
                      <button
                        type="button"
                        onClick={() => { setEditEnabledEnvs((prev) => prev.includes(env) ? prev.filter((e) => e !== env) : [...prev, env]) }}
                        className={`rounded-md px-2 py-0.5 text-xs font-medium ${enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                      >
                        {enabled ? 'On' : 'Off'}
                      </button>
                    ) : (
                      <Badge variant={enabled ? 'default' : 'outline'} className="text-xs">{enabled ? 'enabled' : 'disabled'}</Badge>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button asChild size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-xs">
                      <AuthDashboardProjectsProjectIdConfigurationEnvironmentsEnvironmentId.Link projectId={projectId} environmentId={env}>
                        <KeyRound className="size-3" /> Config
                      </AuthDashboardProjectsProjectIdConfigurationEnvironmentsEnvironmentId.Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-xs">
                      <AuthDashboardProjectsProjectIdServicesServiceIdDeployments.Link projectId={projectId} serviceId={serviceId}>
                        <Rocket className="size-3" /> Deploy
                      </AuthDashboardProjectsProjectIdServicesServiceIdDeployments.Link>
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Variable templates ── */}
      {templates.length > 0 && (
        <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><LayoutTemplate className="size-4 text-muted-foreground" /> Variable templates</CardTitle><CardDescription className="text-xs">Apply project templates to this service.</CardDescription></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((t) => (
                <Button key={t.id} size="sm" variant="outline" className="gap-1 text-xs" onClick={() => { applyTemplate(t) }}>
                  <LayoutTemplate className="size-3" /> {t.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Environment variables ── */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><KeyRound className="size-4 text-muted-foreground" /> Environment variables</CardTitle><CardDescription className="text-xs">Injected into every deployment. Prefix <code className="font-mono">ENV_NAME</code> for per-env values.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {vars.length === 0 && <p className="text-sm text-muted-foreground">No environment variables defined.</p>}
          {/* Duplicate-key warning (last one wins on save) */}
          {(() => {
            const keys = vars.map((v) => v.key.trim()).filter(Boolean)
            const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))]
            if (dupes.length === 0) return null
            return (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Duplicate variable keys: {dupes.join(', ')} — the last value wins on save.
              </p>
            )
          })()}
          {vars.map((entry, i) => {
            const revealed = revealedKeys.has(entry.key)
            return (
              <div key={i} className="flex items-center gap-1.5">
                <Input value={entry.key} onChange={(e) => { const nv = [...vars]; if (nv[i]) { nv[i] = { ...nv[i], key: e.target.value }; setVars(nv) } }} placeholder="DATABASE_URL" className="h-8 w-64 font-mono text-xs" aria-label="Variable key" />
                <span className="text-muted-foreground">=</span>
                <Input
                  value={entry.value}
                  type={revealed ? 'text' : 'password'}
                  onChange={(e) => { const nv = [...vars]; if (nv[i]) { nv[i] = { ...nv[i], value: e.target.value }; setVars(nv) } }}
                  placeholder="value"
                  className="h-8 flex-1 font-mono text-xs"
                  aria-label={`Value for ${entry.key || 'variable'}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => {
                    setRevealedKeys((prev) => {
                      const next = new Set(prev)
                      if (revealed) next.delete(entry.key)
                      else if (entry.key) next.add(entry.key)
                      return next
                    })
                  }}
                  title={revealed ? 'Hide value' : 'Reveal value'}
                  aria-label={revealed ? 'Hide value' : 'Reveal value'}
                >
                  {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => { setVars(vars.filter((_, idx) => idx !== i)) }} aria-label="Remove variable"><X className="size-3.5" /></Button>
              </div>
            )
          })}
          <Button type="button" size="sm" variant="outline" className="h-7 w-fit gap-1 text-xs" onClick={() => { setVars([...vars, { key: '', value: '' }]) }}>
            <Plus className="size-3" /> Add variable
          </Button>
          <div className="pt-1">
            <Button size="sm" onClick={() => { void handleSave() }} disabled={updateService.isPending}>
              <Save className="mr-1.5 size-3.5" /> {updateService.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
