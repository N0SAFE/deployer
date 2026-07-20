'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ENV_NAMES, type EnvName } from '@repo/contracts-common'
import {
  getDependencyGraphMockScenario,
  getDependencyPolicyKey,
  type DependencyPolicyOverrideMap,
import type { ProjectConfiguration, ServiceConfigEntry } from '@repo/contracts-entities'
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
import { ArrowLeft, Network, RotateCcw, Save, Search, SlidersHorizontal, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'

type DependencyRequirement = 'required' | 'optional' | 'disabled'
type DependencyHealthGate = 'must-pass' | 'warn' | 'ignore'
type DependencyStartup = 'before' | 'parallel' | 'after'

const DEPENDENCY_REQUIREMENT_OPTIONS: readonly DependencyRequirement[] = ['required', 'optional', 'disabled'] as const
const DEPENDENCY_HEALTH_OPTIONS: readonly DependencyHealthGate[] = ['must-pass', 'warn', 'ignore'] as const
const DEPENDENCY_STARTUP_OPTIONS: readonly DependencyStartup[] = ['before', 'parallel', 'after'] as const
const CONFIG_TABS = ['overview', 'environments', 'services', 'dependencies'] as const
type ConfigTabValue = (typeof CONFIG_TABS)[number]

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function parseDependencyPolicyKey(policyKey: string): { sourceServiceId: string; targetServiceId: string } {
  const [sourceServiceId = '', targetServiceId = ''] = policyKey.split(':')
  return { sourceServiceId, targetServiceId }
}

export default function DashboardProjectConfigurationPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const scenario = useMemo(() => getDependencyGraphMockScenario(projectId), [projectId])

  const selectedTab = (() => {
    const tab = searchParams.get('tab')
    if (tab && CONFIG_TABS.includes(tab as ConfigTabValue)) {
      return tab as ConfigTabValue
    }
    return 'overview'
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
  const [policyEnvironment, setPolicyEnvironment] = useState<string>(() => searchParams.get('policyEnv') ?? 'production')
  const [defaultVariableKey, setDefaultVariableKey] = useState('')
  const [defaultVariableValue, setDefaultVariableValue] = useState('')
  const [bulkPinnedEnvironment, setBulkPinnedEnvironment] = useState<string>('any')
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

  const environmentEntries = useMemo(() => {
    return Object.entries(projectConfig.environment.environments).map(([environment, config]) => [
      environment,
      config,
    ] as const)
  }, [projectConfig.environment.environments])

  const serviceById = useMemo(() => {
    return new Map(scenario.services.map((service) => [service.id, service]))
  }, [scenario.services])

  const dependencyStatsByServiceId = useMemo(() => {
    const map = new Map<string, { outgoing: number; incoming: number }>()

    for (const service of scenario.services) {
      map.set(service.id, { outgoing: 0, incoming: 0 })
    }

    for (const dependency of scenario.dependencies) {
      const source = map.get(dependency.serviceId)
      const target = map.get(dependency.dependsOnServiceId)
      if (source) source.outgoing += 1
      if (target) target.incoming += 1
    }

    return map
  }, [scenario.dependencies, scenario.services])

  const availablePolicyEnvironments = useMemo(() => {
    const set = new Set<string>([...ENV_NAMES])

    for (const [environmentName] of environmentEntries) {
      set.add(environmentName)
    }

    for (const dependency of scenario.dependencies) {
      for (const environmentName of dependency.enabledIn ?? []) {
        set.add(environmentName)
      }
    }

    for (const override of Object.values(policyOverridesByKey)) {
      for (const environmentName of Object.keys(override ?? {})) {
        set.add(environmentName)
      }
    }

    return Array.from(set).sort((left, right) => left.localeCompare(right))
  }, [environmentEntries, policyOverridesByKey, scenario.dependencies])

  const environmentSnapshots = useMemo(() => {
    return environmentEntries.map(([environmentName, config]) => {
      let enabledServices = 0
      let healthyServices = 0
      let warningServices = 0
      let failingServices = 0

      for (const service of scenario.services) {
        const serviceConfig = serviceConfigsById[service.id]
        if (!serviceConfig) {
          continue
        }

        const override = serviceConfig.executionOverrides[environmentName as EnvName]
        const isEnabled = !override?.disabled
        if (isEnabled) {
          enabledServices += 1
        }

        const runtimeStatus = serviceConfig.statusByEnvironment[environmentName as EnvName]
          ?? serviceConfig.statusByEnvironment.production

        if (runtimeStatus.health === 'passing') {
          healthyServices += 1
        } else if (runtimeStatus.health === 'warning') {
          warningServices += 1
        } else if (runtimeStatus.health === 'failing') {
          failingServices += 1
        }
      }

      const deploymentsCount = scenario.deployments.filter((deployment) => deployment.environment === environmentName).length
      const incidentsCount = scenario.incidents.filter((incident) => incident.environment === environmentName).length

      return {
        environmentName,
        config,
        enabledServices,
        healthyServices,
        warningServices,
        failingServices,
        deploymentsCount,
        incidentsCount,
      }
    })
  }, [environmentEntries, scenario.deployments, scenario.incidents, scenario.services, serviceConfigsById])

  const healthScore = useMemo(() => {
    const productionSnapshot = environmentSnapshots.find((snapshot) => snapshot.environmentName === 'production')
    if (!productionSnapshot || scenario.services.length === 0) {
      return 0
    }

    return Math.round((productionSnapshot.healthyServices / scenario.services.length) * 100)
  }, [environmentSnapshots, scenario.services.length])

  const policyOverrideCount = useMemo(() => {
    return Object.values(policyOverridesByKey).reduce((count, overrideMap) => {
      return count + Object.keys(overrideMap ?? {}).length
    }, 0)
  }, [policyOverridesByKey])

  const filteredServiceRows = useMemo(() => {
    const query = serviceSearch.trim().toLowerCase()

    return scenario.services
      .map((service) => {
        const config = serviceConfigsById[service.id]
        const dependencyStats = dependencyStatsByServiceId.get(service.id) ?? { outgoing: 0, incoming: 0 }

        return {
          service,
          config,
          dependencyStats,
        }
      })
      .filter(({ service, config }) => {
        if (!query) {
          return true
        }

        const providerType = config?.providerType ?? ''
        const runnerType = config?.runnerType ?? ''

        return (
          service.name.toLowerCase().includes(query)
          || service.type.toLowerCase().includes(query)
          || service.runtime.toLowerCase().includes(query)
          || service.id.toLowerCase().includes(query)
          || providerType.toLowerCase().includes(query)
          || runnerType.toLowerCase().includes(query)
        )
      })
      .sort((left, right) => left.service.name.localeCompare(right.service.name))
  }, [dependencyStatsByServiceId, scenario.services, serviceConfigsById, serviceSearch])

  const dependencyRows = useMemo(() => {
    return scenario.dependencies
      .map((dependency) => {
        const policyKey = getDependencyPolicyKey({
          serviceId: dependency.serviceId,
          dependsOnServiceId: dependency.dependsOnServiceId,
        })
        const environmentPolicy = policyOverridesByKey[policyKey]?.[policyEnvironment as EnvName]

        return {
          dependency,
          policyKey,
          sourceService: serviceById.get(dependency.serviceId),
          targetService: serviceById.get(dependency.dependsOnServiceId),
          isEnabledInSelectedEnvironment:
            !dependency.enabledIn
            || dependency.enabledIn.length === 0
            || dependency.enabledIn.includes(policyEnvironment as EnvName),
          policy: environmentPolicy,
        }
      })
      .sort((left, right) => {
        const leftSource = left.sourceService?.name ?? left.dependency.serviceId
        const rightSource = right.sourceService?.name ?? right.dependency.serviceId
        return leftSource.localeCompare(rightSource)
      })
  }, [policyEnvironment, policyOverridesByKey, scenario.dependencies, serviceById])

  const handlePatchServiceConfig = (serviceId: string, patch: Partial<ServiceConfigEntry>) => {
    setServiceConfigsById((previous) => {
      const current = previous[serviceId]
      if (!current) {
        return previous
      }

      return {
        ...previous,
        [serviceId]: {
          ...current,
          ...patch,
        },
      }
    })
  }

  const handleApplyBulkAutoscale = (enabled: boolean) => {
    const targetIds = filteredServiceRows.map((row) => row.service.id)
    if (targetIds.length === 0) {
      toast.info('No visible services to update')
      return
    }

    setServiceConfigsById((previous) => {
      const next = { ...previous }
      for (const serviceId of targetIds) {
        const current = next[serviceId]
        if (!current) {
          continue
        }
        next[serviceId] = {
          ...current,
          autoscaleEnabled: enabled,
        }
      }
      return next
    })

    toast.success(`${String(targetIds.length)} services updated`)
  }

  const handleApplyBulkPinnedEnvironment = () => {
    const targetIds = filteredServiceRows.map((row) => row.service.id)
    if (targetIds.length === 0) {
      toast.info('No visible services to update')
      return
    }

    setServiceConfigsById((previous) => {
      const next = { ...previous }
      for (const serviceId of targetIds) {
        const current = next[serviceId]
        if (!current) {
          continue
        }
        next[serviceId] = {
          ...current,
          pinnedEnvironment: bulkPinnedEnvironment as ServiceConfigEntry['pinnedEnvironment'],
        }
      }
      return next
    })

    toast.success(`Pinned environment applied to ${String(targetIds.length)} services`)
  }

  const handleApplyBulkDependencyPolicy = () => {
    const targetDependencies = dependencyRows.filter((row) => row.isEnabledInSelectedEnvironment)
    if (targetDependencies.length === 0) {
      toast.info('No active dependencies in this scope')
      return
    }

    setPolicyOverridesByKey((previous) => {
      const next: DependencyPolicyOverrideMap = { ...previous }
      for (const row of targetDependencies) {
        const byEnvironment = next[row.policyKey] ?? {}
        const current = byEnvironment[selectedPolicyEnvironment as EnvName] ?? {}
        next[row.policyKey] = {
          ...byEnvironment,
          [selectedPolicyEnvironment]: {
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
    environmentName: string,
    patch: {
      requirement?: DependencyRequirement
      healthGate?: DependencyHealthGate
      startup?: DependencyStartup
      maxRetries?: number
      timeoutSeconds?: number
    },
  ) => {
    setPolicyOverridesByKey((previous) => {
      const currentByEnvironment = previous[policyKey] ?? {}
      const currentPolicy = currentByEnvironment[environmentName as EnvName] ?? {}

      return {
        ...previous,
        [policyKey]: {
          ...currentByEnvironment,
          [environmentName]: {
            ...currentPolicy,
            ...patch,
          },
        },
      }
    })
  }

  const handleAddDefaultVariable = () => {
    const key = defaultVariableKey.trim()

    if (key.length === 0) {
      toast.error('Variable key is required')
      return
    }

    setProjectConfig((previous) => ({
      ...previous,
      environment: {
        ...previous.environment,
        defaultVariables: {
          ...previous.environment.defaultVariables,
          [key]: defaultVariableValue,
        },
      },
    }))

    setDefaultVariableKey('')
    setDefaultVariableValue('')
  }

  const handleRemoveDefaultVariable = (key: string) => {
    setProjectConfig((previous) => {
      const nextDefaultVariables = Object.fromEntries(
        Object.entries(previous.environment.defaultVariables).filter(([entryKey]) => entryKey !== key),
      )

      return {
        ...previous,
        environment: {
          ...previous.environment,
          defaultVariables: nextDefaultVariables,
        },
      }
    })
  }

  const handleResetAll = () => {
    setProjectConfig(cloneValue(initialProjectConfig))
    setServiceConfigsById(cloneValue(initialServiceConfigsById))
    setPolicyOverridesByKey(cloneValue(initialPolicyOverridesByKey))
    setDefaultVariableKey('')
    setDefaultVariableValue('')
    setServiceSearch('')
    updateSearchParam('serviceSearch', '')
    toast.info('Unsaved changes were discarded')
  }

  const selectedPolicyEnvironment = availablePolicyEnvironments.includes(policyEnvironment)
    ? policyEnvironment
    : (availablePolicyEnvironments.at(0) ?? 'production')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/projects/${projectId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to project
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Project configuration</h1>
            <p className="text-sm text-muted-foreground">
              {scenario.project.name} · tune deployment controls, environment behavior, service runtime defaults,
              and dependency policies.
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
              toast.success('Configuration changes stored in fixture state')
            }}
          >
            <Save className="h-4 w-4" />
            Save all
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Environment scopes</CardDescription>
            <CardTitle>{String(environmentEntries.length)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Preview {projectConfig.environment.previewEnabled ? 'enabled' : 'disabled'} · Development{' '}
              {projectConfig.environment.developmentEnabled ? 'enabled' : 'disabled'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Service configs</CardDescription>
            <CardTitle>{String(Object.keys(serviceConfigsById).length)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {String(filteredServiceRows.length)} visible · {String(scenario.services.length)} total services
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Dependency policy overrides</CardDescription>
            <CardTitle>{String(policyOverrideCount)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Across {String(Object.keys(policyOverridesByKey).length)} dependency links</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Production health score</CardDescription>
            <CardTitle>{String(healthScore)}%</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-1.5 rounded bg-muted">
              <div className="h-full rounded bg-emerald-500" style={{ width: `${String(healthScore)}%` }} />
            </div>
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
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="environments">Environments</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                Project identity + release policy
              </CardTitle>
              <CardDescription>High-level controls used by deployment orchestration and policy gates.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-1">
                <Label>Project name</Label>
                <Input
                  value={projectConfig.general.projectName}
                  onChange={(event) => {
                    const value = event.target.value
                    setProjectConfig((previous) => ({
                      ...previous,
                      general: {
                        ...previous.general,
                        projectName: value,
                      },
                    }))
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Default branch</Label>
                <Input
                  value={projectConfig.general.defaultBranch}
                  onChange={(event) => {
                    const value = event.target.value
                    setProjectConfig((previous) => ({
                      ...previous,
                      general: {
                        ...previous.general,
                        defaultBranch: value,
                      },
                    }))
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Owner team</Label>
                <Input
                  value={projectConfig.general.ownerTeam}
                  onChange={(event) => {
                    const value = event.target.value
                    setProjectConfig((previous) => ({
                      ...previous,
                      general: {
                        ...previous.general,
                        ownerTeam: value,
                      },
                    }))
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Release cadence</Label>
                <Select
                  value={projectConfig.general.releasePolicy.cadence}
                  onValueChange={(value) => {
                    setProjectConfig((previous) => ({
                      ...previous,
                      general: {
                        ...previous.general,
                        releasePolicy: {
                          ...previous.general.releasePolicy,
                          cadence: value,
                        },
                      },
                    }))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">hourly</SelectItem>
                    <SelectItem value="daily">daily</SelectItem>
                    <SelectItem value="weekly">weekly</SelectItem>
                    <SelectItem value="on-demand">on-demand</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2 xl:col-span-1">
                <Label>Freeze window (UTC)</Label>
                <Input
                  value={projectConfig.general.releasePolicy.freezeWindowUtc}
                  onChange={(event) => {
                    const value = event.target.value
                    setProjectConfig((previous) => ({
                      ...previous,
                      general: {
                        ...previous.general,
                        releasePolicy: {
                          ...previous.general.releasePolicy,
                          freezeWindowUtc: value,
                        },
                      },
                    }))
                  }}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border/60 p-2 md:col-span-2 xl:col-span-3">
                <div>
                  <p className="text-sm font-medium">Progressive rollout</p>
                  <p className="text-xs text-muted-foreground">Gradually route traffic during production changes.</p>
                </div>
                <Switch
                  checked={projectConfig.general.releasePolicy.progressiveRollout}
                  onCheckedChange={(checked) => {
                    setProjectConfig((previous) => ({
                      ...previous,
                      general: {
                        ...previous.general,
                        releasePolicy: {
                          ...previous.general.releasePolicy,
                          progressiveRollout: checked,
                        },
                      },
                    }))
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Deployment defaults</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Strategy</span>
                  <Badge variant="outline">{projectConfig.deployment.deploymentStrategy}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Max parallel services</span>
                  <span className="font-medium">{String(projectConfig.deployment.maxParallelServiceDeployments)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Rollback window</span>
                  <span className="font-medium">{String(projectConfig.deployment.rollbackWindowSeconds)}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Health timeout</span>
                  <span className="font-medium">{String(projectConfig.deployment.healthCheckTimeoutSeconds)}s</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Security posture</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">HTTPS redirect</span>
                  <Badge variant={projectConfig.security.enableHttpsRedirect ? 'default' : 'secondary'}>
                    {projectConfig.security.enableHttpsRedirect ? 'on' : 'off'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">mTLS internal traffic</span>
                  <Badge variant={projectConfig.security.mTLSInternalTraffic ? 'default' : 'secondary'}>
                    {projectConfig.security.mTLSInternalTraffic ? 'on' : 'off'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Zero trust policies</span>
                  <Badge variant={projectConfig.security.zeroTrustPoliciesEnabled ? 'default' : 'secondary'}>
                    {projectConfig.security.zeroTrustPoliciesEnabled ? 'on' : 'off'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {projectConfig.security.allowedIngressCidrs.length} ingress CIDRs · {projectConfig.security.ssoProviders.length} SSO providers
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notifications</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <Badge variant={projectConfig.notification.enableEmailNotifications ? 'default' : 'secondary'}>
                    {projectConfig.notification.enableEmailNotifications ? 'on' : 'off'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Slack</span>
                  <Badge variant={projectConfig.notification.enableSlackNotifications ? 'default' : 'secondary'}>
                    {projectConfig.notification.enableSlackNotifications ? 'on' : 'off'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Channels: {projectConfig.notification.slackChannels.join(', ')}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="environments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Environment capabilities</CardTitle>
              <CardDescription>Enable or disable optional environment families for this project.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                <div>
                  <p className="text-sm font-medium">Preview environment family</p>
                  <p className="text-xs text-muted-foreground">Allow preview runtime scopes and session-linked deploys.</p>
                </div>
                <Switch
                  checked={projectConfig.environment.previewEnabled}
                  onCheckedChange={(checked) => {
                    setProjectConfig((previous) => ({
                      ...previous,
                      environment: {
                        ...previous.environment,
                        previewEnabled: checked,
                      },
                    }))
                  }}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
                <div>
                  <p className="text-sm font-medium">Development environment family</p>
                  <p className="text-xs text-muted-foreground">Allow non-prod iterative runtime scopes and overrides.</p>
                </div>
                <Switch
                  checked={projectConfig.environment.developmentEnabled}
                  onCheckedChange={(checked) => {
                    setProjectConfig((previous) => ({
                      ...previous,
                      environment: {
                        ...previous.environment,
                        developmentEnabled: checked,
                      },
                    }))
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Default environment variables</CardTitle>
              <CardDescription>Shared baseline env vars inherited by every environment scope.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 lg:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={defaultVariableKey}
                  onChange={(event) => {
                    setDefaultVariableKey(event.target.value)
                  }}
                  placeholder="VARIABLE_KEY"
                />
                <Input
                  value={defaultVariableValue}
                  onChange={(event) => {
                    setDefaultVariableValue(event.target.value)
                  }}
                  placeholder="value"
                />
                <Button type="button" variant="outline" onClick={handleAddDefaultVariable}>
                  Add variable
                </Button>
              </div>

              <div className="space-y-2">
                {Object.entries(projectConfig.environment.defaultVariables).map(([key, value]) => (
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
                        handleRemoveDefaultVariable(key)
                      }}
                    >
                      remove
                    </Button>
                  </div>
                ))}
                {Object.keys(projectConfig.environment.defaultVariables).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No default variables defined yet.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {environmentSnapshots.map((snapshot) => (
              <Card key={snapshot.environmentName}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span>{snapshot.environmentName}</span>
                    <Badge variant="outline">
                      {snapshot.enabledServices}/{scenario.services.length} enabled
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {snapshot.deploymentsCount} deployments · {snapshot.incidentsCount} incidents
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Strategy</span>
                    <Badge variant="outline">{snapshot.config.deploymentStrategy}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Replicas</span>
                    <span className="font-medium">
                      {String(snapshot.config.replicas.min)} - {String(snapshot.config.replicas.max)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Health states</span>
                    <span className="font-medium text-xs">
                      {String(snapshot.healthyServices)} pass · {String(snapshot.warningServices)} warn · {String(snapshot.failingServices)} fail
                    </span>
                  </div>
                  <Button asChild variant="outline" className="w-full" size="sm">
                    <Link href={`/dashboard/projects/${projectId}/configuration/environments/${snapshot.environmentName}`}>
                      Open detailed editor
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="services" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Service runtime controls</CardTitle>
              <CardDescription>Adjust autoscaling profile and environment pinning for each service.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 rounded-md border border-border/60 bg-muted/10 p-3 md:grid-cols-[auto_auto_minmax(200px,1fr)_auto]">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handleApplyBulkAutoscale(true)
                  }}
                >
                  Enable autoscale (visible)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handleApplyBulkAutoscale(false)
                  }}
                >
                  Disable autoscale (visible)
                </Button>
                <Select value={bulkPinnedEnvironment} onValueChange={setBulkPinnedEnvironment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">any</SelectItem>
                    {availablePolicyEnvironments.map((environmentName) => (
                      <SelectItem key={`bulk-${environmentName}`} value={environmentName}>
                        {environmentName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={handleApplyBulkPinnedEnvironment}>
                  Apply pinned env
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
                  placeholder="Search services, provider, runner..."
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Tip: replica values auto-adjust to ensure min ≤ max.
              </p>

              <div className="overflow-x-auto rounded-md border border-border/60">
                <Table className="min-w-220">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Provider / Runner</TableHead>
                      <TableHead>Autoscale</TableHead>
                      <TableHead>Replicas</TableHead>
                      <TableHead>Pinned env</TableHead>
                      <TableHead>Dependencies</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredServiceRows.map(({ service, config, dependencyStats }) => (
                      <TableRow key={service.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{service.name}</p>
                            <p className="font-mono text-xs text-muted-foreground">{service.id}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline">{config?.providerType ?? '—'}</Badge>
                            <Badge variant="outline">{config?.runnerType ?? '—'}</Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={config?.autoscaleEnabled ?? false}
                            onCheckedChange={(checked) => {
                              handlePatchServiceConfig(service.id, { autoscaleEnabled: checked })
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="grid max-w-35 grid-cols-2 gap-1">
                            <Input
                              type="number"
                              min={0}
                              value={String(config?.minReplicas ?? 0)}
                              onChange={(event) => {
                                const value = Number(event.target.value)
                                const nextMin = Number.isFinite(value) ? Math.max(0, value) : 0
                                const currentMax = config?.maxReplicas ?? 1
                                handlePatchServiceConfig(service.id, {
                                  minReplicas: nextMin,
                                  maxReplicas: Math.max(currentMax, nextMin),
                                })
                              }}
                            />
                            <Input
                              type="number"
                              min={1}
                              value={String(config?.maxReplicas ?? 1)}
                              onChange={(event) => {
                                const value = Number(event.target.value)
                                const currentMin = config?.minReplicas ?? 0
                                const nextMax = Number.isFinite(value) ? Math.max(1, value) : 1
                                handlePatchServiceConfig(service.id, {
                                  minReplicas: currentMin,
                                  maxReplicas: Math.max(nextMax, currentMin),
                                })
                              }}
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={config?.pinnedEnvironment ?? 'any'}
                            onValueChange={(value) => {
                              handlePatchServiceConfig(service.id, {
                                pinnedEnvironment: value as ServiceConfigEntry['pinnedEnvironment'],
                              })
                            }}
                          >
                            <SelectTrigger className="w-37.5">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">any</SelectItem>
                              {availablePolicyEnvironments.map((environmentName) => (
                                <SelectItem key={`${service.id}-${environmentName}`} value={environmentName}>
                                  {environmentName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <p className="text-xs text-muted-foreground">
                            {String(dependencyStats.outgoing)} out · {String(dependencyStats.incoming)} in
                          </p>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredServiceRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
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
                Dependency policy overrides
              </CardTitle>
              <CardDescription>
                Tune per-environment dependency requirement, health gates, startup ordering, and retry budget.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-w-65 space-y-1">
                <Label>Environment scope</Label>
                <Select
                  value={selectedPolicyEnvironment}
                  onValueChange={(value) => {
                    setPolicyEnvironment(value)
                    updateSearchParam('policyEnv', value)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePolicyEnvironments.map((environmentName) => (
                      <SelectItem key={environmentName} value={environmentName}>
                        {environmentName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2 rounded-md border border-border/60 bg-muted/10 p-3 md:grid-cols-[minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_auto]">
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
                      <TableHead>Enabled</TableHead>
                      <TableHead>Requirement</TableHead>
                      <TableHead>Health gate</TableHead>
                      <TableHead>Startup</TableHead>
                      <TableHead>Retries</TableHead>
                      <TableHead>Timeout (s)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dependencyRows.map(({ dependency, policyKey, sourceService, targetService, isEnabledInSelectedEnvironment, policy }) => (
                      <TableRow key={`${dependency.id}-${selectedPolicyEnvironment}`}>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">
                              {sourceService?.name ?? dependency.serviceId} → {targetService?.name ?? dependency.dependsOnServiceId}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground">{dependency.id}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={isEnabledInSelectedEnvironment ? 'outline' : 'secondary'}>
                            {isEnabledInSelectedEnvironment ? 'active' : 'disabled'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={(policy?.requirement as DependencyRequirement | undefined) ?? 'required'}
                            onValueChange={(value) => {
                              handlePatchDependencyPolicy(policyKey, selectedPolicyEnvironment, {
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
                              handlePatchDependencyPolicy(policyKey, selectedPolicyEnvironment, {
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
                              handlePatchDependencyPolicy(policyKey, selectedPolicyEnvironment, {
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
                              handlePatchDependencyPolicy(policyKey, selectedPolicyEnvironment, {
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
                              handlePatchDependencyPolicy(policyKey, selectedPolicyEnvironment, {
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

              <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                <p className="text-xs font-medium">Policy key reference</p>
                <div className="mt-2 grid gap-1 md:grid-cols-2">
                  {Object.keys(policyOverridesByKey).slice(0, 8).map((policyKey) => {
                    const parsed = parseDependencyPolicyKey(policyKey)
                    return (
                      <p key={`policy-key-${policyKey}`} className="font-mono text-[11px] text-muted-foreground">
                        {parsed.sourceServiceId} → {parsed.targetServiceId}
                      </p>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="sticky bottom-3 z-20 border-border/70 bg-background/95 backdrop-blur">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div>
            <p className="text-sm font-medium">Configuration actions</p>
            <p className="text-xs text-muted-foreground">
              {hasUnsavedChanges
                ? 'You have unsaved changes. Save or reset before leaving this page.'
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
                toast.success('Configuration changes stored in fixture state')
              }}
            >
              <Save className="mr-2 h-4 w-4" />
              Save all
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
