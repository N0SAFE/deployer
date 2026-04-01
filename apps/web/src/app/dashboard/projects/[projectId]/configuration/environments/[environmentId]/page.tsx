'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ENV_NAMES, type EnvName } from '@repo/contracts-common'
import {
  getDependencyGraphMockScenario,
  getDependencyPolicyKey,
  type DependencyPolicyOverrideMap,
} from '@/mocks/platform'
import type { ProjectConfiguration, ServiceConfigEntry } from '@repo/contracts-entities'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { ArrowLeft, Network, RotateCcw, Save, Search, Settings2, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'

type EnvironmentConfig = NonNullable<ProjectConfiguration['environment']['environments'][EnvName]>
type ServiceEnvironmentOverride = NonNullable<ServiceConfigEntry['executionOverrides'][EnvName]>

type DependencyRequirement = 'required' | 'optional' | 'disabled'
type DependencyHealthGate = 'must-pass' | 'warn' | 'ignore'
type DependencyStartup = 'before' | 'parallel' | 'after'

const DEPLOYMENT_STRATEGY_OPTIONS = ['rolling', 'canary', 'blue-green', 'manual'] as const
const ENV_HEALTH_GATE_OPTIONS = ['strict', 'warn', 'ignore'] as const
const ENV_STARTUP_OPTIONS = ['before', 'parallel', 'after'] as const
const SERVICE_STRATEGY_OPTIONS = ['rolling', 'blue-green', 'canary', 'recreate'] as const
const DEPENDENCY_REQUIREMENT_OPTIONS: readonly DependencyRequirement[] = ['required', 'optional', 'disabled'] as const
const DEPENDENCY_HEALTH_OPTIONS: readonly DependencyHealthGate[] = ['must-pass', 'warn', 'ignore'] as const
const DEPENDENCY_STARTUP_OPTIONS: readonly DependencyStartup[] = ['before', 'parallel', 'after'] as const
const ENVIRONMENT_TABS = ['controls', 'variables', 'services', 'dependencies'] as const
type EnvironmentTabValue = (typeof ENVIRONMENT_TABS)[number]

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function mergeEnvironmentConfig(current: EnvironmentConfig, patch: Partial<EnvironmentConfig>): EnvironmentConfig {
  return {
    autoDeployEnabled: patch.autoDeployEnabled ?? current.autoDeployEnabled,
    deploymentStrategy: patch.deploymentStrategy ?? current.deploymentStrategy,
    healthGate: patch.healthGate ?? current.healthGate,
    startupMode: patch.startupMode ?? current.startupMode,
    replicas: {
      min: patch.replicas?.min ?? current.replicas.min,
      max: patch.replicas?.max ?? current.replicas.max,
    },
    trafficPolicy: {
      maxErrorRatePercent:
        patch.trafficPolicy?.maxErrorRatePercent ?? current.trafficPolicy.maxErrorRatePercent,
      maxLatencyMs: patch.trafficPolicy?.maxLatencyMs ?? current.trafficPolicy.maxLatencyMs,
      allowCrossRegionFailover:
        patch.trafficPolicy?.allowCrossRegionFailover ?? current.trafficPolicy.allowCrossRegionFailover,
    },
    variables: patch.variables ?? current.variables,
  }
}

function isDependencyEnabledInEnvironment(
  dependency: { enabledIn?: readonly EnvName[] | EnvName[] },
  environmentName: EnvName,
): boolean {
  if (!dependency.enabledIn || dependency.enabledIn.length === 0) {
    return true
  }

  return dependency.enabledIn.includes(environmentName)
}

function getOverrideTargetDescription(override: ServiceEnvironmentOverride | undefined): string {
  const target = override?.dependencyLinkPolicy?.target

  if (!target) {
    return 'default route'
  }

  if (target.mode === 'same-environment') {
    return 'same environment'
  }

  if (target.mode === 'fixed-environment') {
    return `fixed → ${target.targetEnvironment}`
  }

  return `derived (${target.fromInputKey}) fallback ${target.fallbackEnvironment}`
}

export default function DashboardProjectEnvironmentDetailsPage() {
  const params = useParams<{ projectId: string; environmentId: string }>()
  const projectId = params.projectId
  const environmentId = params.environmentId
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const scenario = useMemo(() => getDependencyGraphMockScenario(projectId), [projectId])

  const selectedTab = (() => {
    const tab = searchParams.get('tab')
    if (tab && ENVIRONMENT_TABS.includes(tab as EnvironmentTabValue)) {
      return tab as EnvironmentTabValue
    }
    return 'controls'
  })()

  const updateSearchParam = (key: string, value: string) => {
    const paramsObject = new URLSearchParams(searchParams.toString())
    if (value.length > 0) {
      paramsObject.set(key, value)
    } else {
      paramsObject.delete(key)
    }
    const queryString = paramsObject.toString()
    router.replace(queryString.length > 0 ? `${pathname}?${queryString}` : pathname, { scroll: false })
  }

  const initialProjectConfig = useMemo(() => cloneValue(scenario.configuration), [scenario.configuration])
  const initialServiceConfigsById = useMemo(() => cloneValue(scenario.serviceConfigs), [scenario.serviceConfigs])
  const initialPolicyOverridesByKey = useMemo(() => cloneValue(scenario.policyOverrides), [scenario.policyOverrides])

  const [projectConfig, setProjectConfig] = useState<ProjectConfiguration>(() => cloneValue(initialProjectConfig))
  const [serviceConfigsById, setServiceConfigsById] = useState<Record<string, ServiceConfigEntry>>(() =>
    cloneValue(initialServiceConfigsById),
  )
  const [policyOverridesByKey, setPolicyOverridesByKey] = useState<DependencyPolicyOverrideMap>(() =>
    cloneValue(initialPolicyOverridesByKey),
  )

  const [serviceSearch, setServiceSearch] = useState(() => searchParams.get('serviceSearch') ?? '')
  const [newVariableKey, setNewVariableKey] = useState('')
  const [newVariableValue, setNewVariableValue] = useState('')
  const [bulkServiceStrategy, setBulkServiceStrategy] = useState<ServiceEnvironmentOverride['strategy']>('rolling')
  const [bulkRequirement, setBulkRequirement] = useState<DependencyRequirement>('required')
  const [bulkHealthGate, setBulkHealthGate] = useState<DependencyHealthGate>('must-pass')
  const [bulkStartup, setBulkStartup] = useState<DependencyStartup>('before')

  const hasUnsavedChanges = useMemo(() => {
    return (
      JSON.stringify(projectConfig) !== JSON.stringify(initialProjectConfig)
      || JSON.stringify(serviceConfigsById) !== JSON.stringify(initialServiceConfigsById)
      || JSON.stringify(policyOverridesByKey) !== JSON.stringify(initialPolicyOverridesByKey)
    )
  }, [
    initialPolicyOverridesByKey,
    initialProjectConfig,
    initialServiceConfigsById,
    policyOverridesByKey,
    projectConfig,
    serviceConfigsById,
  ])

  const env = useMemo(() => {
    const known = environmentId as EnvName
    if (ENV_NAMES.includes(known)) {
      return known
    }

    const availableEnvironmentNames = Object.keys(scenario.configuration.environment.environments)
    return availableEnvironmentNames.includes(environmentId) ? (environmentId as EnvName) : null
  }, [environmentId, scenario.configuration.environment.environments])

  const config = env ? projectConfig.environment.environments[env] : null

  const serviceById = useMemo(() => {
    return new Map(scenario.services.map((service) => [service.id, service]))
  }, [scenario.services])

  const dependencyStatsByServiceId = useMemo(() => {
    const map = new Map<string, { outgoing: number; incoming: number }>()
    for (const service of scenario.services) {
      map.set(service.id, { outgoing: 0, incoming: 0 })
    }

    if (!env) {
      return map
    }

    for (const dependency of scenario.dependencies) {
      if (!isDependencyEnabledInEnvironment(dependency, env)) {
        continue
      }

      const source = map.get(dependency.serviceId)
      const target = map.get(dependency.dependsOnServiceId)
      if (source) source.outgoing += 1
      if (target) target.incoming += 1
    }

    return map
  }, [env, scenario.dependencies, scenario.services])

  const environmentSnapshot = useMemo(() => {
    if (!env) {
      return null
    }

    let enabledServices = 0
    let passingServices = 0
    let warningServices = 0
    let failingServices = 0

    for (const service of scenario.services) {
      const serviceConfig = serviceConfigsById[service.id]
      if (!serviceConfig) {
        continue
      }

      const override = serviceConfig.executionOverrides[env]
      const runtime = serviceConfig.statusByEnvironment[env] ?? serviceConfig.statusByEnvironment.production

      if (!override?.disabled) {
        enabledServices += 1
      }

      if (runtime.health === 'passing') {
        passingServices += 1
      } else if (runtime.health === 'warning') {
        warningServices += 1
      } else if (runtime.health === 'failing') {
        failingServices += 1
      }
    }

    const deploymentsCount = scenario.deployments.filter((deployment) => deployment.environment === env).length
    const incidentsCount = scenario.incidents.filter((incident) => incident.environment === env).length
    const activeDependencyCount = scenario.dependencies.filter((dependency) =>
      isDependencyEnabledInEnvironment(dependency, env),
    ).length

    return {
      enabledServices,
      passingServices,
      warningServices,
      failingServices,
      deploymentsCount,
      incidentsCount,
      activeDependencyCount,
      totalServices: scenario.services.length,
    }
  }, [env, scenario.dependencies, scenario.deployments, scenario.incidents, scenario.services, serviceConfigsById])

  const serviceRows = useMemo(() => {
    const query = serviceSearch.trim().toLowerCase()

    return scenario.services
      .map((service) => {
        const serviceConfig = serviceConfigsById[service.id]
        const environmentOverride = env ? serviceConfig?.executionOverrides[env] : undefined
        const runtime = env
          ? (serviceConfig?.statusByEnvironment[env] ?? serviceConfig?.statusByEnvironment.production)
          : serviceConfig?.statusByEnvironment.production

        return {
          service,
          environmentOverride,
          runtime,
          dependencyStats: dependencyStatsByServiceId.get(service.id) ?? { outgoing: 0, incoming: 0 },
        }
      })
      .filter(({ service }) => {
        if (!query) {
          return true
        }

        return (
          service.name.toLowerCase().includes(query)
          || service.id.toLowerCase().includes(query)
          || service.runtime.toLowerCase().includes(query)
          || service.type.toLowerCase().includes(query)
        )
      })
      .sort((left, right) => left.service.name.localeCompare(right.service.name))
  }, [dependencyStatsByServiceId, env, scenario.services, serviceConfigsById, serviceSearch])

  const dependencyRows = useMemo(() => {
    if (!env) {
      return []
    }

    return scenario.dependencies
      .map((dependency) => {
        const policyKey = getDependencyPolicyKey({
          serviceId: dependency.serviceId,
          dependsOnServiceId: dependency.dependsOnServiceId,
        })
        const policy = policyOverridesByKey[policyKey]?.[env]

        return {
          dependency,
          policyKey,
          sourceService: serviceById.get(dependency.serviceId),
          targetService: serviceById.get(dependency.dependsOnServiceId),
          isActive: isDependencyEnabledInEnvironment(dependency, env),
          policy,
        }
      })
      .sort((left, right) => {
        const leftName = left.sourceService?.name ?? left.dependency.serviceId
        const rightName = right.sourceService?.name ?? right.dependency.serviceId
        return leftName.localeCompare(rightName)
      })
  }, [env, policyOverridesByKey, scenario.dependencies, serviceById])

  const handlePatchEnvironmentConfig = (patch: Partial<EnvironmentConfig>) => {
    if (!env || !config) {
      return
    }

    setProjectConfig((previous) => {
      const current = previous.environment.environments[env]
      if (!current) {
        return previous
      }

      return {
        ...previous,
        environment: {
          ...previous.environment,
          environments: {
            ...previous.environment.environments,
            [env]: mergeEnvironmentConfig(current, patch),
          },
        },
      }
    })
  }

  const handlePatchServiceOverride = (serviceId: string, patch: Partial<ServiceEnvironmentOverride>) => {
    if (!env) {
      return
    }

    setServiceConfigsById((previous) => {
      const current = previous[serviceId]
      if (!current) {
        return previous
      }

      const currentOverride = current.executionOverrides[env] ?? {}

      return {
        ...previous,
        [serviceId]: {
          ...current,
          executionOverrides: {
            ...current.executionOverrides,
            [env]: {
              ...currentOverride,
              ...patch,
            },
          },
        },
      }
    })
  }

  const handleApplyBulkServiceEnabled = (enabled: boolean) => {
    const targetIds = serviceRows.map((row) => row.service.id)
    if (targetIds.length === 0) {
      toast.info('No visible services to update')
      return
    }

    setServiceConfigsById((previous) => {
      const next = { ...previous }
      for (const serviceId of targetIds) {
        const current = next[serviceId]
        if (!current || !env) {
          continue
        }
        const currentOverride = current.executionOverrides[env] ?? {}
        next[serviceId] = {
          ...current,
          executionOverrides: {
            ...current.executionOverrides,
            [env]: {
              ...currentOverride,
              disabled: !enabled,
            },
          },
        }
      }
      return next
    })

    toast.success(`${String(targetIds.length)} services updated`)
  }

  const handleApplyBulkServiceStrategy = () => {
    const targetIds = serviceRows.map((row) => row.service.id)
    if (targetIds.length === 0) {
      toast.info('No visible services to update')
      return
    }

    setServiceConfigsById((previous) => {
      const next = { ...previous }
      for (const serviceId of targetIds) {
        const current = next[serviceId]
        if (!current || !env) {
          continue
        }
        const currentOverride = current.executionOverrides[env] ?? {}
        next[serviceId] = {
          ...current,
          executionOverrides: {
            ...current.executionOverrides,
            [env]: {
              ...currentOverride,
              strategy: bulkServiceStrategy,
            },
          },
        }
      }
      return next
    })

    toast.success(`Strategy applied to ${String(targetIds.length)} services`)
  }

  const handleApplyBulkDependencyPolicy = () => {
    if (!env) {
      return
    }

    const targetDependencies = dependencyRows.filter((row) => row.isActive)
    if (targetDependencies.length === 0) {
      toast.info('No active dependencies in this environment')
      return
    }

    setPolicyOverridesByKey((previous) => {
      const next: DependencyPolicyOverrideMap = { ...previous }
      for (const row of targetDependencies) {
        const byEnvironment = next[row.policyKey] ?? {}
        const current = byEnvironment[env] ?? {}
        next[row.policyKey] = {
          ...byEnvironment,
          [env]: {
            ...current,
            requirement: bulkRequirement,
            healthGate: bulkHealthGate,
            startup: bulkStartup,
          },
        }
      }
      return next
    })

    toast.success(`Policy applied to ${String(targetDependencies.length)} dependencies`)
  }

  const handlePatchDependencyPolicy = (
    policyKey: string,
    patch: {
      requirement?: DependencyRequirement
      healthGate?: DependencyHealthGate
      startup?: DependencyStartup
      maxRetries?: number
      timeoutSeconds?: number
    },
  ) => {
    if (!env) {
      return
    }

    setPolicyOverridesByKey((previous) => {
      const currentByEnvironment = previous[policyKey] ?? {}
      const currentPolicy = currentByEnvironment[env] ?? {}

      return {
        ...previous,
        [policyKey]: {
          ...currentByEnvironment,
          [env]: {
            ...currentPolicy,
            ...patch,
          },
        },
      }
    })
  }

  const handleAddEnvironmentVariable = () => {
    if (!env || !config) {
      return
    }

    const key = newVariableKey.trim()
    if (key.length === 0) {
      toast.error('Variable key is required')
      return
    }

    if (Object.prototype.hasOwnProperty.call(config.variables, key)) {
      toast.info(`Updating existing variable ${key}`)
    }

    handlePatchEnvironmentConfig({
      variables: {
        ...config.variables,
        [key]: newVariableValue,
      },
    })

    setNewVariableKey('')
    setNewVariableValue('')
  }

  const handleRemoveEnvironmentVariable = (key: string) => {
    if (!config) {
      return
    }

    const nextVariables = Object.fromEntries(
      Object.entries(config.variables).filter(([entryKey]) => entryKey !== key),
    )
    handlePatchEnvironmentConfig({ variables: nextVariables })
  }

  const handleResetAll = () => {
    setProjectConfig(cloneValue(initialProjectConfig))
    setServiceConfigsById(cloneValue(initialServiceConfigsById))
    setPolicyOverridesByKey(cloneValue(initialPolicyOverridesByKey))
    setServiceSearch('')
    setNewVariableKey('')
    setNewVariableValue('')
    updateSearchParam('serviceSearch', '')
    toast.info('Unsaved changes were discarded')
  }

  if (!env || !config || !environmentSnapshot) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/projects/${projectId}/configuration`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to configuration
          </Link>
        </Button>

        <Alert>
          <AlertTitle>Environment not found</AlertTitle>
          <AlertDescription>
            This environment is not available for the selected project fixture.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const healthScore = environmentSnapshot.totalServices > 0
    ? Math.round((environmentSnapshot.passingServices / environmentSnapshot.totalServices) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/projects/${projectId}/configuration`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to configuration
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{env} environment editor</h1>
            <p className="text-sm text-muted-foreground">
              {scenario.project.name} · focused control panel for runtime behavior, service overrides, and dependency routing.
            </p>
            <p className="text-xs text-muted-foreground">
              {hasUnsavedChanges ? 'Unsaved changes in progress.' : 'All changes are saved in current fixture state.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={!hasUnsavedChanges} onClick={handleResetAll}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>

          <Button
            className="gap-2"
            disabled={!hasUnsavedChanges}
            onClick={() => {
              toast.success('Environment updates stored in fixture state')
            }}
          >
            <Save className="h-4 w-4" />
            Save changes
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Services enabled</CardDescription>
            <CardTitle>{environmentSnapshot.enabledServices}/{environmentSnapshot.totalServices}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {environmentSnapshot.warningServices} warning · {environmentSnapshot.failingServices} failing
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Health score</CardDescription>
            <CardTitle>{String(healthScore)}%</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-1.5 rounded bg-muted">
              <div className="h-full rounded bg-emerald-500" style={{ width: `${String(healthScore)}%` }} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active dependency edges</CardDescription>
            <CardTitle>{String(environmentSnapshot.activeDependencyCount)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Scoped to this environment</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Incidents / deployments</CardDescription>
            <CardTitle>
              {String(environmentSnapshot.incidentsCount)} / {String(environmentSnapshot.deploymentsCount)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={environmentSnapshot.incidentsCount > 0 ? 'destructive' : 'outline'}>
              {environmentSnapshot.incidentsCount > 0 ? 'attention needed' : 'stable'}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Tabs
        value={selectedTab}
        onValueChange={(value) => {
          updateSearchParam('tab', value)
        }}
        className="space-y-4"
      >
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="variables">Variables</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
        </TabsList>

        <TabsContent value="controls" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Deployment and resiliency controls
              </CardTitle>
              <CardDescription>
                Environment-level defaults applied when service-specific overrides are not present.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1">
                  <Label>Deployment strategy</Label>
                  <Select
                    value={config.deploymentStrategy}
                    onValueChange={(value) => {
                      handlePatchEnvironmentConfig({
                        deploymentStrategy: value as EnvironmentConfig['deploymentStrategy'],
                      })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPLOYMENT_STRATEGY_OPTIONS.map((option) => (
                        <SelectItem key={`deployment-strategy-${option}`} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label>Health gate</Label>
                  <Select
                    value={config.healthGate}
                    onValueChange={(value) => {
                      handlePatchEnvironmentConfig({
                        healthGate: value as EnvironmentConfig['healthGate'],
                      })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENV_HEALTH_GATE_OPTIONS.map((option) => (
                        <SelectItem key={`health-gate-${option}`} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label>Startup mode</Label>
                  <Select
                    value={config.startupMode}
                    onValueChange={(value) => {
                      handlePatchEnvironmentConfig({
                        startupMode: value as EnvironmentConfig['startupMode'],
                      })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENV_STARTUP_OPTIONS.map((option) => (
                        <SelectItem key={`startup-mode-${option}`} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-md border border-border/60 p-2">
                  <Label>Auto deploy</Label>
                  <Switch
                    checked={config.autoDeployEnabled}
                    onCheckedChange={(checked) => {
                      handlePatchEnvironmentConfig({ autoDeployEnabled: checked })
                    }}
                  />
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1">
                  <Label>Min replicas</Label>
                  <Input
                    type="number"
                    min={0}
                    value={String(config.replicas.min)}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      const nextMin = Number.isFinite(value) ? Math.max(0, value) : 0
                      handlePatchEnvironmentConfig({
                        replicas: {
                          ...config.replicas,
                          min: nextMin,
                          max: Math.max(config.replicas.max, nextMin),
                        },
                      })
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <Label>Max replicas</Label>
                  <Input
                    type="number"
                    min={1}
                    value={String(config.replicas.max)}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      const nextMax = Number.isFinite(value) ? Math.max(1, value) : 1
                      handlePatchEnvironmentConfig({
                        replicas: {
                          ...config.replicas,
                          min: config.replicas.min,
                          max: Math.max(nextMax, config.replicas.min),
                        },
                      })
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <Label>Max error rate (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={String(config.trafficPolicy.maxErrorRatePercent)}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      handlePatchEnvironmentConfig({
                        trafficPolicy: {
                          ...config.trafficPolicy,
                          maxErrorRatePercent: Number.isFinite(value) ? Math.max(0, value) : 0,
                        },
                      })
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <Label>Max latency (ms)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={String(config.trafficPolicy.maxLatencyMs)}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      handlePatchEnvironmentConfig({
                        trafficPolicy: {
                          ...config.trafficPolicy,
                          maxLatencyMs: Number.isFinite(value) ? Math.max(1, value) : 1,
                        },
                      })
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border border-border/60 p-2">
                <div>
                  <p className="text-sm font-medium">Allow cross-region failover</p>
                  <p className="text-xs text-muted-foreground">Permit traffic fallback between regions under load spikes.</p>
                </div>
                <Switch
                  checked={config.trafficPolicy.allowCrossRegionFailover}
                  onCheckedChange={(checked) => {
                    handlePatchEnvironmentConfig({
                      trafficPolicy: {
                        ...config.trafficPolicy,
                        allowCrossRegionFailover: checked,
                      },
                    })
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="variables" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Environment variables</CardTitle>
              <CardDescription>Variables specific to {env}. Global defaults are listed for reference below.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 lg:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={newVariableKey}
                  onChange={(event) => {
                    setNewVariableKey(event.target.value)
                  }}
                  placeholder="VARIABLE_KEY"
                />
                <Input
                  value={newVariableValue}
                  onChange={(event) => {
                    setNewVariableValue(event.target.value)
                  }}
                  placeholder="value"
                />
                <Button type="button" variant="outline" onClick={handleAddEnvironmentVariable}>
                  Add variable
                </Button>
              </div>

              <div className="space-y-2">
                {Object.entries(config.variables).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs">{key}</p>
                      <p className="truncate text-xs text-muted-foreground">{value}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        handleRemoveEnvironmentVariable(key)
                      }}
                    >
                      remove
                    </Button>
                  </div>
                ))}

                {Object.keys(config.variables).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No environment-specific variables yet.</p>
                ) : null}
              </div>

              <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Global defaults</p>
                <div className="grid gap-1 md:grid-cols-2">
                  {Object.entries(projectConfig.environment.defaultVariables).map(([key, value]) => (
                    <p key={`default-variable-${key}`} className="truncate font-mono text-[11px] text-muted-foreground">
                      {key}={value}
                    </p>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Per-service overrides in {env}</CardTitle>
              <CardDescription>
                Toggle service availability, deployment strategy, replica bounds, and inspect dependency link routing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 rounded-md border border-border/60 bg-muted/10 p-3 md:grid-cols-[auto_auto_minmax(180px,1fr)_auto]">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handleApplyBulkServiceEnabled(true)
                  }}
                >
                  Enable all visible
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handleApplyBulkServiceEnabled(false)
                  }}
                >
                  Disable all visible
                </Button>
                <Select
                  value={bulkServiceStrategy}
                  onValueChange={(value) => {
                    setBulkServiceStrategy(value as ServiceEnvironmentOverride['strategy'])
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_STRATEGY_OPTIONS.map((option) => (
                      <SelectItem key={`bulk-service-strategy-${option}`} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={handleApplyBulkServiceStrategy}>
                  Apply strategy
                </Button>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={serviceSearch}
                  onChange={(event) => {
                    const value = event.target.value
                    setServiceSearch(value)
                    updateSearchParam('serviceSearch', value)
                  }}
                  placeholder="Search services..."
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Tip: replica values auto-adjust to preserve valid bounds.
              </p>

              <div className="overflow-x-auto rounded-md border border-border/60">
                <Table className="min-w-275">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Health</TableHead>
                      <TableHead>Enabled</TableHead>
                      <TableHead>Strategy</TableHead>
                      <TableHead>Replica override</TableHead>
                      <TableHead>Dependency route</TableHead>
                      <TableHead>Edges</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {serviceRows.map(({ service, environmentOverride, runtime, dependencyStats }) => {
                      const overrideReplicas = environmentOverride?.replicas ?? {
                        min: 0,
                        max: 1,
                      }
                      const isEnabled = !environmentOverride?.disabled

                      return (
                        <TableRow key={`${env}-${service.id}`}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{service.name}</p>
                              <p className="font-mono text-xs text-muted-foreground">{service.id}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                runtime?.health === 'passing'
                                  ? 'outline'
                                  : runtime?.health === 'warning'
                                    ? 'secondary'
                                    : 'destructive'
                              }
                            >
                              {runtime?.health ?? 'unknown'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={isEnabled}
                              onCheckedChange={(checked) => {
                                handlePatchServiceOverride(service.id, {
                                  disabled: !checked,
                                })
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={environmentOverride?.strategy ?? 'rolling'}
                              onValueChange={(value) => {
                                handlePatchServiceOverride(service.id, {
                                  strategy: value as ServiceEnvironmentOverride['strategy'],
                                })
                              }}
                            >
                              <SelectTrigger className="w-32.5">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SERVICE_STRATEGY_OPTIONS.map((option) => (
                                  <SelectItem key={`${service.id}-strategy-${option}`} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <div className="grid w-32.5 grid-cols-2 gap-1">
                              <Input
                                type="number"
                                min={0}
                                value={String(overrideReplicas.min)}
                                onChange={(event) => {
                                  const value = Number(event.target.value)
                                  const nextMin = Number.isFinite(value) ? Math.max(0, value) : 0
                                  handlePatchServiceOverride(service.id, {
                                    replicas: {
                                      ...overrideReplicas,
                                      min: nextMin,
                                      max: Math.max(overrideReplicas.max, nextMin),
                                    },
                                  })
                                }}
                              />
                              <Input
                                type="number"
                                min={1}
                                value={String(overrideReplicas.max)}
                                onChange={(event) => {
                                  const value = Number(event.target.value)
                                  const nextMax = Number.isFinite(value) ? Math.max(1, value) : 1
                                  handlePatchServiceOverride(service.id, {
                                    replicas: {
                                      ...overrideReplicas,
                                      min: overrideReplicas.min,
                                      max: Math.max(nextMax, overrideReplicas.min),
                                    },
                                  })
                                }}
                              />
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-xs text-muted-foreground">
                              {getOverrideTargetDescription(environmentOverride)}
                            </p>
                          </TableCell>
                          <TableCell>
                            <p className="text-xs text-muted-foreground">
                              {dependencyStats.outgoing} out · {dependencyStats.incoming} in
                            </p>
                          </TableCell>
                        </TableRow>
                      )
                    })}

                    {serviceRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                          No services match your search query.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dependencies" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-4 w-4" />
                Dependency policies in {env}
              </CardTitle>
              <CardDescription>Override requirement, health gate, startup mode, retry count, and timeout for each edge.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid gap-2 rounded-md border border-border/60 bg-muted/10 p-3 md:grid-cols-[minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_auto]">
                <Select
                  value={bulkRequirement}
                  onValueChange={(value) => {
                    setBulkRequirement(value as DependencyRequirement)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Requirement" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPENDENCY_REQUIREMENT_OPTIONS.map((option) => (
                      <SelectItem key={`bulk-requirement-${option}`} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={bulkHealthGate}
                  onValueChange={(value) => {
                    setBulkHealthGate(value as DependencyHealthGate)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Health gate" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPENDENCY_HEALTH_OPTIONS.map((option) => (
                      <SelectItem key={`bulk-health-${option}`} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={bulkStartup}
                  onValueChange={(value) => {
                    setBulkStartup(value as DependencyStartup)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Startup" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPENDENCY_STARTUP_OPTIONS.map((option) => (
                      <SelectItem key={`bulk-startup-${option}`} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button type="button" variant="outline" onClick={handleApplyBulkDependencyPolicy}>
                  <WandSparkles className="mr-2 h-4 w-4" />
                  Apply to active edges
                </Button>
              </div>

              <div className="overflow-x-auto rounded-md border border-border/60">
                <Table className="min-w-245">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dependency</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Requirement</TableHead>
                      <TableHead>Health gate</TableHead>
                      <TableHead>Startup</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead>Timeout (s)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dependencyRows.map(({ dependency, policyKey, sourceService, targetService, isActive, policy }) => (
                      <TableRow key={`${env}-${dependency.id}`}>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">
                              {sourceService?.name ?? dependency.serviceId} → {targetService?.name ?? dependency.dependsOnServiceId}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground">{dependency.id}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={isActive ? 'outline' : 'secondary'}>{isActive ? 'active' : 'disabled'}</Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={(policy?.requirement as DependencyRequirement | undefined) ?? 'required'}
                            onValueChange={(value) => {
                              handlePatchDependencyPolicy(policyKey, {
                                requirement: value as DependencyRequirement,
                              })
                            }}
                          >
                            <SelectTrigger className="w-32.5">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DEPENDENCY_REQUIREMENT_OPTIONS.map((option) => (
                                <SelectItem key={`${dependency.id}-requirement-${option}`} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={(policy?.healthGate as DependencyHealthGate | undefined) ?? 'must-pass'}
                            onValueChange={(value) => {
                              handlePatchDependencyPolicy(policyKey, {
                                healthGate: value as DependencyHealthGate,
                              })
                            }}
                          >
                            <SelectTrigger className="w-32.5">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DEPENDENCY_HEALTH_OPTIONS.map((option) => (
                                <SelectItem key={`${dependency.id}-health-${option}`} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={(policy?.startup as DependencyStartup | undefined) ?? 'before'}
                            onValueChange={(value) => {
                              handlePatchDependencyPolicy(policyKey, {
                                startup: value as DependencyStartup,
                              })
                            }}
                          >
                            <SelectTrigger className="w-30">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DEPENDENCY_STARTUP_OPTIONS.map((option) => (
                                <SelectItem key={`${dependency.id}-startup-${option}`} value={option}>
                                  {option}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            className="w-22.5"
                            type="number"
                            min={0}
                            value={String(policy?.maxRetries ?? 3)}
                            onChange={(event) => {
                              const value = Number(event.target.value)
                              handlePatchDependencyPolicy(policyKey, {
                                maxRetries: Number.isFinite(value) ? Math.max(0, value) : 0,
                              })
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="w-27.5"
                            type="number"
                            min={1}
                            value={String(policy?.timeoutSeconds ?? 30)}
                            onChange={(event) => {
                              const value = Number(event.target.value)
                              handlePatchDependencyPolicy(policyKey, {
                                timeoutSeconds: Number.isFinite(value) ? Math.max(1, value) : 1,
                              })
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="sticky bottom-3 z-20 border-border/70 bg-background/95 backdrop-blur">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div>
            <p className="text-sm font-medium">Environment actions</p>
            <p className="text-xs text-muted-foreground">
              {hasUnsavedChanges
                ? 'Unsaved changes detected. Save or reset before leaving this page.'
                : 'No pending changes.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={!hasUnsavedChanges} onClick={handleResetAll}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
            <Button
              type="button"
              disabled={!hasUnsavedChanges}
              onClick={() => {
                toast.success('Environment updates stored in fixture state')
              }}
            >
              <Save className="mr-2 h-4 w-4" />
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
