'use client'

import Link from 'next/link'
import { AuthDashboardDeployments, AuthDashboardDockerActivity, AuthDashboardDockerShell } from '@/routes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DockerContainerDetailModalTrigger } from '../_components/container-detail-modal'
import { DockerInlineLoadingState } from '../_components/docker-loading-states'
import { DockerSelectionToggle } from '../_components/docker-page-utilities'
import {
  useDockerContainerList,
  useDockerRuntimeSseState,
  useDockerServiceList,
} from '@/domains/docker/hooks'
import { useDockerLiveRefetch } from '@/domains/docker/use-docker-live'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Toggle } from '@repo/ui/components/shadcn/toggle'
import { Pause, Play, Search, WrapText } from 'lucide-react'
import { buildLogContainerLabel, formatDate, parseContainerIdentity } from './_lib/container-identity'
import { useContainerStreamLogs } from './_hooks/use-container-stream-logs'
import { useFilteredLogs } from './_hooks/use-filtered-logs'
import { usePersistedLogGroups } from './_hooks/use-persisted-log-groups'
import { useRuntimeEventLogs } from './_hooks/use-runtime-event-logs'
import { useServiceEnvironmentGroups } from './_hooks/use-service-environment-groups'
import type { ContainerLogGroup, LogLineProjection } from './_models/logs.types'

const DEPLOYMENT_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

const debugDockerLogsPage = createContextFilterDebugLogger('DockerLogsPage', 'docker-web-logs')

export default function DashboardDockerLogsPage() {
  const logsViewportRef = useRef<HTMLDivElement | null>(null)
  const hasInitializedBottomRef = useRef(false)

  const [logsSearchTerm, setLogsSearchTerm] = useState('')
  const [containerSearchTerm, setContainerSearchTerm] = useState('')
  const [logsSourceFilter, setLogsSourceFilter] = useState<'all' | LogLineProjection['source']>('all')
  const [logsContainerFilter, setLogsContainerFilter] = useState('all')
  const [logsViewMode, setLogsViewMode] = useState<'single' | 'multi' | 'grouped'>('grouped')
  const [selectedContainerNames, setSelectedContainerNames] = useState<Set<string>>(new Set())
  const [newGroupName, setNewGroupName] = useState('')
  const [isPaused, setIsPaused] = useState(false)
  const [isAssembledByService, setIsAssembledByService] = useState(true)
  const [isAutoScroll, setIsAutoScroll] = useState(true)
  const [isWrapEnabled, setIsWrapEnabled] = useState(true)
  const [fontSizePx, setFontSizePx] = useState(12)
  const [pausedSnapshot, setPausedSnapshot] = useState<LogLineProjection[] | null>(null)
  const [clearedAt, setClearedAt] = useState<number | null>(null)

  const {
    containerGroups,
    setContainerGroups,
    activeGroupId,
    setActiveGroupId,
    activeGroup,
  } = usePersistedLogGroups()

  const { runtimeEventLogs } = useRuntimeEventLogs()

  const containerListQuery = useDockerContainerList(DEPLOYMENT_LIST_INPUT)
  const serviceListQuery = useDockerServiceList(DEPLOYMENT_LIST_INPUT)

  const handleContainerLiveUpdate = useCallback(() => {
    void containerListQuery.refetch()
    return serviceListQuery.refetch()
  }, [containerListQuery, serviceListQuery])

  useDockerLiveRefetch({
    on: { container: ['create', 'update', 'destroy', 'die', 'start', 'stop', 'restart'] },
    onData: handleContainerLiveUpdate,
    debounceMs: 900,
  })

  const { data: containerEntityData } = containerListQuery
  const { data: serviceData } = serviceListQuery
  const { status: runtimeSseStatus } = useDockerRuntimeSseState()

  const containerEntities = containerEntityData?.data ?? []
  const containerEntityById = useMemo(
    () => new Map(containerEntities.map((container) => [container.id, container])),
    [containerEntities],
  )
  const containerEntityByName = useMemo(
    () => new Map(containerEntities.map((container) => [container.name, container])),
    [containerEntities],
  )
  const services = serviceData?.data ?? []

  const serviceNameById = useMemo(() => {
    return new Map(services.map((service) => [service.id, service.name]))
  }, [services])

  const activeContainerStreamEntity = useMemo(() => {
    const candidates: string[] = []

    if (logsContainerFilter !== 'all') {
      candidates.push(logsContainerFilter)
    }

    const selected = Array.from(selectedContainerNames).sort((a, b) => a.localeCompare(b))
    candidates.push(...selected)

    const allByName = containerEntities
      .map((container) => container.name)
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b))

    candidates.push(...allByName)

    for (const name of candidates) {
      const match = containerEntityByName.get(name)
      if (match) {
        return match
      }
    }

    return null
  }, [containerEntities, containerEntityByName, logsContainerFilter, selectedContainerNames])

  const { containerStreamLogs } = useContainerStreamLogs(activeContainerStreamEntity, isPaused)

  useEffect(() => {
    debugDockerLogsPage('activeStreamTarget', {
      runtimeSseStatus,
      paused: isPaused,
      logsContainerFilter,
      selectedContainerCount: selectedContainerNames.size,
      activeContainerStreamEntityId: activeContainerStreamEntity?.id ?? null,
      activeContainerStreamEntityName: activeContainerStreamEntity?.name ?? null,
    })
  }, [
    activeContainerStreamEntity?.id,
    activeContainerStreamEntity?.name,
    isPaused,
    logsContainerFilter,
    runtimeSseStatus,
    selectedContainerNames,
  ])

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

    registerLabel('mesh-control-plane', 'mesh-control-plane', 'system')

    return labels
  }, [containerEntities, serviceNameById])

  const logs = useMemo<LogLineProjection[]>(() => {
    return [...runtimeEventLogs, ...containerStreamLogs]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }, [containerStreamLogs, runtimeEventLogs])

  const logContainers = useMemo(() => {
    const knownContainers = containerEntities
      .map((container) => container.name)
      .filter((name): name is string => Boolean(name))

    return Array.from(new Set([...knownContainers, ...logs.map((log) => log.containerName)]))
      .sort((a, b) => a.localeCompare(b))
  }, [containerEntities, logs])

  const allContainers = useMemo(() => {
    return containerEntities
      .map((container) => container.name)
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b))
  }, [containerEntities])

  useEffect(() => {
    if (logsContainerFilter === 'all') {
      return
    }

    if (!logContainers.includes(logsContainerFilter)) {
      setLogsContainerFilter('all')
    }
  }, [logContainers, logsContainerFilter])

  const { serviceEnvironmentGroups, visibleContainerNames } = useServiceEnvironmentGroups(
    containerEntities,
    serviceNameById,
    containerSearchTerm,
  )

  const filteredLogs = useFilteredLogs({
    logs,
    logsSearchTerm,
    logsSourceFilter,
    logsContainerFilter,
    logsViewMode,
    selectedContainerNames,
    activeGroup,
    clearedAt,
  })

  useEffect(() => {
    if (!isPaused) {
      setPausedSnapshot(null)
    }
  }, [isPaused])

  const displayedLogs = isPaused ? (pausedSnapshot ?? filteredLogs) : filteredLogs

  useEffect(() => {
    debugDockerLogsPage('renderedLogsCounters', {
      runtimeEventLogs: runtimeEventLogs.length,
      containerStreamLogs: containerStreamLogs.length,
      mergedLogs: logs.length,
      filteredLogs: filteredLogs.length,
      displayedLogs: displayedLogs.length,
      logsSourceFilter,
      logsContainerFilter,
      logsViewMode,
      search: logsSearchTerm,
      activeGroupId,
      selectedContainerCount: selectedContainerNames.size,
    })
  }, [
    activeGroupId,
    containerStreamLogs.length,
    displayedLogs.length,
    filteredLogs.length,
    logs.length,
    logsContainerFilter,
    logsSearchTerm,
    logsSourceFilter,
    logsViewMode,
    runtimeEventLogs.length,
    selectedContainerNames,
  ])

  useEffect(() => {
    if (displayedLogs.length === 0) {
      hasInitializedBottomRef.current = false
      return
    }

    const viewport = logsViewportRef.current
    if (!viewport || !isAutoScroll || hasInitializedBottomRef.current) {
      return
    }

    viewport.scrollTop = viewport.scrollHeight
    hasInitializedBottomRef.current = true
  }, [displayedLogs.length, isAutoScroll])

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
  const isLogsLoading = (containerListQuery.isLoading || serviceListQuery.isLoading) && containerEntities.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      {isLogsLoading ? <DockerInlineLoadingState label="Loading container tree and runtime log channels…" /> : null}
      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
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

          <div className="min-h-0 flex-1 space-y-1 overflow-auto px-2 py-2 text-xs">
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
                  isLogsLoading ? (
                    <div className="space-y-1.5 px-2 py-2">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Skeleton key={`docker-logs-tree-loading-${String(index)}`} className="h-7 w-full" />
                      ))}
                    </div>
                  ) : (
                    <p className="px-2 py-4 text-xs text-muted-foreground">No service groups match your filter.</p>
                  )
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
                  isLogsLoading ? (
                    <div className="space-y-1.5 px-2 py-2">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Skeleton key={`docker-logs-flat-loading-${String(index)}`} className="h-7 w-full" />
                      ))}
                    </div>
                  ) : (
                    <p className="px-2 py-4 text-xs text-muted-foreground">No containers match your filter.</p>
                  )
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

        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
          <div className="border-b border-border/60 bg-background/70 px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="font-medium">Live</span>
                <Badge variant="outline" className="text-[10px]">{runtimeSseStatus}</Badge>
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
                <option value="runtime">Runtime stream</option>
                <option value="container">Container logs stream</option>
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
            className={`min-h-0 flex-1 overflow-auto bg-[#070b14] px-4 py-3 font-mono text-green-300 ${isWrapEnabled ? 'whitespace-pre-wrap wrap-break-word' : 'whitespace-pre'}`}
            style={{
              fontSize: `${String(fontSizePx)}px`,
              overflowAnchor: isAutoScroll ? 'auto' : 'none',
            }}
          >
            {displayedLogs.map((log) => (
              <p key={log.id} className="mb-0.5" style={{ overflowAnchor: 'none' }}>
                <span className="text-emerald-400">[{formatDate(log.timestamp)}]</span>{' '}
                <span className="text-slate-200">
                  [
                  {(() => {
                    const parsed = parseContainerIdentity(log.containerName)
                    const fallbackLabel = buildLogContainerLabel(parsed.serviceName, parsed.environment, parsed.replicaTag)
                    const displayLabel = logContainerLabelByName.get(log.containerName) ?? fallbackLabel

                    if (log.containerId) {
                      return (
                        <DockerContainerDetailModalTrigger
                          id={log.containerId}
                          container={containerEntityById.get(log.containerId)}
                          className="text-slate-200 underline-offset-4 hover:underline text-left"
                        >
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
              isLogsLoading ? (
                <p className="text-slate-400" style={{ overflowAnchor: 'none' }}>Connecting runtime log streams…</p>
              ) : (
              <p className="text-slate-400" style={{ overflowAnchor: 'none' }}>No logs match the current filters.</p>
              )
            ) : null}

            <div
              aria-hidden
              className="pointer-events-none h-px"
              style={{ overflowAnchor: isAutoScroll ? 'auto' : 'none' }}
            />
          </div>

          <div className="border-t border-border/60 px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <AuthDashboardDockerActivity.Link>Activity stream</AuthDashboardDockerActivity.Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <AuthDashboardDockerShell.Link>Shell cockpit</AuthDashboardDockerShell.Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <AuthDashboardDeployments.Link>Deployment logs</AuthDashboardDeployments.Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
