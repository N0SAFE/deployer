'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Switch } from '@repo/ui/components/shadcn/switch'
import { ArrowLeft, Save } from 'lucide-react'
import { toast } from 'sonner'
import {
  ENV_NAMES,
  SERVICE_PROVIDER_TYPES,
  SERVICE_RUNNER_TYPES,
  type EnvName,
  type RunnerNetworkMode,
  type ServiceHealthProtocol,
  type ServiceHealthState,
  type ServiceLifecycle,
  type ServiceProviderType,
  type ServiceRunnerStrategy,
  type ServiceRunnerType,
} from '@repo/contracts-common'
import type { MockServiceProvider, MockServiceRunner, ServiceConfigEntry } from '@repo/contracts-entities'
import { ServiceSectionNav } from '../_components/service-section-nav'
import { ServiceConfigSubNav } from '../_components/service-config-subnav'

function parseCommaSeparatedValues(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const SERVICE_RUNNER_STRATEGIES: ServiceRunnerStrategy[] = ['rolling', 'recreate', 'blue-green', 'canary']
const RUNNER_NETWORK_MODES: RunnerNetworkMode[] = ['bridge', 'host', 'overlay']
const SERVICE_HEALTH_PROTOCOLS: ServiceHealthProtocol[] = ['http', 'tcp', 'grpc', 'command']
const SERVICE_LIFECYCLE_VALUES: ServiceLifecycle[] = ['running', 'degraded', 'starting', 'stopped', 'maintenance']
const SERVICE_HEALTH_VALUES: ServiceHealthState[] = ['passing', 'warning', 'failing', 'unknown']

export default function DashboardServiceConfigurationPage() {
  const params = useParams<{ projectId: string; serviceId: string }>()
  const projectId = params.projectId
  const serviceId = params.serviceId

  const service = useMemo(() => services.find((item) => item.id === serviceId) ?? null, [serviceId, services])

  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editType, setEditType] = useState('')
  const [editRuntime, setEditRuntime] = useState('')
  const [serviceConfigObservabilityInput, setServiceConfigObservabilityInput] = useState('')

  useEffect(() => {
    if (!service) return
    setEditName(service.name)
    setEditDescription(service.description ?? '')
    setEditType(service.type)
    setEditRuntime(service.runtime)
  }, [service])

  const [serviceConfigsById, setServiceConfigsById] = useState<Record<string, ServiceConfigEntry>>(() =>
  )
  const [serviceProvidersById, setServiceProvidersById] = useState<Record<string, MockServiceProvider>>(() =>
  )
  const [serviceRunnersById, setServiceRunnersById] = useState<Record<string, MockServiceRunner>>(() =>
  )

  useEffect(() => {
  }, [projectId])

  const serviceConfig = useMemo(() => serviceConfigsById[serviceId] ?? null, [serviceConfigsById, serviceId])
  const serviceProvider = useMemo(() => serviceProvidersById[serviceId] ?? null, [serviceProvidersById, serviceId])
  const serviceRunner = useMemo(() => serviceRunnersById[serviceId] ?? null, [serviceRunnersById, serviceId])

  const availableEnvironments = useMemo(() => {
    if (!serviceConfig) return [...ENV_NAMES]

    const supported = new Set<EnvName>([
      'production',
      ...(Object.keys(serviceConfig.statusByEnvironment) as EnvName[]),
      ...(Object.keys(serviceConfig.executionOverrides) as EnvName[]),
    ])

    return ENV_NAMES.filter((env) => supported.has(env))
  }, [serviceConfig])

  const [activeEnvironment, setActiveEnvironment] = useState<EnvName>('production')

  useEffect(() => {
    if (!availableEnvironments.includes(activeEnvironment)) {
      setActiveEnvironment(availableEnvironments[0] ?? 'production')
    }
  }, [activeEnvironment, availableEnvironments])

  useEffect(() => {
    if (!serviceConfig) {
      setServiceConfigObservabilityInput('')
      return
    }

    setServiceConfigObservabilityInput(serviceConfig.observabilityTags.join(', '))
  }, [serviceConfig])

  const handlePatchServiceConfig = (patch: Partial<ServiceConfigEntry>) => {
    setServiceConfigsById((previous) => {
      const existing = previous[serviceId]
      if (!existing) return previous

      return {
        ...previous,
        [serviceId]: {
          ...existing,
          ...patch,
          observabilityTags:
            patch.observabilityTags !== undefined ? [...patch.observabilityTags] : [...existing.observabilityTags],
        },
      }
    })
  }

  const handlePatchServiceProviderConfig = (patch: Partial<ServiceConfigEntry['providerConfig']>) => {
    setServiceConfigsById((previous) => {
      const existing = previous[serviceId]
      if (!existing) return previous

      return {
        ...previous,
        [serviceId]: {
          ...existing,
          providerConfig: {
            ...existing.providerConfig,
            ...patch,
          },
        },
      }
    })
  }

  const handlePatchServiceProviderEntity = (patch: Partial<MockServiceProvider>) => {
    setServiceProvidersById((previous) => {
      const existing = previous[serviceId]
      if (!existing) return previous
      return {
        ...previous,
        [serviceId]: {
          ...existing,
          ...patch,
        },
      }
    })
  }

  const handlePatchServiceRunnerConfig = (patch: Partial<ServiceConfigEntry['runnerConfig']>) => {
    setServiceConfigsById((previous) => {
      const existing = previous[serviceId]
      if (!existing) return previous

      return {
        ...previous,
        [serviceId]: {
          ...existing,
          runnerConfig: {
            ...existing.runnerConfig,
            ...patch,
            args: patch.args !== undefined ? [...patch.args] : [...existing.runnerConfig.args],
            ports: patch.ports !== undefined ? [...patch.ports] : [...existing.runnerConfig.ports],
            volumeMounts:
              patch.volumeMounts !== undefined ? [...patch.volumeMounts] : [...existing.runnerConfig.volumeMounts],
            secretRefs: patch.secretRefs !== undefined ? [...patch.secretRefs] : [...existing.runnerConfig.secretRefs],
          },
        },
      }
    })
  }

  const handlePatchServiceRunnerEntity = (patch: Partial<MockServiceRunner>) => {
    setServiceRunnersById((previous) => {
      const existing = previous[serviceId]
      if (!existing) return previous
      return {
        ...previous,
        [serviceId]: {
          ...existing,
          ...patch,
        },
      }
    })
  }

  const handlePatchServiceStatusByEnvironment = (
    env: EnvName,
    patch: Partial<NonNullable<ServiceConfigEntry['statusByEnvironment'][EnvName]>>,
  ) => {
    setServiceConfigsById((previous) => {
      const existing = previous[serviceId]
      if (!existing) return previous

      const current = existing.statusByEnvironment[env] ?? existing.statusByEnvironment.production
      const next = {
        lifecycle: patch.lifecycle ?? current.lifecycle,
        health: patch.health ?? current.health,
        lastHeartbeatAt: patch.lastHeartbeatAt ?? current.lastHeartbeatAt,
        uptimePercent: patch.uptimePercent ?? current.uptimePercent,
        averageLatencyMs: patch.averageLatencyMs ?? current.averageLatencyMs,
        errorRatePercent: patch.errorRatePercent ?? current.errorRatePercent,
      }

      return {
        ...previous,
        [serviceId]: {
          ...existing,
          statusByEnvironment: {
            ...existing.statusByEnvironment,
            [env]: next,
          },
        },
      }
    })
  }

  const handlePatchServiceExecutionOverride = (
    env: EnvName,
    patch: Partial<NonNullable<ServiceConfigEntry['executionOverrides'][EnvName]>>,
  ) => {
    setServiceConfigsById((previous) => {
      const existing = previous[serviceId]
      if (!existing) return previous

      const baseline = existing.executionOverrides[env] ?? {
        disabled: false,
        strategy: existing.runnerConfig.strategy,
        replicas: {
          min: existing.minReplicas,
          max: existing.maxReplicas,
        },
      }

      return {
        ...previous,
        [serviceId]: {
          ...existing,
          executionOverrides: {
            ...existing.executionOverrides,
            [env]: {
              ...baseline,
              ...patch,
              replicas:
                patch.replicas !== undefined
                  ? {
                      min: patch.replicas.min,
                      max: patch.replicas.max,
                    }
                  : baseline.replicas,
            },
          },
        },
      }
    })
  }

  const handleSaveService = () => {
    if (!service) return

    const name = editName.trim()
    const type = editType.trim()
    const runtime = editRuntime.trim()

    if (!name || !type || !runtime) {
      toast.error('Name, type and runtime are required')
      return
    }

    setServices((previous) =>
      previous.map((item) =>
        item.id === service.id
          ? {
              ...item,
              name,
              description: editDescription.trim() || item.description,
              type,
              runtime,
            }
          : item,
      ),
    )

    toast.success('Service updated in mock dashboard')
  }

  const handleSaveServiceConfiguration = () => {
    if (!serviceConfig) {
      toast.error('No service configuration available for this service')
      return
    }

    const nextObservabilityTags = parseCommaSeparatedValues(serviceConfigObservabilityInput)
    handlePatchServiceConfig({ observabilityTags: nextObservabilityTags })

    toast.success('Service runtime configuration saved in mock state')
  }

  if (!project) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Project not found</AlertTitle>
        <AlertDescription>This project does not exist in the mock entities dataset.</AlertDescription>
      </Alert>
    )
  }

  if (!service) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Service not found</AlertTitle>
        <AlertDescription>This service does not exist in the selected project mock dataset.</AlertDescription>
      </Alert>
    )
  }

  if (!serviceConfig) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Configuration missing</AlertTitle>
        <AlertDescription>No configuration payload exists for this service in current fixture data.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
            <Link href={`/dashboard/projects/${projectId}/services/${serviceId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to service
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Service configuration</h1>
            <p className="text-sm text-muted-foreground">
              Structured editor aligned with project configuration UX: identity, runtime policy, and environment overrides.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSaveService}>
            <Save className="mr-2 h-4 w-4" />
            Save identity
          </Button>
          <Button onClick={handleSaveServiceConfiguration}>
            <Save className="mr-2 h-4 w-4" />
            Save runtime config
          </Button>
        </div>
      </div>

      <ServiceSectionNav projectId={projectId} serviceId={serviceId} active="configuration" />
      <ServiceConfigSubNav projectId={projectId} serviceId={serviceId} active="general" />

      <div className="rounded-xl border border-border/60 bg-card/35 p-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">provider {serviceConfig.providerType}</Badge>
          <Badge variant="outline">runner {serviceConfig.runnerType}</Badge>
          <Badge variant="outline">autoscale {serviceConfig.autoscaleEnabled ? 'on' : 'off'}</Badge>
          <Badge variant="outline">replicas {serviceConfig.minReplicas} → {serviceConfig.maxReplicas}</Badge>
          <Badge variant={serviceConfig.executionOverrides[activeEnvironment]?.disabled ? 'secondary' : 'default'}>
            {activeEnvironment} {serviceConfig.executionOverrides[activeEnvironment]?.disabled ? 'disabled' : 'enabled'}
          </Badge>
        </div>
      </div>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Primary service metadata displayed across dashboards and deployment flows.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="service-edit-name">Name</Label>
            <Input id="service-edit-name" value={editName} onChange={(event) => setEditName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-edit-type">Type</Label>
            <Input id="service-edit-type" value={editType} onChange={(event) => setEditType(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-edit-runtime">Runtime</Label>
            <Input id="service-edit-runtime" value={editRuntime} onChange={(event) => setEditRuntime(event.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="service-edit-description">Description</Label>
            <Input
              id="service-edit-description"
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Runtime policy</CardTitle>
          <CardDescription>Provider, runner, health gate, and scaling defaults.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">profile {serviceConfig.deploymentProfile}</Badge>
            <Badge variant="outline">provider {serviceConfig.providerType}</Badge>
            <Badge variant="outline">runner {serviceConfig.runnerType}</Badge>
          </div>

          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>Deployment profile</Label>
              <Select
                value={serviceConfig.deploymentProfile}
                onValueChange={(value: ServiceConfigEntry['deploymentProfile']) => {
                  handlePatchServiceConfig({ deploymentProfile: value })
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">standard</SelectItem>
                  <SelectItem value="isolated-group">isolated-group</SelectItem>
                  <SelectItem value="high-availability">high-availability</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Pinned environment</Label>
              <Select
                value={serviceConfig.pinnedEnvironment}
                onValueChange={(value: ServiceConfigEntry['pinnedEnvironment']) => {
                  handlePatchServiceConfig({ pinnedEnvironment: value })
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">any</SelectItem>
                  {ENV_NAMES.map((env) => (
                    <SelectItem key={env} value={env}>
                      {env}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Min replicas</Label>
              <Input
                type="number"
                min={0}
                value={String(serviceConfig.minReplicas)}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  handlePatchServiceConfig({ minReplicas: Number.isFinite(value) ? Math.max(0, value) : 0 })
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>Max replicas</Label>
              <Input
                type="number"
                min={1}
                value={String(serviceConfig.maxReplicas)}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  handlePatchServiceConfig({ maxReplicas: Number.isFinite(value) ? Math.max(1, value) : 1 })
                }}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
              <Label>Autoscale enabled</Label>
              <Switch
                checked={serviceConfig.autoscaleEnabled}
                onCheckedChange={(checked) => {
                  handlePatchServiceConfig({ autoscaleEnabled: checked })
                }}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
              <Label>Expose group internals</Label>
              <Switch
                checked={serviceConfig.exposeGroupInternals}
                onCheckedChange={(checked) => {
                  handlePatchServiceConfig({ exposeGroupInternals: checked })
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Observability tags (comma-separated)</Label>
            <Input value={serviceConfigObservabilityInput} onChange={(event) => setServiceConfigObservabilityInput(event.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Provider + runner configuration</CardTitle>
          <CardDescription>Source and runtime controls grouped in focused sections.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border/60 p-3">
            <p className="mb-2 text-sm font-semibold">Provider</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Provider type</Label>
                <Select
                  value={serviceConfig.providerType}
                  onValueChange={(value: ServiceProviderType) => {
                    handlePatchServiceConfig({ providerType: value })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_PROVIDER_TYPES.map((providerType) => (
                      <SelectItem key={providerType} value={providerType}>
                        {providerType}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {serviceProvider ? (
                <>
                  <div className="space-y-2">
                    <Label>Provider name</Label>
                    <Input value={serviceProvider.name} onChange={(event) => handlePatchServiceProviderEntity({ name: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Integration ref</Label>
                    <Input
                      value={serviceProvider.integrationRef}
                      onChange={(event) => handlePatchServiceProviderEntity({ integrationRef: event.target.value })}
                    />
                  </div>
                </>
              ) : null}

              <div className="space-y-2 md:col-span-2">
                <Label>Source URL</Label>
                <Input value={serviceConfig.providerConfig.sourceUrl} onChange={(event) => handlePatchServiceProviderConfig({ sourceUrl: event.target.value })} />
              </div>

              <div className="space-y-2">
                <Label>Branch</Label>
                <Input value={serviceConfig.providerConfig.branch} onChange={(event) => handlePatchServiceProviderConfig({ branch: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Root path</Label>
                <Input value={serviceConfig.providerConfig.rootPath} onChange={(event) => handlePatchServiceProviderConfig({ rootPath: event.target.value })} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 p-3">
            <p className="mb-2 text-sm font-semibold">Runner</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Runner type</Label>
                <Select
                  value={serviceConfig.runnerType}
                  onValueChange={(value: ServiceRunnerType) => {
                    handlePatchServiceConfig({ runnerType: value })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_RUNNER_TYPES.map((runnerType) => (
                      <SelectItem key={runnerType} value={runnerType}>
                        {runnerType}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {serviceRunner ? (
                <>
                  <div className="space-y-2">
                    <Label>Runner name</Label>
                    <Input value={serviceRunner.name} onChange={(event) => handlePatchServiceRunnerEntity({ name: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Runner pool</Label>
                    <Input value={serviceRunner.pool} onChange={(event) => handlePatchServiceRunnerEntity({ pool: event.target.value })} />
                  </div>
                </>
              ) : null}

              <div className="space-y-2">
                <Label>Strategy</Label>
                <Select
                  value={serviceConfig.runnerConfig.strategy}
                  onValueChange={(value: ServiceRunnerStrategy) => {
                    handlePatchServiceRunnerConfig({ strategy: value })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_RUNNER_STRATEGIES.map((strategy) => (
                      <SelectItem key={strategy} value={strategy}>
                        {strategy}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Network mode</Label>
                <Select
                  value={serviceConfig.runnerConfig.networkMode}
                  onValueChange={(value: RunnerNetworkMode) => {
                    handlePatchServiceRunnerConfig({ networkMode: value })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RUNNER_NETWORK_MODES.map((networkMode) => (
                      <SelectItem key={networkMode} value={networkMode}>
                        {networkMode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Start command</Label>
                <Input
                  value={serviceConfig.runnerConfig.startCommand}
                  onChange={(event) => handlePatchServiceRunnerConfig({ startCommand: event.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Args (comma-separated)</Label>
                <Input
                  value={serviceConfig.runnerConfig.args.join(', ')}
                  onChange={(event) => handlePatchServiceRunnerConfig({ args: parseCommaSeparatedValues(event.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Ports (comma-separated)</Label>
                <Input
                  value={serviceConfig.runnerConfig.ports.join(', ')}
                  onChange={(event) => {
                    const parsed = event.target.value
                      .split(',')
                      .map((part) => Number(part.trim()))
                      .filter((port) => Number.isFinite(port))
                      .map((port) => Math.max(1, Math.round(port)))
                    handlePatchServiceRunnerConfig({ ports: parsed.length > 0 ? parsed : serviceConfig.runnerConfig.ports })
                  }}
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 p-3">
            <p className="mb-2 text-sm font-semibold">Health check</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label>Protocol</Label>
                <Select
                  value={serviceConfig.healthCheck.protocol}
                  onValueChange={(value: ServiceHealthProtocol) => {
                    handlePatchServiceConfig({
                      healthCheck: {
                        ...serviceConfig.healthCheck,
                        protocol: value,
                      },
                    })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_HEALTH_PROTOCOLS.map((protocol) => (
                      <SelectItem key={protocol} value={protocol}>
                        {protocol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 xl:col-span-3">
                <Label>Target</Label>
                <Input
                  value={serviceConfig.healthCheck.target}
                  onChange={(event) => {
                    handlePatchServiceConfig({
                      healthCheck: {
                        ...serviceConfig.healthCheck,
                        target: event.target.value,
                      },
                    })
                  }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <CardTitle>Environment overrides</CardTitle>
          <CardDescription>Per-environment lifecycle, health, and execution behavior.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-w-xs space-y-1">
            <Label>Selected environment</Label>
            <Select value={activeEnvironment} onValueChange={(value: EnvName) => setActiveEnvironment(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableEnvironments.map((env) => (
                  <SelectItem key={env} value={env}>
                    {env}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {[activeEnvironment].map((env) => {
            const runtimeStatus = serviceConfig.statusByEnvironment[env] ?? serviceConfig.statusByEnvironment.production
            const override = serviceConfig.executionOverrides[env] ?? {
              disabled: false,
              strategy: serviceConfig.runnerConfig.strategy,
              replicas: {
                min: serviceConfig.minReplicas,
                max: serviceConfig.maxReplicas,
              },
            }

            return (
              <div key={env} className="rounded-md border border-border/60 bg-muted/10 p-3">
                <p className="mb-2 text-sm font-semibold capitalize">{env}</p>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  <div className="space-y-1">
                    <Label>Lifecycle</Label>
                    <Select value={runtimeStatus.lifecycle} onValueChange={(value: ServiceLifecycle) => handlePatchServiceStatusByEnvironment(env, { lifecycle: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SERVICE_LIFECYCLE_VALUES.map((lifecycle) => (
                          <SelectItem key={lifecycle} value={lifecycle}>
                            {lifecycle}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Health</Label>
                    <Select value={runtimeStatus.health} onValueChange={(value: ServiceHealthState) => handlePatchServiceStatusByEnvironment(env, { health: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SERVICE_HEALTH_VALUES.map((health) => (
                          <SelectItem key={health} value={health}>
                            {health}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border/60 p-2">
                    <Label>Disabled in {env}</Label>
                    <Switch
                      checked={Boolean(override.disabled)}
                      onCheckedChange={(checked) => handlePatchServiceExecutionOverride(env, { disabled: checked })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Override strategy</Label>
                    <Select
                      value={override.strategy ?? serviceConfig.runnerConfig.strategy}
                      onValueChange={(value: ServiceRunnerStrategy) => handlePatchServiceExecutionOverride(env, { strategy: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SERVICE_RUNNER_STRATEGIES.map((strategy) => (
                          <SelectItem key={strategy} value={strategy}>
                            {strategy}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Min / max replicas</Label>
                    <div className="grid grid-cols-2 gap-1">
                      <Input
                        type="number"
                        min={0}
                        value={String(override.replicas?.min ?? serviceConfig.minReplicas)}
                        onChange={(event) => {
                          const value = Number(event.target.value)
                          handlePatchServiceExecutionOverride(env, {
                            replicas: {
                              min: Number.isFinite(value) ? Math.max(0, value) : 0,
                              max: override.replicas?.max ?? serviceConfig.maxReplicas,
                            },
                          })
                        }}
                      />
                      <Input
                        type="number"
                        min={1}
                        value={String(override.replicas?.max ?? serviceConfig.maxReplicas)}
                        onChange={(event) => {
                          const value = Number(event.target.value)
                          handlePatchServiceExecutionOverride(env, {
                            replicas: {
                              min: override.replicas?.min ?? serviceConfig.minReplicas,
                              max: Number.isFinite(value) ? Math.max(1, value) : 1,
                            },
                          })
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
