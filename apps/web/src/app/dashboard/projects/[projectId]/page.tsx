'use client'

import Link from 'next/link'
import { AuthDashboardProjects } from '@/routes'
import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  MOCK_DEPENDENCIES_BY_PROJECT,
  MOCK_DEPLOYMENTS,
  MOCK_INCIDENTS,
  MOCK_NOTIFICATIONS,
  MOCK_PROJECT_CONFIGURATIONS,
  MOCK_PROJECTS,
  MOCK_SERVICE_CONFIGS_BY_PROJECT,
  MOCK_SERVICES_BY_PROJECT,
} from '@/mocks/platform'
import {
  ServiceDependencyGraphPanel,
  type ServiceGraphDependencyRoute,
  type ServiceGraphNode,
} from '../_components/ServiceDependencyGraphPanel'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/shadcn/popover'
import { ArrowLeft, ArrowRight, ChevronDown, Filter, Plus, Search, Settings, Siren, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { ENV_NAMES, type EnvName } from '@repo/contracts-common'
import { matchFilter, type DFilter, type DFilterOperator } from '@repo/auth'
import type { FixtureDependency, ServiceConfigEntry } from '@repo/contracts-entities'


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

type EnvironmentScopeSource = 'core-default' | 'status-by-environment' | 'execution-override' | 'deployment-scope'

interface ServiceEnvironmentContract {
  serviceId: string
  declaredScopes: string[]
  scopeSourceMap: Record<string, EnvironmentScopeSource[]>
  variableKeysByScope: Record<string, string[]>
}

interface DependencyRoutePreview {
  dependencyId: string
  targetServiceId: string
  sourceScope: string
  targetScope: string
  accessible: boolean
}

const QUICK_SERVICE_FILTER_TAGS = ['at-risk', 'healthy', 'has-dependencies', 'no-dependencies', 'active', 'inactive'] as const

const ADVANCED_FILTER_FIELDS = [
  { value: 'name', label: 'name' },
  { value: 'id', label: 'id' },
  { value: 'type', label: 'type' },
  { value: 'runtime', label: 'runtime' },
  { value: 'providerType', label: 'provider' },
  { value: 'runnerType', label: 'runner' },
  { value: 'state', label: 'state' },
  { value: 'health', label: 'health' },
  { value: 'environments', label: 'environment scopes' },
] as const

const ADVANCED_FILTER_OPERATORS = [
  { value: '_icontains', label: 'contains (ci)' },
  { value: '_eq', label: 'equals' },
  { value: '_neq', label: 'not equals' },
  { value: '_starts_with', label: 'starts with' },
  { value: '_ends_with', label: 'ends with' },
  { value: '_in', label: 'in list' },
  { value: '_nin', label: 'not in list' },
] as const

type AdvancedFilterField = (typeof ADVANCED_FILTER_FIELDS)[number]['value']
type AdvancedFilterOperator = (typeof ADVANCED_FILTER_OPERATORS)[number]['value']
type AdvancedFilterLogic = '_and' | '_or'

interface ServiceFilterRecord extends Record<string, unknown> {
  name: string
  id: string
  type: string
  runtime: string
  providerType: string
  runnerType: string
  state: string
  health: string
  environments: string
}

interface AdvancedServiceFilterRule {
  id: string
  field: AdvancedFilterField
  operator: AdvancedFilterOperator
  value: string
}

function buildAdvancedRuleOperator(rule: AdvancedServiceFilterRule): DFilterOperator<string> | null {
  const normalizedValue = rule.value.trim()

  if (rule.operator === '_in' || rule.operator === '_nin') {
    const values = normalizedValue
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)

    if (values.length === 0) {
      return null
    }

    return rule.operator === '_in' ? { _in: values } : { _nin: values }
  }

  if (normalizedValue.length === 0) {
    return null
  }

  if (rule.operator === '_eq') {
    return { _eq: normalizedValue }
  }

  if (rule.operator === '_neq') {
    return { _neq: normalizedValue }
  }

  if (rule.operator === '_starts_with') {
    return { _starts_with: normalizedValue }
  }

  if (rule.operator === '_ends_with') {
    return { _ends_with: normalizedValue }
  }

  return { _icontains: normalizedValue }
}

function describeAdvancedRule(rule: AdvancedServiceFilterRule): string {
  const fieldLabel = ADVANCED_FILTER_FIELDS.find((entry) => entry.value === rule.field)?.label ?? rule.field
  const operatorLabel = ADVANCED_FILTER_OPERATORS.find((entry) => entry.value === rule.operator)?.label ?? rule.operator
  return `${fieldLabel} ${operatorLabel} ${rule.value.trim()}`.trim()
}

function normalizeIdentifierSegment(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isDependencyEnabledInScope(dependency: FixtureDependency, scope: string): boolean {
  if (!dependency.enabledIn || dependency.enabledIn.length === 0) {
    return true
  }

  if (dependency.enabledIn.includes(scope as EnvName)) {
    return true
  }

  if (scope.startsWith('preview/') && dependency.enabledIn.includes('preview')) {
    return true
  }

  return false
}

function resolveDependencyTargetScope(input: {
  sourceScope: string
  sourceConfig?: ServiceConfigEntry
}): string {
  const override = input.sourceConfig?.executionOverrides[input.sourceScope as EnvName]
  const targetPolicy = override?.dependencyLinkPolicy?.target

  if (!targetPolicy) {
    return input.sourceScope
  }

  if (targetPolicy.mode === 'same-environment') {
    return input.sourceScope
  }

  if (targetPolicy.mode === 'fixed-environment') {
    return targetPolicy.targetEnvironment
  }

  return targetPolicy.fallbackEnvironment
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function shortId(value: string): string {
  return value.slice(0, 8)
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.toLowerCase()
  if (normalized === 'success' || normalized === 'active' || normalized === 'healthy') return 'default'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'failing') return 'destructive'
  if (normalized === 'in-progress' || normalized === 'starting' || normalized === 'degraded') return 'secondary'
  return 'outline'
}

export default function DashboardProjectDetailPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState('web')
  const [createRuntime, setCreateRuntime] = useState('nodejs')
  const [createDescription, setCreateDescription] = useState('')

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [riskFilter, setRiskFilter] = useState<'all' | 'at-risk' | 'healthy'>('all')
  const [environmentFilter, setEnvironmentFilter] = useState<string>('all')
  const [runtimeFilter, setRuntimeFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [runnerFilter, setRunnerFilter] = useState<string>('all')
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [advancedFilterLogic, setAdvancedFilterLogic] = useState<AdvancedFilterLogic>('_and')
  const [advancedFilterRules, setAdvancedFilterRules] = useState<AdvancedServiceFilterRule[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [contractInspectorServiceId, setContractInspectorServiceId] = useState<string | null>(null)
  const [contractInspectorScope, setContractInspectorScope] = useState<string>('production')

  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId

  const project = useMemo(() => MOCK_PROJECTS.find((item) => item.id === projectId) ?? null, [projectId])
  const [localServices, setLocalServices] = useState(() => MOCK_SERVICES_BY_PROJECT[projectId] ?? [])

  const dependencies = useMemo(() => MOCK_DEPENDENCIES_BY_PROJECT[projectId] ?? [], [projectId])
  const serviceConfigs = useMemo(() => MOCK_SERVICE_CONFIGS_BY_PROJECT[projectId] ?? {}, [projectId])
  const deployments = useMemo(
    () => MOCK_DEPLOYMENTS.filter((deployment) => deployment.projectId === projectId),
    [projectId],
  )
  const incidents = useMemo(() => MOCK_INCIDENTS.filter((incident) => incident.projectId === projectId), [projectId])
  const notifications = useMemo(
    () => MOCK_NOTIFICATIONS.filter((notification) => notification.projectId === projectId),
    [projectId],
  )

  const runtimeOptions = useMemo(() => {
    return Array.from(new Set(localServices.map((service) => service.runtime))).sort()
  }, [localServices])

  const typeOptions = useMemo(() => {
    return Array.from(new Set(localServices.map((service) => service.type))).sort()
  }, [localServices])

  const providerOptions = useMemo(() => {
    return Array.from(
      new Set(localServices.map((service) => serviceConfigs[service.id]?.providerType ?? 'unknown')),
    ).sort()
  }, [localServices, serviceConfigs])

  const runnerOptions = useMemo(() => {
    return Array.from(
      new Set(localServices.map((service) => serviceConfigs[service.id]?.runnerType ?? 'unknown')),
    ).sort()
  }, [localServices, serviceConfigs])

  const dependencyCountsByServiceId = useMemo(() => {
    const dependsOn = new Map<string, number>()
    const dependedBy = new Map<string, number>()

    for (const service of localServices) {
      dependsOn.set(service.id, 0)
      dependedBy.set(service.id, 0)
    }

    for (const dependency of dependencies) {
      dependsOn.set(dependency.serviceId, (dependsOn.get(dependency.serviceId) ?? 0) + 1)
      dependedBy.set(dependency.dependsOnServiceId, (dependedBy.get(dependency.dependsOnServiceId) ?? 0) + 1)
    }

    return { dependsOn, dependedBy }
  }, [dependencies, localServices])

  const serviceIncidentCountByServiceId = useMemo(() => {
    const map = new Map<string, number>()
    for (const service of localServices) {
      map.set(service.id, 0)
    }

    for (const incident of incidents) {
      for (const affectedServiceId of incident.affectedServiceIds) {
        map.set(affectedServiceId, (map.get(affectedServiceId) ?? 0) + 1)
      }
    }

    return map
  }, [incidents, localServices])

  const latestDeploymentByServiceId = useMemo(() => {
    const map = new Map<string, { status: string; startedAt: string }>()
    if (deployments.length === 0 || localServices.length === 0) return map

    localServices.forEach((service, index) => {
      const deployment = deployments[index % deployments.length]
      if (!deployment) {
        return
      }
      map.set(service.id, {
        status: deployment.status,
        startedAt: deployment.startedAt,
      })
    })

    return map
  }, [deployments, localServices])

  const latestNotification = useMemo(() => {
    return [...notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null
  }, [notifications])

  const activeServiceCount = useMemo(() => {
    return localServices.filter((service) => service.isActive).length
  }, [localServices])

  const openIncidentCount = useMemo(() => {
    return incidents.filter((item) => item.status === 'open').length
  }, [incidents])

  const criticalNotificationCount = useMemo(() => {
    return notifications.filter((item) => item.level === 'critical').length
  }, [notifications])

  const atRiskServiceCount = useMemo(() => {
    return localServices.filter(
      (service) =>
        (serviceIncidentCountByServiceId.get(service.id) ?? 0) > 0
        || latestDeploymentByServiceId.get(service.id)?.status === 'failed',
    ).length
  }, [latestDeploymentByServiceId, localServices, serviceIncidentCountByServiceId])

  const deploymentCountByEnvironment = useMemo(() => {
    const map = new Map<string, number>()
    for (const deployment of deployments) {
      map.set(deployment.environment, (map.get(deployment.environment) ?? 0) + 1)
    }
    return map
  }, [deployments])

  const previewSessionCount = useMemo(() => {
    return deployments.filter((deployment) => deployment.environment === 'preview' || deployment.environment.startsWith('preview/')).length
  }, [deployments])

  const environmentScopes = useMemo(() => {
    const dynamicSet = new Set<string>()

    for (const deployment of deployments) {
      dynamicSet.add(deployment.environment)
    }

    for (const service of localServices) {
      const config = serviceConfigs[service.id]
      if (!config) {
        continue
      }

      for (const env of Object.keys(isRecord(config.executionOverrides) ? config.executionOverrides : {})) {
        dynamicSet.add(env)
      }

      for (const env of Object.keys(isRecord(config.statusByEnvironment) ? config.statusByEnvironment : {})) {
        dynamicSet.add(env)
      }
    }

    const coreOrdered = [...ENV_NAMES]
    const dynamic = Array.from(dynamicSet)
      .filter((env) => !coreOrdered.includes(env as EnvName))
      .sort((left, right) => left.localeCompare(right))

    return [...coreOrdered, ...dynamic]
  }, [deployments, localServices, serviceConfigs])

  const enabledEnvironmentsByServiceId = useMemo(() => {
    const map = new Map<string, string[]>()

    for (const service of localServices) {
      const config = serviceConfigs[service.id]
      const executionOverrides = (config?.executionOverrides ?? {}) as Record<string, { disabled?: boolean } | undefined>
      const statusByEnvironment = (config?.statusByEnvironment ?? {}) as Record<string, unknown>

      const enabledEnvironments = environmentScopes.filter((env) => {
        const isCoreEnvironment = ENV_NAMES.includes(env as EnvName)
        const hasSignal = isCoreEnvironment || Boolean(executionOverrides[env]) || Boolean(statusByEnvironment[env])
        if (!hasSignal) {
          return false
        }

        return !executionOverrides[env]?.disabled
      })

      map.set(service.id, enabledEnvironments)
    }

    return map
  }, [environmentScopes, localServices, serviceConfigs])

  const serviceEnvironmentContractsById = useMemo(() => {
    const map = new Map<string, ServiceEnvironmentContract>()
    const projectConfiguration = MOCK_PROJECT_CONFIGURATIONS[projectId]
    const defaultVariableKeys = Object.keys(projectConfiguration?.environment.defaultVariables ?? {})
    const projectVariablesByScope: Record<string, Record<string, string>> = Object.fromEntries(
      Object.entries(projectConfiguration?.environment.environments ?? {}).map(([scope, config]) => [
        scope,
        config.variables,
      ]),
    )

    for (const service of localServices) {
      const config = serviceConfigs[service.id]
      const scopeSourceMap: Record<string, EnvironmentScopeSource[]> = {}

      for (const scope of environmentScopes) {
        const sources: EnvironmentScopeSource[] = []

        if (ENV_NAMES.includes(scope as EnvName)) {
          sources.push('core-default')
        }
        if (config?.statusByEnvironment[scope as EnvName]) {
          sources.push('status-by-environment')
        }
        if (config?.executionOverrides[scope as EnvName]) {
          sources.push('execution-override')
        }
        if (deploymentCountByEnvironment.get(scope)) {
          sources.push('deployment-scope')
        }

        if (sources.length > 0) {
          scopeSourceMap[scope] = sources
        }
      }

      const declaredScopes = Object.keys(scopeSourceMap)
      const variableKeysByScope: Record<string, string[]> = {}

      for (const scope of declaredScopes) {
        const projectScopeVariables = projectVariablesByScope[scope] ?? {}

        const variableKeys = new Set<string>([
          ...defaultVariableKeys,
          ...Object.keys(projectScopeVariables),
          'SERVICE_ID',
          'SERVICE_NAME',
          'SERVICE_TYPE',
          'SERVICE_RUNTIME',
        ])

        const outgoingDependencies = dependencies.filter((dependency) => dependency.serviceId === service.id)
        for (const dependency of outgoingDependencies) {
          if (!isDependencyEnabledInScope(dependency, scope)) {
            continue
          }

          const targetService = localServices.find((candidate) => candidate.id === dependency.dependsOnServiceId)
          const targetSegment = normalizeIdentifierSegment(targetService?.name ?? dependency.dependsOnServiceId)
          variableKeys.add(`DEP_${targetSegment}_HOST`)
          variableKeys.add(`DEP_${targetSegment}_URL`)
        }

        variableKeysByScope[scope] = Array.from(variableKeys).sort((left, right) => left.localeCompare(right))
      }

      map.set(service.id, {
        serviceId: service.id,
        declaredScopes,
        scopeSourceMap,
        variableKeysByScope,
      })
    }

    return map
  }, [dependencies, deploymentCountByEnvironment, environmentScopes, localServices, projectId, serviceConfigs])

  const dependencyRoutePreviewByServiceId = useMemo(() => {
    const map = new Map<string, DependencyRoutePreview[]>()

    for (const service of localServices) {
      const sourceConfig = serviceConfigs[service.id]
      const sourceScopes = serviceEnvironmentContractsById.get(service.id)?.declaredScopes ?? []
      const outgoingDependencies = dependencies.filter((dependency) => dependency.serviceId === service.id)
      const routes: DependencyRoutePreview[] = []

      for (const sourceScope of sourceScopes) {
        for (const dependency of outgoingDependencies) {
          if (!isDependencyEnabledInScope(dependency, sourceScope)) {
            continue
          }

          const targetScope = resolveDependencyTargetScope({ sourceScope, sourceConfig })
          const targetContract = serviceEnvironmentContractsById.get(dependency.dependsOnServiceId)
          const accessible = Boolean(targetContract?.declaredScopes.includes(targetScope))

          routes.push({
            dependencyId: dependency.id,
            targetServiceId: dependency.dependsOnServiceId,
            sourceScope,
            targetScope,
            accessible,
          })
        }
      }

      map.set(service.id, routes)
    }

    return map
  }, [dependencies, localServices, serviceConfigs, serviceEnvironmentContractsById])

  const serviceById = useMemo(() => {
    return new Map(localServices.map((service) => [service.id, service]))
  }, [localServices])

  const selectedContract = useMemo(() => {
    if (!contractInspectorServiceId) {
      return null
    }

    return serviceEnvironmentContractsById.get(contractInspectorServiceId) ?? null
  }, [contractInspectorServiceId, serviceEnvironmentContractsById])

  const selectedContractRoutes = useMemo(() => {
    if (!contractInspectorServiceId) {
      return [] as DependencyRoutePreview[]
    }

    const routes = dependencyRoutePreviewByServiceId.get(contractInspectorServiceId) ?? []
    return routes.filter((route) => route.sourceScope === contractInspectorScope)
  }, [contractInspectorScope, contractInspectorServiceId, dependencyRoutePreviewByServiceId])

  const selectedContractVariableKeys = useMemo(() => {
    if (!selectedContract) {
      return [] as string[]
    }

    return selectedContract.variableKeysByScope[contractInspectorScope] ?? []
  }, [contractInspectorScope, selectedContract])

  const previewInstancesByServiceId = useMemo(() => {
    const map = new Map<string, number>()

    for (const service of localServices) {
      const enabledEnvironments = enabledEnvironmentsByServiceId.get(service.id) ?? []
      const previewEnabled = enabledEnvironments.includes('preview')
      map.set(service.id, previewEnabled ? previewSessionCount : 0)
    }

    return map
  }, [enabledEnvironmentsByServiceId, localServices, previewSessionCount])

  const activeAdvancedFilterRules = useMemo(() => {
    return advancedFilterRules
      .map((rule) => ({
        rule,
        operator: buildAdvancedRuleOperator(rule),
      }))
      .filter((entry): entry is { rule: AdvancedServiceFilterRule; operator: DFilterOperator<string> } => entry.operator !== null)
  }, [advancedFilterRules])

  const advancedServiceFilter = useMemo(() => {
    const clauses = activeAdvancedFilterRules.map(({ rule, operator }) => {
      return {
        [rule.field]: operator,
      } as DFilter<ServiceFilterRecord>
    })

    if (clauses.length === 0) {
      return null
    }

    if (advancedFilterLogic === '_or') {
      return {
        _or: clauses,
      } as DFilter<ServiceFilterRecord>
    }

    return {
      _and: clauses,
    } as DFilter<ServiceFilterRecord>
  }, [activeAdvancedFilterRules, advancedFilterLogic])

  const advancedFilterPreview = useMemo(() => {
    if (!advancedServiceFilter) {
      return ''
    }

    return JSON.stringify(advancedServiceFilter)
  }, [advancedServiceFilter])

  const addAdvancedFilterRule = () => {
    setAdvancedFilterRules((previous) => [
      ...previous,
      {
        id: `rule-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
        field: 'name',
        operator: '_icontains',
        value: '',
      },
    ])
  }

  const patchAdvancedFilterRule = <TKey extends keyof AdvancedServiceFilterRule>(
    ruleId: string,
    key: TKey,
    value: AdvancedServiceFilterRule[TKey],
  ) => {
    setAdvancedFilterRules((previous) => {
      return previous.map((rule) => {
        if (rule.id !== ruleId) {
          return rule
        }

        return {
          ...rule,
          [key]: value,
        }
      })
    })
  }

  const removeAdvancedFilterRule = (ruleId: string) => {
    setAdvancedFilterRules((previous) => previous.filter((rule) => rule.id !== ruleId))
  }

  const filteredServices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return localServices.filter((service) => {
      if (statusFilter === 'active' && !service.isActive) return false
      if (statusFilter === 'inactive' && service.isActive) return false

      const latestDeployment = latestDeploymentByServiceId.get(service.id)
      const isAtRisk = (serviceIncidentCountByServiceId.get(service.id) ?? 0) > 0 || latestDeployment?.status === 'failed'
      const config = serviceConfigs[service.id]
      const enabledEnvironments = enabledEnvironmentsByServiceId.get(service.id) ?? []
      const previewInstances = previewInstancesByServiceId.get(service.id) ?? 0
      const declaredScopes = serviceEnvironmentContractsById.get(service.id)?.declaredScopes ?? []
      const dependencyRoutes = dependencyRoutePreviewByServiceId.get(service.id) ?? []
      const serviceTags = [
        service.isActive ? 'active' : 'inactive',
        isAtRisk ? 'at-risk' : 'healthy',
        (dependencyCountsByServiceId.dependsOn.get(service.id) ?? 0) > 0 ? 'has-dependencies' : 'no-dependencies',
      ]

      if (riskFilter === 'at-risk' && !isAtRisk) return false
      if (riskFilter === 'healthy' && isAtRisk) return false
      if (environmentFilter !== 'all') {
        const isPreviewLikeFilter = environmentFilter === 'preview' || environmentFilter.startsWith('preview/')
        if (isPreviewLikeFilter) {
          const hasPreviewEnabledScope = enabledEnvironments.some((env) => env === 'preview' || env.startsWith('preview/'))
          if (!hasPreviewEnabledScope) {
            return false
          }

          if (environmentFilter === 'preview') {
            if (previewInstances <= 0) {
              return false
            }
          } else if (!enabledEnvironments.includes(environmentFilter)) {
            return false
          }
        } else if (!enabledEnvironments.includes(environmentFilter)) {
          return false
        }
      }
      if (runtimeFilter !== 'all' && service.runtime !== runtimeFilter) return false
      if (typeFilter !== 'all' && service.type !== typeFilter) return false
      if (providerFilter !== 'all' && (config?.providerType ?? 'unknown') !== providerFilter) return false
      if (runnerFilter !== 'all' && (config?.runnerType ?? 'unknown') !== runnerFilter) return false
      if (tagFilters.length > 0 && !tagFilters.every((tag) => serviceTags.includes(tag))) return false
      if (environmentFilter !== 'all' && !declaredScopes.includes(environmentFilter) && !(environmentFilter === 'preview' && previewInstances > 0)) {
        return false
      }

      if (environmentFilter !== 'all' && dependencyRoutes.length > 0) {
        const hasAccessibleRoute = dependencyRoutes.some((route) => {
          if (environmentFilter === 'preview') {
            return route.sourceScope.startsWith('preview') && route.accessible
          }
          return route.sourceScope === environmentFilter && route.accessible
        })

        if (!hasAccessibleRoute) {
          return false
        }
      }

      if (advancedServiceFilter) {
        const record: ServiceFilterRecord = {
          name: service.name,
          id: service.id,
          type: service.type,
          runtime: service.runtime,
          providerType: config?.providerType ?? 'unknown',
          runnerType: config?.runnerType ?? 'unknown',
          state: service.isActive ? 'active' : 'inactive',
          health: isAtRisk ? 'at-risk' : 'healthy',
          environments: enabledEnvironments.join(','),
        }

        if (!matchFilter<ServiceFilterRecord>(record, advancedServiceFilter)) {
          return false
        }
      }

      if (!query) return true
      return (
        service.name.toLowerCase().includes(query)
        || service.type.toLowerCase().includes(query)
        || service.runtime.toLowerCase().includes(query)
        || service.id.toLowerCase().includes(query)
      )
    })
  }, [
    dependencyCountsByServiceId.dependsOn,
    enabledEnvironmentsByServiceId,
    environmentFilter,
    latestDeploymentByServiceId,
    localServices,
    providerFilter,
    previewInstancesByServiceId,
    riskFilter,
    runnerFilter,
    runtimeFilter,
    searchQuery,
    serviceConfigs,
    serviceEnvironmentContractsById,
    serviceIncidentCountByServiceId,
    statusFilter,
    tagFilters,
    typeFilter,
    dependencyRoutePreviewByServiceId,
    advancedServiceFilter,
  ])

  const graphServices = useMemo<ServiceGraphNode[]>(() => {
    return localServices.map((service) => ({
      id: service.id,
      name: service.name,
      type: service.type,
      projectId: service.projectId,
      isActive: service.isActive,
    }))
  }, [localServices])

  const graphDependencies = useMemo(() => {
    return dependencies
      .map((dependency) => ({
        id: dependency.id,
        serviceId: dependency.serviceId,
        dependsOnServiceId: dependency.dependsOnServiceId,
        isRequired: true,
        enabledIn: dependency.enabledIn,
      }))
  }, [dependencies])

  const graphDependencyRoutes = useMemo<ServiceGraphDependencyRoute[]>(() => {
    const seen = new Set<string>()
    const routes: ServiceGraphDependencyRoute[] = []

    for (const service of localServices) {
      const serviceRoutes = dependencyRoutePreviewByServiceId.get(service.id) ?? []

      for (const route of serviceRoutes) {
        if (!route.accessible) {
          continue
        }

        const routeKey = `${route.dependencyId}::${route.sourceScope}::${route.targetScope}`
        if (seen.has(routeKey)) {
          continue
        }

        seen.add(routeKey)
        routes.push({
          dependencyId: route.dependencyId,
          sourceScope: route.sourceScope,
          targetScope: route.targetScope,
        })
      }
    }

    return routes
  }, [dependencyRoutePreviewByServiceId, localServices])

  const graphServiceEnvironments = useMemo(() => {
    const record: Record<string, string[]> = {}

    for (const service of localServices) {
      record[service.id] = enabledEnvironmentsByServiceId.get(service.id) ?? []
    }

    return record
  }, [enabledEnvironmentsByServiceId, localServices])

  const hasActiveFilters = useMemo(() => {
    return Boolean(
      searchQuery
      || statusFilter !== 'all'
      || riskFilter !== 'all'
      || environmentFilter !== 'all'
      || runtimeFilter !== 'all'
      || typeFilter !== 'all'
      || providerFilter !== 'all'
      || runnerFilter !== 'all'
      || tagFilters.length > 0
      || activeAdvancedFilterRules.length > 0
    )
  }, [
    activeAdvancedFilterRules.length,
    environmentFilter,
    providerFilter,
    riskFilter,
    runnerFilter,
    runtimeFilter,
    searchQuery,
    statusFilter,
    tagFilters,
    typeFilter,
  ])

  const activeFilterCount = useMemo(() => {
    const discrete = [statusFilter, riskFilter, environmentFilter, runtimeFilter, typeFilter, providerFilter, runnerFilter]
      .filter((value) => value !== 'all')
      .length

    return discrete + (searchQuery ? 1 : 0) + tagFilters.length + activeAdvancedFilterRules.length
  }, [activeAdvancedFilterRules.length, environmentFilter, providerFilter, riskFilter, runnerFilter, runtimeFilter, searchQuery, statusFilter, tagFilters, typeFilter])

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = []

    if (searchQuery) labels.push(`search: ${searchQuery}`)
    if (environmentFilter !== 'all') labels.push(`env: ${environmentFilter}`)
    if (runtimeFilter !== 'all') labels.push(`runtime: ${runtimeFilter}`)
    if (typeFilter !== 'all') labels.push(`type: ${typeFilter}`)
    if (providerFilter !== 'all') labels.push(`provider: ${providerFilter}`)
    if (runnerFilter !== 'all') labels.push(`runner: ${runnerFilter}`)
    if (statusFilter !== 'all') labels.push(`state: ${statusFilter}`)
    if (riskFilter !== 'all') labels.push(`health: ${riskFilter}`)
    for (const tag of tagFilters) {
      labels.push(`tag: ${tag}`)
    }
    if (activeAdvancedFilterRules.length > 0) {
      labels.push(`logic: ${advancedFilterLogic === '_and' ? 'AND' : 'OR'}`)
      for (const { rule } of activeAdvancedFilterRules) {
        labels.push(`rule: ${describeAdvancedRule(rule)}`)
      }
    }

    return labels
  }, [activeAdvancedFilterRules, advancedFilterLogic, environmentFilter, providerFilter, riskFilter, runnerFilter, runtimeFilter, searchQuery, statusFilter, tagFilters, typeFilter])

  const resetFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setRiskFilter('all')
    setEnvironmentFilter('all')
    setRuntimeFilter('all')
    setTypeFilter('all')
    setProviderFilter('all')
    setRunnerFilter('all')
    setTagFilters([])
    setAdvancedFilterLogic('_and')
    setAdvancedFilterRules([])
  }

  const handleCreateService = () => {
    const name = createName.trim()
    const type = createType.trim()
    const runtime = createRuntime.trim()

    if (!name || !type || !runtime) {
      toast.error('Name, type and runtime are required')
      return
    }

    const slugName = name.toLowerCase().replace(/\s+/g, '-')

    setLocalServices((previous) => [
      ...previous,
      {
        id: `svc-${slugName}-${String(Date.now())}`,
        projectId,
        name,
        description: createDescription.trim() || 'Service created from mock dashboard action.',
        type,
        runtime,
        layer: 9,
        isActive: true,
      },
    ])

    toast.success('Service created in mock dashboard')
    setCreateDialogOpen(false)
    setCreateName('')
    setCreateDescription('')
    setCreateRuntime('nodejs')
    setCreateType('web')
  }

  const handleToggleService = (serviceId: string, isActive: boolean) => {
    setLocalServices((previous) => previous.map((service) => (service.id === serviceId ? { ...service, isActive: !isActive } : service)))
    toast.success(!isActive ? 'Service activated' : 'Service deactivated')
  }

  const handleDeleteService = (serviceId: string) => {
    if (!confirm('Delete this service from the mock dashboard?')) return

    setLocalServices((previous) => previous.filter((service) => service.id !== serviceId))
    toast.success('Service deleted from mock dashboard')
  }

  if (!project) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Project not found</AlertTitle>
        <AlertDescription>The requested project does not exist in the mock entity dataset.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
              <AuthDashboardProjects.Link>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to projects
              </AuthDashboardProjects.Link>
            </Button>

            <div className="space-y-1">
              <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
              <p className="text-sm text-muted-foreground">
                Manage services, deployments, and dependencies for your project
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href={`/dashboard/projects/${projectId}/configuration`}>
                <Settings className="h-4 w-4" />
                Configuration
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
            Services active {String(activeServiceCount)}/{String(localServices.length)}
          </Badge>
          <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
            Dependencies {String(dependencies.length)}
          </Badge>
          <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
            Deployments {String(deployments.length)}
          </Badge>
          <Badge
            variant={openIncidentCount > 0 ? 'destructive' : 'outline'}
            className="rounded-full px-3 py-1 text-xs"
          >
            Open incidents {String(openIncidentCount)}
          </Badge>
          <Badge
            variant={criticalNotificationCount > 0 ? 'destructive' : 'outline'}
            className="rounded-full px-3 py-1 text-xs"
          >
            Critical notifications {String(criticalNotificationCount)}
          </Badge>
          <Badge
            variant={atRiskServiceCount > 0 ? 'destructive' : 'outline'}
            className="rounded-full px-3 py-1 text-xs"
          >
            At-risk services {String(atRiskServiceCount)}
          </Badge>
          <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
            Latest signal {latestNotification?.level ?? 'none'}
          </Badge>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border/60 bg-card/30 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
              }}
              placeholder="Search services by name, id, type, runtime, provider or runner..."
              className="pl-8"
            />
          </div>

          <Popover
            open={filtersOpen}
            onOpenChange={(open) => {
              setFiltersOpen(open)
            }}
          >
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="gap-2">
                <Filter className="h-4 w-4" />
                Filters
                {hasActiveFilters ? (
                  <Badge variant="secondary" className="ml-1 rounded-full px-1.5 py-0 text-[10px]">
                    {String(activeFilterCount)}
                  </Badge>
                ) : null}
              </Button>
            </PopoverTrigger>

            <PopoverContent align="end" className="w-[min(96vw,74rem)] max-w-none space-y-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Service filters</p>
                  <p className="text-xs text-muted-foreground">Configure service list filters without taking page space.</p>
                </div>
                {hasActiveFilters ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      resetFilters()
                    }}
                  >
                    Reset
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Environment</Label>
                  <Select
                    value={environmentFilter}
                    onValueChange={(value: string) => {
                      setEnvironmentFilter(value)
                    }}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="All environments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All environments</SelectItem>
                      {environmentScopes.map((env) => (
                        <SelectItem key={env} value={env}>
                          {env === 'preview' ? 'preview (sessions)' : env}
                          {deploymentCountByEnvironment.get(env)
                            ? ` (${String(deploymentCountByEnvironment.get(env) ?? 0)})`
                            : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Runtime</Label>
                  <Select
                    value={runtimeFilter}
                    onValueChange={(value) => {
                      setRuntimeFilter(value)
                    }}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="All runtimes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All runtimes</SelectItem>
                      {runtimeOptions.map((runtime) => (
                        <SelectItem key={runtime} value={runtime}>{runtime}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Type</Label>
                  <Select
                    value={typeFilter}
                    onValueChange={(value) => {
                      setTypeFilter(value)
                    }}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {typeOptions.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Provider</Label>
                  <Select
                    value={providerFilter}
                    onValueChange={(value) => {
                      setProviderFilter(value)
                    }}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All providers</SelectItem>
                      {providerOptions.map((provider) => (
                        <SelectItem key={provider} value={provider}>{provider}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Runner</Label>
                  <Select
                    value={runnerFilter}
                    onValueChange={(value) => {
                      setRunnerFilter(value)
                    }}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All runners</SelectItem>
                      {runnerOptions.map((runner) => (
                        <SelectItem key={runner} value={runner}>{runner}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">State</Label>
                  <Select
                    value={statusFilter}
                    onValueChange={(value: string) => {
                      setStatusFilter(value as typeof statusFilter)
                    }}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All states</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Health</Label>
                  <Select
                    value={riskFilter}
                    onValueChange={(value: 'all' | 'at-risk' | 'healthy') => {
                      setRiskFilter(value)
                    }}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All services</SelectItem>
                      <SelectItem value="at-risk">At risk</SelectItem>
                      <SelectItem value="healthy">Healthy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Quick filters</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {QUICK_SERVICE_FILTER_TAGS.map((tag) => {
                    const selected = tagFilters.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                          selected
                            ? 'border-violet-500 bg-violet-500/15 text-violet-900 dark:text-violet-100'
                            : 'border-border/70 bg-background/40 text-muted-foreground hover:border-border hover:bg-background/80'
                        }`}
                        onClick={() => {
                          setTagFilters((previous) =>
                            previous.includes(tag)
                              ? previous.filter((candidate) => candidate !== tag)
                              : [...previous, tag],
                          )
                        }}
                      >
                        {tag}
                        {selected ? <X className="h-3 w-3" /> : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Advanced filter builder</p>
                    <p className="text-xs text-muted-foreground">
                      Build AND / OR rule groups using the shared DFilter engine.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Select
                      value={advancedFilterLogic}
                      onValueChange={(value) => {
                        setAdvancedFilterLogic(value as AdvancedFilterLogic)
                      }}
                    >
                      <SelectTrigger className="h-8 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_and">AND</SelectItem>
                        <SelectItem value="_or">OR</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        addAdvancedFilterRule()
                      }}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add rule
                    </Button>
                  </div>
                </div>

                {advancedFilterRules.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No advanced rules yet. Add a rule to compose filtering with {advancedFilterLogic === '_and' ? 'AND' : 'OR'}.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {advancedFilterRules.map((rule) => (
                      <div
                        key={rule.id}
                        className="grid gap-2 rounded-md border border-border/60 bg-background/70 p-2 lg:grid-cols-[minmax(140px,1fr)_minmax(140px,1fr)_minmax(220px,1fr)_auto]"
                      >
                        <Select
                          value={rule.field}
                          onValueChange={(value) => {
                            patchAdvancedFilterRule(rule.id, 'field', value as AdvancedFilterField)
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ADVANCED_FILTER_FIELDS.map((option) => (
                              <SelectItem key={`${rule.id}-field-${option.value}`} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={rule.operator}
                          onValueChange={(value) => {
                            patchAdvancedFilterRule(rule.id, 'operator', value as AdvancedFilterOperator)
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ADVANCED_FILTER_OPERATORS.map((option) => (
                              <SelectItem key={`${rule.id}-operator-${option.value}`} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Input
                          className="h-8 text-xs"
                          value={rule.value}
                          placeholder={rule.operator === '_in' || rule.operator === '_nin' ? 'comma,separated,values' : 'value'}
                          onChange={(event) => {
                            patchAdvancedFilterRule(rule.id, 'value', event.target.value)
                          }}
                        />

                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => {
                            removeAdvancedFilterRule(rule.id)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sr-only">Remove rule</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {advancedFilterPreview ? (
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {advancedFilterPreview}
                  </p>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>

          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                resetFilters()
              }}
              className="gap-1"
            >
              Reset
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
            Preview sessions {String(previewSessionCount)}
          </Badge>

          {activeFilterLabels.length > 0 ? (
            activeFilterLabels.map((label) => (
              <Badge key={label} variant="secondary" className="rounded-full px-3 py-1 text-xs">
                {label}
              </Badge>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No filters applied. Use the filter button to scope the service table.</p>
          )}
        </div>
      </div>

      <Card className="border-border/60 bg-card/40 backdrop-blur-xl">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Services</CardTitle>
              <CardDescription>
                {filteredServices.length} service{filteredServices.length !== 1 ? 's' : ''} of {localServices.length} total
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="gap-2"
              onClick={() => {
                setCreateDialogOpen(true)
              }}
            >
              <Plus className="h-4 w-4" />
              Create service
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-0 border-b hover:bg-transparent">
                <TableHead className="font-semibold">Service</TableHead>
                <TableHead className="font-semibold">Type & Runtime</TableHead>
                <TableHead className="font-semibold">Configuration</TableHead>
                <TableHead className="font-semibold">Enabled in</TableHead>
                <TableHead className="font-semibold">Health</TableHead>
                <TableHead className="font-semibold">Dependencies</TableHead>
                <TableHead className="font-semibold">Latest deploy</TableHead>
                <TableHead className="text-right font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredServices.map((service) => {
                const config = serviceConfigs[service.id]
                const latest = latestDeploymentByServiceId.get(service.id)
                const incidentCount = serviceIncidentCountByServiceId.get(service.id) ?? 0
                const healthState = config?.statusByEnvironment.production.health ?? 'unknown'
                const enabledEnvironments = enabledEnvironmentsByServiceId.get(service.id) ?? []
                const previewInstances = previewInstancesByServiceId.get(service.id) ?? 0
                const contract = serviceEnvironmentContractsById.get(service.id)
                const dependencyCountsDepends = dependencyCountsByServiceId.dependsOn.get(service.id) ?? 0
                const dependencyCountsDependedBy = dependencyCountsByServiceId.dependedBy.get(service.id) ?? 0

                return (
                  <TableRow key={service.id} className="hover:bg-muted/30">
                    <TableCell className="py-3">
                      <div className="space-y-1">
                        <Link
                          href={`/dashboard/projects/${projectId}/services/${service.id}`}
                          className="font-medium transition hover:text-violet-600 hover:underline dark:hover:text-violet-400"
                        >
                          {service.name}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">{shortId(service.id)}</p>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{service.type}</p>
                        <p className="text-xs text-muted-foreground">{service.runtime}</p>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className="text-xs">
                            {config?.providerType ?? 'unknown'}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {config?.runnerType ?? 'unknown'}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          scopes {String(contract?.declaredScopes.length ?? 0)} · schema keys{' '}
                          {String(contract?.variableKeysByScope.production?.length ?? 0)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex flex-wrap gap-1">
                        {enabledEnvironments.length === 0 ? (
                          <Badge variant="secondary" className="text-xs">
                            none
                          </Badge>
                        ) : (
                          enabledEnvironments.map((env) => (
                            <Badge key={`${service.id}-${env}`} variant="outline" className="text-xs">
                              {env.startsWith('preview')
                                ? `${env} ×${String(deploymentCountByEnvironment.get(env) ?? previewInstances)}`
                                : env}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant={service.isActive ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {service.isActive ? 'active' : 'inactive'}
                        </Badge>
                        <Badge variant={statusBadgeVariant(healthState)} className="text-xs">
                          {healthState}
                        </Badge>
                        {incidentCount > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            <Siren className="mr-1 h-3 w-3" />
                            {incidentCount}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="text-xs">
                        <p className="text-muted-foreground">
                          <span className="font-medium text-foreground">{dependencyCountsDepends}</span> depends on
                        </p>
                        <p className="text-muted-foreground">
                          <span className="font-medium text-foreground">{dependencyCountsDependedBy}</span> depended by
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      {latest ? (
                        <div className="space-y-1">
                          <Badge variant={statusBadgeVariant(latest.status)} className="text-xs">
                            {latest.status}
                          </Badge>
                          <p className="text-xs text-muted-foreground">{formatDate(latest.startedAt)}</p>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          no deployment
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setContractInspectorServiceId(service.id)
                            setContractInspectorScope(contract?.declaredScopes[0] ?? 'production')
                          }}
                          title="Inspect env contract"
                        >
                          <Filter className="h-4 w-4" />
                          <span className="sr-only">Inspect env contract</span>
                        </Button>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/dashboard/projects/${projectId}/services/${service.id}`}>
                            <ArrowRight className="h-4 w-4" />
                            <span className="sr-only">Open service</span>
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            handleToggleService(service.id, service.isActive)
                          }}
                          title={service.isActive ? 'Deactivate service' : 'Activate service'}
                        >
                          <ChevronDown className="h-4 w-4 rotate-180" />
                          <span className="sr-only">{service.isActive ? 'Deactivate' : 'Activate'}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            handleDeleteService(service.id)
                          }}
                          className="text-destructive hover:text-destructive"
                          title="Delete service"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete service</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              {filteredServices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    <p className="text-sm">No services match current filters.</p>
                    <p className="text-xs">Try adjusting your search criteria.</p>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ServiceDependencyGraphPanel
        services={graphServices}
        dependencies={graphDependencies}
        dependencyRoutes={graphDependencyRoutes}
        serviceEnvironments={graphServiceEnvironments}
        environmentOrder={environmentScopes}
        selectedEnvironment={environmentFilter}
        title="Service dependency graph"
        description="Visualize dependencies between services filtered by environment. Color-coded by environment context."
      />

      <Dialog
        open={Boolean(contractInspectorServiceId)}
        onOpenChange={(open) => {
          if (!open) {
            setContractInspectorServiceId(null)
          }
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-auto">
          <DialogHeader>
            <DialogTitle>Environment contract inspector</DialogTitle>
            <DialogDescription>
              Validate service env schema and cross-environment dependency routing with strongly typed scopes.
            </DialogDescription>
          </DialogHeader>

          {contractInspectorServiceId && selectedContract ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-semibold">
                    {serviceById.get(contractInspectorServiceId)?.name ?? contractInspectorServiceId}
                  </p>
                  <p className="text-xs text-muted-foreground">{contractInspectorServiceId}</p>
                </div>

                <div className="w-full max-w-xs">
                  <Label className="text-xs text-muted-foreground">Source scope</Label>
                  <Select
                    value={contractInspectorScope}
                    onValueChange={(value) => {
                      setContractInspectorScope(value)
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedContract.declaredScopes.map((scope) => (
                        <SelectItem key={`${contractInspectorServiceId}-${scope}`} value={scope}>
                          {scope}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-border/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Declared env schema keys</CardTitle>
                    <CardDescription>
                      Keys available to this service in <span className="font-medium">{contractInspectorScope}</span>.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedContractVariableKeys.slice(0, 42).map((key) => (
                        <Badge key={`${contractInspectorServiceId}-${contractInspectorScope}-${key}`} variant="outline" className="text-[10px]">
                          {key}
                        </Badge>
                      ))}
                      {selectedContractVariableKeys.length > 42 ? (
                        <Badge variant="secondary" className="text-[10px]">
                          +{String(selectedContractVariableKeys.length - 42)} more
                        </Badge>
                      ) : null}
                      {selectedContractVariableKeys.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No schema keys declared for this scope.</p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Dependency routing map</CardTitle>
                    <CardDescription>
                      For each dependency, verify source → target scope and accessibility.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {selectedContractRoutes.map((route) => {
                      const targetService = serviceById.get(route.targetServiceId)

                      return (
                        <div
                          key={`${route.dependencyId}-${route.sourceScope}-${route.targetScope}`}
                          className="rounded-md border border-border/60 bg-muted/10 px-2 py-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-medium">
                              {route.sourceScope} → {route.targetScope}
                            </p>
                            <Badge variant={route.accessible ? 'outline' : 'destructive'} className="text-[10px]">
                              {route.accessible ? 'accessible' : 'missing target scope'}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            dependency {route.dependencyId} · target {targetService?.name ?? route.targetServiceId}
                          </p>
                        </div>
                      )
                    })}
                    {selectedContractRoutes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No dependency routes declared for this source scope.</p>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create service</DialogTitle>
            <DialogDescription>
              Adds a new mock service instance to this project dashboard with default active state.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="service-create-name">Name</Label>
              <Input
                id="service-create-name"
                value={createName}
                onChange={(event) => {
                  setCreateName(event.target.value)
                }}
                placeholder="api-gateway"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="service-create-type">Type</Label>
                <Input
                  id="service-create-type"
                  value={createType}
                  onChange={(event) => {
                    setCreateType(event.target.value)
                  }}
                  placeholder="web"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-create-runtime">Runtime</Label>
                <Input
                  id="service-create-runtime"
                  value={createRuntime}
                  onChange={(event) => {
                    setCreateRuntime(event.target.value)
                  }}
                  placeholder="nodejs"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-create-description">Description</Label>
              <Input
                id="service-create-description"
                value={createDescription}
                onChange={(event) => {
                  setCreateDescription(event.target.value)
                }}
                placeholder="Optional service description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateDialogOpen(false)
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateService}>Create service</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
