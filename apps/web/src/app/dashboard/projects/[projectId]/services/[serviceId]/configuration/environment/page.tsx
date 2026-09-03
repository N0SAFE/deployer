'use client'

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";
import { useMemo, useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useService, useUpdateService } from '@/domains/service/hooks'
import { useProjectVariableTemplates } from '@/domains/project/hooks'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Siren, Save, Plus, X, Globe, KeyRound, Rocket, LayoutTemplate, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { ENV_NAMES, type EnvName } from '@repo/contracts-common'
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

export default function DashboardServiceConfigurationEnvironmentPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const { data: serviceData, isLoading: serviceLoading } = useService(serviceId)
  const { data: templatesData } = useProjectVariableTemplates(projectId)
  const updateService = useUpdateService()
  const service = (serviceData ?? null) as Record<string, unknown> | null

  const [editing, setEditing] = useState(false)
  const [editEnabledEnvs, setEditEnabledEnvs] = useState<EnvName[]>([])
  const [vars, setVars] = useState<{ key: string; value: string }[]>([])
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)

  const templates = useMemo(() => {
    const t = templatesData as unknown as { templates?: { id: string; name: string; variables?: Record<string, string>; isBuiltIn?: boolean }[] } | undefined
    return t?.templates ?? []
  }, [templatesData])

  // The service's currently-enabled envs (display + Edit/Cancel reseed).
  const enabledEnvs = ((service?.enabledEnvironments ?? service?.enabled_environments ?? ENV_NAMES) as EnvName[])

  // Seed once when the service loads (useEffect — not render-time setState,
  // which would break re-seeding when React re-renders with fresh data).
  useEffect(() => {
    if (!loaded && service) {
      const envs = (service?.enabledEnvironments ?? service?.enabled_environments ?? ENV_NAMES) as EnvName[]
      setEditEnabledEnvs([...envs])
      const rawVars = (service.environmentVariables ?? service.environment_variables ?? {}) as Record<string, string> | undefined
      setVars(Object.entries(rawVars ?? {}).map(([key, value]) => ({ key, value })))
      setLoaded(true)
    }
  }, [loaded, service])

  if (serviceLoading) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-48 w-full" /></div>
  if (!service) return <Alert variant="destructive"><Siren className="size-4" /><AlertTitle>Not found</AlertTitle><AlertDescription>Service not found.</AlertDescription></Alert>

  const handleSave = async () => {
    try {
      const envVars: Record<string, string> = {}
      for (const v of vars) { if (v.key.trim()) envVars[v.key.trim()] = v.value }
      await updateService.mutateAsync({
        id: serviceId,
        enabledEnvironments: editEnabledEnvs,
        environmentVariables: envVars,
      } as never)
      toast.success('Environment configuration saved')
      setEditing(false)
    } catch (err) {
      toast.error('Failed to save', { description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE })
    }
  }

  const applyTemplate = (template: { variables?: Record<string, string> }) => {
    if (!template.variables) return
    setVars((prev) => {
      const map = new Map(prev.map((v) => [v.key, v.value]))
      for (const [k, val] of Object.entries(template.variables ?? {})) { if (k.trim()) map.set(k.trim(), val) }
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
              const enabled = editEnabledEnvs.includes(env)
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
                        className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                      >
                        {enabled ? 'On' : 'Off'}
                      </button>
                    ) : (
                      <Badge variant={enabled ? 'default' : 'outline'} className="text-[10px]">{enabled ? 'enabled' : 'disabled'}</Badge>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button asChild size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[10px]">
                      <AuthDashboardProjectsProjectIdConfigurationEnvironmentsEnvironmentId.Link projectId={projectId} environmentId={env}>
                        <KeyRound className="size-3" /> Config
                      </AuthDashboardProjectsProjectIdConfigurationEnvironmentsEnvironmentId.Link>
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[10px]">
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
                <Button key={t.id} size="sm" variant="outline" className="gap-1 text-[11px]" onClick={() => { applyTemplate(t) }}>
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
          <Button type="button" size="sm" variant="outline" className="h-7 w-fit gap-1 text-[11px]" onClick={() => { setVars([...vars, { key: '', value: '' }]) }}>
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
