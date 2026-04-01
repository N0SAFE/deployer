'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DockerContainerDetailModalTrigger } from '../_components/docker-container-detail-modal'
import { DockerSelectionToggle } from '../_components/docker-page-utilities'
import { useDockerContainerList, useDockerDeploymentList, useDockerMeshSseState, useDockerServiceList } from '@/domains/docker/mock-hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Toggle } from '@repo/ui/components/shadcn/toggle'
import { Pause, Play, Search, WrapText } from 'lucide-react'

const DEPLOYMENT_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

interface LogLineProjection {
  id: string
  containerId: string | null
  containerName: string
  source: 'deployment' | 'mesh'
  status: string
  message: string
  timestamp: string
}

interface ContainerLogGroup {
  id: string
  name: string
  containers: string[]
}

interface ServiceEnvironmentNode {
  environment: string
  containers: string[]
}

interface ServiceEnvironmentGroup {
  serviceId: string
  serviceName: string
  environments: ServiceEnvironmentNode[]
  containers: string[]
}

const LOG_GROUPS_STORAGE_KEY = 'docker:logs:container-groups'

function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function truncateMiddle(value: string, maxLength = 9): string {
  const normalized = value.trim()
  if (!normalized) return 'unknown'
  if (normalized.length <= maxLength) return normalized

  const prefixLength = Math.floor((maxLength - 3) / 2)
  const suffixLength = maxLength - 3 - prefixLength

  return `${normalized.slice(0, prefixLength)}...${normalized.slice(-suffixLength)}`
}

function buildLogContainerLabel(serviceName: string, environment: string, replicaTag: string): string {
  return `${truncateMiddle(serviceName)}:${truncateMiddle(environment)}:${truncateMiddle(replicaTag)}`
}

function parseContainerIdentity(containerName: string): {
  serviceName: string
  environment: string
  replicaTag: string
} {
  const segments = containerName
    .split('-')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  if (segments.length === 0) {
    return {
      serviceName: containerName,
      environment: 'unknown',
      replicaTag: 'primary',
    }
  }

  const working = [...segments]
  const lastSegment = working[working.length - 1]
  let replicaTag = 'primary'

  if (lastSegment && /^\d+$/.test(lastSegment)) {
    replicaTag = `r${lastSegment}`
    working.pop()
  } else if (lastSegment && /^(?:r|replica)[-_]?\d+$/i.test(lastSegment)) {
    const replicaNumber = lastSegment.match(/\d+/)?.[0]
    if (replicaNumber) {
      replicaTag = `r${replicaNumber}`
      working.pop()
    }
  }

  const environment = working.length > 1 ? (working[working.length - 1] ?? 'unknown') : 'unknown'
  const serviceSegments = working.length > 1 ? working.slice(0, -1) : working
  const serviceName = serviceSegments.join('-') || containerName

  return {
    serviceName,
    environment,
    replicaTag,
  }
}

export default function DashboardDockerLogsPage() {
  const logsViewportRef = useRef<HTMLDivElement | null>(null)

  const [logsSearchTerm, setLogsSearchTerm] = useState('')
  const [containerSearchTerm, setContainerSearchTerm] = useState('')
  const [logsSourceFilter, setLogsSourceFilter] = useState<'all' | LogLineProjection['source']>('all')
  const [logsContainerFilter, setLogsContainerFilter] = useState('all')
  const [logsViewMode, setLogsViewMode] = useState<'single' | 'multi' | 'grouped'>('grouped')
  const [selectedContainerNames, setSelectedContainerNames] = useState<Set<string>>(new Set())
  const [containerGroups, setContainerGroups] = useState<ContainerLogGroup[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string>('all')
  const [newGroupName, setNewGroupName] = useState('')
  const [isPaused, setIsPaused] = useState(false)
  const [isAssembledByService, setIsAssembledByService] = useState(true)
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [isWrapEnabled, setIsWrapEnabled] = useState(true)
  const [fontSizePx, setFontSizePx] = useState(12)
  const [pausedSnapshot, setPausedSnapshot] = useState<LogLineProjection[] | null>(null)
  const [clearedAt, setClearedAt] = useState<number | null>(null)

  const { data: deploymentData } = useDockerDeploymentList(DEPLOYMENT_LIST_INPUT)
  const { data: containerEntityData } = useDockerContainerList(DEPLOYMENT_LIST_INPUT)
  const { data: serviceData } = useDockerServiceList(DEPLOYMENT_LIST_INPUT)
  const { state: meshState, status: meshSseStatus } = useDockerMeshSseState()

  const deployments = deploymentData?.data ?? []
  const containerEntities = containerEntityData?.data ?? []
  const services = serviceData?.data ?? []

  const serviceNameById = useMemo(() => {
    return new Map(services.map((service) => [service.id, service.name]))
  }, [services])

  const logContainerLabelByName = useMemo(() => {
    const labels = new Map<string, string>()

    const registerLabel = (containerName: string, preferredServiceName?: string | null, preferredEnvironment?: string | null) => {
      if (!containerName) return

      const parsed = parseContainerIdentity(containerName)
      const serviceName = preferredServiceName?.trim() ? preferredServiceName : parsed.serviceName
      const environment = preferredEnvironment?.trim() ? preferredEnvironment : parsed.environment

      labels.set(containerName, buildLogContainerLabel(serviceName, environment, parsed.replicaTag))
    }

    for (const container of containerEntities) {
      const serviceName = container.serviceId ? serviceNameById.get(container.serviceId) ?? null : null
      registerLabel(container.name, serviceName, container.environment)
    }

    for (const deployment of deployments) {
      const containerName = deployment.containerName ?? `deployment-${shortId(deployment.id)}`
      const serviceName = deployment.serviceId ? serviceNameById.get(deployment.serviceId) ?? null : null
      registerLabel(containerName, serviceName, deployment.environment)
    }

    registerLabel('mesh-control-plane', 'mesh-control-plane', 'system')

    return labels
  }, [containerEntities, deployments, serviceNameById])

  const logs = useMemo<LogLineProjection[]>(() => {
    const projected: LogLineProjection[] = []
    const containerIdByName = new Map(containerEntities.map((container) => [container.name, container.id]))

    for (const deployment of deployments.slice(0, 120)) {
      const containerName = deployment.containerName ?? `deployment-${shortId(deployment.id)}`
      const status = deployment.status
      const environment = deployment.environment
      const sourceType = deployment.sourceType

      const message =
        status === 'failed'
          ? `Deployment failed for ${containerName} on ${environment} (${sourceType})`
          : status === 'success'
            ? `Deployment completed for ${containerName} on ${environment} (${sourceType})`
            : `Deployment ${status} for ${containerName} on ${environment} (${sourceType})`

      projected.push({
        id: deployment.id,
        containerId: containerIdByName.get(containerName) ?? null,
        containerName,
        source: 'deployment',
        status,
        message,
        timestamp: deployment.updatedAt,
      })
    }

    if (meshState) {
      projected.push({
        id: `mesh-state-${String(meshState.revision)}`,
        containerId: null,
        containerName: 'mesh-control-plane',
        source: 'mesh',
        status: meshSseStatus,
        message: `Mesh ${meshState.reason.replaceAll('_', ' ')} · ${String(meshState.sessions.length)} sessions · ${String(meshState.peers.length)} peers`,
        timestamp: meshState.emittedAt,
      })
    }

    return projected.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [containerEntities, deployments, meshSseStatus, meshState])

  const logContainers = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.containerName))).sort((a, b) => a.localeCompare(b))
  }, [logs])

  const allContainers = useMemo(() => {
    return containerEntities
      .map((container) => container.name)
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b))
  }, [containerEntities])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.localStorage.getItem(LOG_GROUPS_STORAGE_KEY)
    if (!raw) return

    try {
      const parsed = JSON.parse(raw) as ContainerLogGroup[]
      if (Array.isArray(parsed)) {
        setContainerGroups(
          parsed
            .filter((group) => group && typeof group.id === 'string' && typeof group.name === 'string' && Array.isArray(group.containers))
            .map((group) => ({
              id: group.id,
              name: group.name,
              containers: group.containers.filter((container): container is string => typeof container === 'string'),
            })),
        )
      }
    } catch {
      // ignore invalid persisted data
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LOG_GROUPS_STORAGE_KEY, JSON.stringify(containerGroups))
  }, [containerGroups])

  const activeGroup = useMemo(() => {
    if (activeGroupId === 'all') return null
    return containerGroups.find((group) => group.id === activeGroupId) ?? null
  }, [activeGroupId, containerGroups])

  const serviceEnvironmentGroups = useMemo<ServiceEnvironmentGroup[]>(() => {
    const grouped = new Map<string, { serviceId: string; serviceName: string; environments: Map<string, string[]> }>()

    for (const container of containerEntities) {
      const containerName = container.name
      if (!containerName) continue

      const serviceId = container.serviceId ?? 'unknown-service'
      const serviceName = serviceNameById.get(serviceId) ?? serviceId
      const environment = container.environment ?? 'unknown'
      const key = `${serviceId}:${serviceName}`

      const current = grouped.get(key) ?? {
        serviceId,
        serviceName,
        environments: new Map<string, string[]>(),
      }

      const environmentContainers = current.environments.get(environment) ?? []
      environmentContainers.push(containerName)
      current.environments.set(environment, environmentContainers)

      grouped.set(key, current)
    }

    const tree = Array.from(grouped.values())
      .map((group) => {
        const environments = Array.from(group.environments.entries())
          .map(([environment, containers]) => ({
            environment,
            containers: Array.from(new Set(containers)).sort((a, b) => a.localeCompare(b)),
          }))
          .sort((a, b) => a.environment.localeCompare(b.environment))

        return {
          serviceId: group.serviceId,
          serviceName: group.serviceName,
          environments,
          containers: environments.flatMap((environmentGroup) => environmentGroup.containers),
        }
      })
      .sort((a, b) => a.serviceName.localeCompare(b.serviceName))

    const normalized = containerSearchTerm.trim().toLowerCase()
    if (!normalized) {
      return tree
    }

    return tree
      .map((group) => {
        const serviceMatches =
          group.serviceName.toLowerCase().includes(normalized)
          || group.serviceId.toLowerCase().includes(normalized)

        const environments = group.environments
          .map((environmentGroup) => {
            if (serviceMatches) {
              return environmentGroup
            }

            const environmentMatches = environmentGroup.environment.toLowerCase().includes(normalized)
            if (environmentMatches) {
              return environmentGroup
            }

            const matchedContainers = environmentGroup.containers.filter((containerName) =>
              containerName.toLowerCase().includes(normalized),
            )

            if (matchedContainers.length === 0) {
              return null
            }

            return {
              environment: environmentGroup.environment,
              containers: matchedContainers,
            }
          })
          .filter((environmentGroup): environmentGroup is ServiceEnvironmentNode => environmentGroup !== null)

        if (!serviceMatches && environments.length === 0) {
          return null
        }

        return {
          ...group,
          environments,
          containers: environments.flatMap((environmentGroup) => environmentGroup.containers),
        }
      })
      .filter((group): group is ServiceEnvironmentGroup => group !== null)
  }, [containerEntities, containerSearchTerm, serviceNameById])

  const visibleContainerNames = useMemo(() => {
    return serviceEnvironmentGroups.flatMap((group) => group.containers)
  }, [serviceEnvironmentGroups])

  const filteredLogs = useMemo(() => {
    const normalized = logsSearchTerm.trim().toLowerCase()
    const activeSingleContainer =
      logsViewMode === 'single' && selectedContainerNames.size === 1
        ? Array.from(selectedContainerNames)[0]
        : null

    return logs.filter((log) => {
      if (logsSourceFilter !== 'all' && log.source !== logsSourceFilter) {
        return false
      }
      if (logsContainerFilter !== 'all' && log.containerName !== logsContainerFilter) {
        return false
      }
      if (selectedContainerNames.size > 0 && !selectedContainerNames.has(log.containerName)) {
        return false
      }
      if (activeSingleContainer && log.containerName !== activeSingleContainer) {
        return false
      }
      if (activeGroup && !activeGroup.containers.includes(log.containerName)) {
        return false
      }
      if (clearedAt && new Date(log.timestamp).getTime() < clearedAt) {
        return false
      }
      if (!normalized) {
        return true
      }

      return (
        log.containerName.toLowerCase().includes(normalized)
        || log.message.toLowerCase().includes(normalized)
        || log.status.toLowerCase().includes(normalized)
      )
    })
  }, [activeGroup, clearedAt, logs, logsContainerFilter, logsSearchTerm, logsSourceFilter, logsViewMode, selectedContainerNames])

  useEffect(() => {
    if (!isPaused) {
      setPausedSnapshot(null)
    }
  }, [isPaused])

  const displayedLogs = isPaused ? (pausedSnapshot ?? filteredLogs) : filteredLogs

  useEffect(() => {
    if (!isAutoScroll || !logsViewportRef.current) return
    logsViewportRef.current.scrollTop = logsViewportRef.current.scrollHeight
  }, [displayedLogs, isAutoScroll])

  const createGroupFromSelection = () => {
    const trimmed = newGroupName.trim()
    if (!trimmed || selectedContainerNames.size === 0) return

    const group: ContainerLogGroup = {
      id: `group-${Date.now()}`,
      name: trimmed,
      containers: Array.from(selectedContainerNames).sort((a, b) => a.localeCompare(b)),
    }
    setContainerGroups((previous) => [group, ...previous])
    setActiveGroupId(group.id)
    setNewGroupName('')
  }

  const applyGroupToSelection = (group: ContainerLogGroup) => {
    setSelectedContainerNames(new Set(group.containers))
    setLogsViewMode('multi')
    setLogsContainerFilter('all')
    setActiveGroupId(group.id)
  }

  const deleteGroup = (groupId: string) => {
    setContainerGroups((previous) => previous.filter((group) => group.id !== groupId))
    if (activeGroupId === groupId) {
      setActiveGroupId('all')
    }
  }

  const toggleSingleContainerSelection = (containerName: string) => {
    setSelectedContainerNames((previous) => {
      const next = new Set(previous)
      if (next.has(containerName)) {
        next.delete(containerName)
      } else {
        next.add(containerName)
      }
      return next
    })
    setActiveGroupId('all')
  }

  const toggleServiceReplicaGroup = (containers: string[]) => {
    setSelectedContainerNames((previous) => {
      const next = new Set(previous)
      const allSelected = containers.every((containerName) => next.has(containerName))

      for (const containerName of containers) {
        if (allSelected) {
          next.delete(containerName)
        } else {
          next.add(containerName)
        }
      }

      return next
    })
  }

  const selectedVisibleContainersCount = visibleContainerNames.filter((containerName) => selectedContainerNames.has(containerName)).length
  const allVisibleContainersSelected = visibleContainerNames.length > 0 && selectedVisibleContainersCount === visibleContainerNames.length
  const someVisibleContainersSelected = selectedVisibleContainersCount > 0 && selectedVisibleContainersCount < visibleContainerNames.length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
          <div className="border-b border-border/60 px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={containerSearchTerm}
                onChange={(event) => {
                  setContainerSearchTerm(event.target.value)
                }}
                placeholder="Filter services, environments, containers..."
                className="h-9 border-border/70 bg-background/70 pl-9"
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Tree mode: combine any service/environment/container selection you want.</p>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  if (isAssembledByService) {
                    const allGroupedContainers = serviceEnvironmentGroups.flatMap((group) => group.containers)
                    setSelectedContainerNames(new Set(allGroupedContainers))
                    return
                  }
                  setSelectedContainerNames(new Set(visibleContainerNames))
                }}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  setSelectedContainerNames(new Set())
                  setActiveGroupId('all')
                }}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="border-b border-border/60 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saved groups</p>
            <div className="mt-2 space-y-1.5">
              <button
                type="button"
                className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${activeGroupId === 'all' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border/60 hover:bg-muted/40'}`}
                onClick={() => {
                  setActiveGroupId('all')
                }}
              >
                All containers
              </button>
              {containerGroups.map((group) => (
                <div key={group.id} className={`rounded-md border px-2 py-1.5 text-xs ${activeGroupId === group.id ? 'border-primary/40 bg-primary/10' : 'border-border/60'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className={`truncate text-left ${activeGroupId === group.id ? 'font-semibold text-primary' : ''}`}
                      onClick={() => {
                        applyGroupToSelection(group)
                      }}
                    >
                      {group.name}
                    </button>
                    <button
                      type="button"
                      className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        deleteGroup(group.id)
                      }}
                    >
                      Del
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{group.containers.length} containers</p>
                </div>
              ))}
            </div>
          </div>

          <div className="max-h-[52vh] space-y-1 overflow-auto px-2 py-2 text-xs">
            {isAssembledByService ? (
              <>
                {serviceEnvironmentGroups.map((group) => {
                  const selectedCount = group.containers.filter((containerName) => selectedContainerNames.has(containerName)).length
                  const allSelectedInGroup = selectedCount > 0 && selectedCount === group.containers.length
                  const someSelectedInGroup = selectedCount > 0 && selectedCount < group.containers.length

                  return (
                    <details key={`${group.serviceId}:${group.serviceName}`} className="group" open>
                      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-muted/20">
                        <span className="inline-flex w-4 justify-center text-[10px] text-muted-foreground">
                          <span className="group-open:hidden">▸</span>
                          <span className="hidden group-open:inline">▾</span>
                        </span>
                        <DockerSelectionToggle
                          ariaLabel={`Select all replicas for ${group.serviceName}`}
                          shape="round"
                          pressed={allSelectedInGroup}
                          indeterminate={someSelectedInGroup}
                          onPressedChange={() => {
                            toggleServiceReplicaGroup(group.containers)
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            className="truncate text-left text-xs font-medium hover:text-primary"
                            onClick={(event) => {
                              event.preventDefault()
                              toggleServiceReplicaGroup(group.containers)
                            }}
                          >
                            {group.serviceName}
                          </button>
                          <p className="text-[10px] text-muted-foreground">{group.environments.length} environments · {group.containers.length} containers</p>
                        </div>
                      </summary>

                      <div className="ml-5 mt-1 space-y-1 border-l border-border/40 pl-3">
                        {group.environments.map((environmentGroup) => {
                          const selectedCountInEnvironment = environmentGroup.containers.filter((containerName) => selectedContainerNames.has(containerName)).length
                          const allSelectedInEnvironment = selectedCountInEnvironment > 0 && selectedCountInEnvironment === environmentGroup.containers.length
                          const someSelectedInEnvironment = selectedCountInEnvironment > 0 && selectedCountInEnvironment < environmentGroup.containers.length

                          return (
                            <details key={`${group.serviceId}:${environmentGroup.environment}`} className="group/env" open>
                              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-muted/20">
                                <span className="inline-flex w-4 justify-center text-[10px] text-muted-foreground">
                                  <span className="group-open/env:hidden">▸</span>
                                  <span className="hidden group-open/env:inline">▾</span>
                                </span>
                                <DockerSelectionToggle
                                  ariaLabel={`Select all containers for ${group.serviceName} in ${environmentGroup.environment}`}
                                  shape="round"
                                  pressed={allSelectedInEnvironment}
                                  indeterminate={someSelectedInEnvironment}
                                  onPressedChange={() => {
                                    toggleServiceReplicaGroup(environmentGroup.containers)
                                  }}
                                />

                                <div className="min-w-0 flex-1">
                                  <button
                                    type="button"
                                    className="truncate text-left text-xs font-medium capitalize hover:text-primary"
                                    onClick={(event) => {
                                      event.preventDefault()
                                      toggleServiceReplicaGroup(environmentGroup.containers)
                                    }}
                                  >
                                    env/{environmentGroup.environment}
                                  </button>
                                  <p className="text-[10px] text-muted-foreground">{environmentGroup.containers.length} containers</p>
                                </div>
                              </summary>

                              <div className="ml-5 mt-0.5 space-y-0.5 border-l border-border/30 pl-3">
                                {environmentGroup.containers.map((containerName) => {
                                  const isSelected = selectedContainerNames.has(containerName)
                                  return (
                                    <div key={containerName} className="flex items-center gap-2 rounded-sm px-1.5 py-0.5 hover:bg-muted/20">
                                      <DockerSelectionToggle
                                        ariaLabel={`Select logs for ${containerName}`}
                                        shape="round"
                                        pressed={isSelected}
                                        onPressedChange={(pressed) => {
                                          setSelectedContainerNames((previous) => {
                                            const next = new Set(previous)
                                            if (pressed) next.add(containerName)
                                            else next.delete(containerName)
                                            return next
                                          })
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="truncate text-left text-xs hover:text-primary"
                                        onClick={() => {
                                          toggleSingleContainerSelection(containerName)
                                        }}
                                      >
                                        {containerName}
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            </details>
                          )
                        })}
                      </div>
                    </details>
                  )
                })}

                {serviceEnvironmentGroups.length === 0 ? (
                  <p className="px-2 py-4 text-xs text-muted-foreground">No service groups match your filter.</p>
                ) : null}
              </>
            ) : (
              <>
                {visibleContainerNames.map((containerName) => {
                  const isSelected = selectedContainerNames.has(containerName)
                  return (
                    <div
                      key={containerName}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${isSelected ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:border-border/50 hover:bg-muted/30'}`}
                    >
                      <DockerSelectionToggle
                        ariaLabel={`Select logs for ${containerName}`}
                        shape="round"
                        pressed={isSelected}
                        onPressedChange={(pressed) => {
                          setSelectedContainerNames((previous) => {
                            const next = new Set(previous)
                            if (pressed) {
                              next.add(containerName)
                            } else {
                              next.delete(containerName)
                            }
                            return next
                          })
                        }}
                      />
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="truncate text-left text-xs font-medium hover:text-primary"
                          onClick={() => {
                            toggleSingleContainerSelection(containerName)
                          }}
                        >
                          {containerName}
                        </button>
                        <p className="text-[10px] text-muted-foreground">runtime container</p>
                      </div>
                    </div>
                  )
                })}
                {visibleContainerNames.length === 0 ? (
                  <p className="px-2 py-4 text-xs text-muted-foreground">No containers match your filter.</p>
                ) : null}
              </>
            )}
          </div>

          <div className="border-t border-border/60 px-3 py-2">
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{selectedContainerNames.size} selected</span>
              <span>{allContainers.length} total</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={newGroupName}
                onChange={(event) => {
                  setNewGroupName(event.target.value)
                }}
                placeholder="Save group"
                className="h-8"
              />
              <Button type="button" size="sm" onClick={createGroupFromSelection} disabled={!newGroupName.trim() || selectedContainerNames.size === 0}>
                Save
              </Button>
            </div>
          </div>
        </aside>

        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
          <div className="border-b border-border/60 bg-background/70 px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="font-medium">Live</span>
                <Badge variant="outline" className="text-[10px]">{meshSseStatus}</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-8 rounded-md border border-border/70 bg-background/70 px-2 text-xs"
                  value={logsViewMode}
                  onChange={(event) => {
                    setLogsViewMode(event.target.value as 'single' | 'multi' | 'grouped')
                  }}
                >
                  <option value="single">Single</option>
                  <option value="multi">Multi</option>
                  <option value="grouped">Grouped</option>
                </select>

                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={isPaused}
                  onPressedChange={(value) => {
                    if (value) {
                      setPausedSnapshot(filteredLogs)
                    }
                    setIsPaused(value)
                  }}
                  className="h-8 gap-1.5 data-[state=on]:border-amber-500/40 data-[state=on]:bg-amber-500/15 data-[state=on]:text-amber-200"
                >
                  {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </Toggle>

                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={isAutoScroll}
                  onPressedChange={setIsAutoScroll}
                  className="h-8 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/15"
                >
                  Auto-scroll
                </Toggle>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setFontSizePx((previous) => (previous >= 14 ? 11 : previous + 1))
                  }}
                >
                  {fontSizePx}px
                </Button>

                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={isAssembledByService}
                  onPressedChange={setIsAssembledByService}
                  className="h-8 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/15"
                >
                  {isAssembledByService ? 'Assembled by service' : 'Disassembled view'}
                </Toggle>

                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={isWrapEnabled}
                  onPressedChange={setIsWrapEnabled}
                  className="h-8 gap-1.5 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/15"
                >
                  <WrapText className="h-3.5 w-3.5" />
                  Wrap
                </Toggle>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    const payload = displayedLogs.map((log) => `${formatDate(log.timestamp)}\t${log.containerName}\t${log.source}\t${log.message}`).join('\n')
                    const blob = new Blob([payload], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const anchor = document.createElement('a')
                    anchor.href = url
                    anchor.download = 'docker-logs.txt'
                    anchor.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  Download
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setClearedAt(Date.now())
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_200px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={logsSearchTerm}
                  onChange={(event) => {
                    setLogsSearchTerm(event.target.value)
                  }}
                  className="h-9 border-border/70 bg-background/70 pl-9"
                  placeholder="Search logs"
                />
              </div>
              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={logsSourceFilter}
                onChange={(event) => {
                  setLogsSourceFilter(event.target.value as 'all' | LogLineProjection['source'])
                }}
              >
                <option value="all">All sources</option>
                <option value="deployment">Deployments</option>
                <option value="mesh">Mesh</option>
              </select>
              <select
                className="h-9 rounded-md border border-border/70 bg-background/70 px-3 text-sm"
                value={logsContainerFilter}
                onChange={(event) => {
                  setLogsContainerFilter(event.target.value)
                }}
              >
                <option value="all">All containers</option>
                {logContainers.map((container) => (
                  <option key={container} value={container}>{container}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 text-xs">
            <Badge variant="outline">{allContainers.length} containers</Badge>
            <Badge variant="outline">{serviceEnvironmentGroups.length} service groups</Badge>
            <Badge variant="outline">{selectedContainerNames.size} selected</Badge>
            <Badge variant="outline">{displayedLogs.length} lines</Badge>
            {activeGroup ? <Badge>{activeGroup.name}</Badge> : null}

            <div className="ml-auto flex items-center gap-2">
              <DockerSelectionToggle
                ariaLabel="Select all visible containers"
                shape="round"
                pressed={allVisibleContainersSelected}
                indeterminate={someVisibleContainersSelected}
                onPressedChange={(pressed) => {
                  if (pressed) {
                    setSelectedContainerNames(new Set(visibleContainerNames))
                  } else {
                    setSelectedContainerNames(new Set())
                  }
                }}
              />
              <span className="text-[11px] text-muted-foreground">Visible list select</span>
            </div>
          </div>

          <div
            ref={logsViewportRef}
            className={`max-h-[72vh] overflow-auto bg-[#070b14] px-4 py-3 font-mono text-green-300 ${isWrapEnabled ? 'whitespace-pre-wrap wrap-break-word' : 'whitespace-pre'}`}
            style={{ fontSize: `${String(fontSizePx)}px` }}
          >
            {displayedLogs.map((log) => (
              <p key={log.id} className="mb-0.5">
                <span className="text-emerald-400">[{formatDate(log.timestamp)}]</span>{' '}
                <span className="text-slate-200">
                  [
                  {(() => {
                    const parsed = parseContainerIdentity(log.containerName)
                    const fallbackLabel = buildLogContainerLabel(parsed.serviceName, parsed.environment, parsed.replicaTag)
                    const displayLabel = logContainerLabelByName.get(log.containerName) ?? fallbackLabel

                    if (log.containerId) {
                      return (
                        <DockerContainerDetailModalTrigger id={log.containerId} className="text-slate-200 underline-offset-4 hover:underline text-left">
                          {displayLabel}
                        </DockerContainerDetailModalTrigger>
                      )
                    }

                    return displayLabel
                  })()}
                  ]
                </span>{' '}
                <span className="text-blue-300">[{log.source}]</span>{' '}
                {log.message}
              </p>
            ))}
            {displayedLogs.length === 0 ? (
              <p className="text-slate-400">No logs match the current filters.</p>
            ) : null}
          </div>

          <div className="border-t border-border/60 px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/docker/activity">Activity stream</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/docker/shell">Shell cockpit</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/deployments">Deployment logs</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
