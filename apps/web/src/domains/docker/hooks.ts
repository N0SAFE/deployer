"use client"

import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { debounceTime } from '@repo/orpc-utils'
import { dockerEndpoints } from './endpoints'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { useFleetServers } from '@/domains/fleet/hooks'
import { useMeshEventStreams, useMeshSseState } from '@/domains/mesh/hooks'
import {
  dockerContainerRuntimeEventSchema,
  dockerImageSecurityScanEventSchema,
  dockerContainerMetricPointSchema,
  dockerImageInspectDetailSchema,
  dockerRuntimeEventSchema,
  type DockerContainerMetricPoint,
  type DockerImageSecurityScanEvent,
  type DockerRuntimeCatalog,
  type DockerRuntimeEvent,
} from '@repo/contracts-entities'

type QueryPagination = {
  limit?: number
  offset?: number
}

type QueryInput = {
  query?: QueryPagination
}

type DockerContainerListQueryInput = {
  limit?: number
  offset?: number
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  filter?: Record<string, unknown>
}

type DockerContainerGroupedListQueryInput = DockerContainerListQueryInput

type LinkedContainerQueryInput = QueryInput & {
  include?: string
  maxDepth?: 1 | 2 | 3
}

type DockerContainerListContractInput = {
  query?: Partial<DockerContainerListQueryInput>
}

type DockerContainerGroupedListContractInput = {
  query?: Partial<DockerContainerGroupedListQueryInput>
}

export function useDockerContainerList(input?: DockerContainerListContractInput, options?: { enabled?: boolean }) {
  const query = input?.query

  return useQuery(
    dockerEndpoints.containers.list.queryOptions({
      input: {
        query: {
          limit: query?.limit ?? 100,
          offset: query?.offset ?? 0,
          ...(query?.sortBy ? { sortBy: query.sortBy } : {}),
          ...(query?.sortDirection ? { sortDirection: query.sortDirection } : {}),
          ...(query?.filter ? { filter: query.filter } : {}),
        },
      },
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerContainerGroupedList(
  input?: DockerContainerGroupedListContractInput,
  options?: { enabled?: boolean },
) {
  const query = input?.query

  return useQuery(
    dockerEndpoints.containers.grouped.queryOptions({
      input: {
        query: {
          limit: query?.limit ?? 100,
          offset: query?.offset ?? 0,
          ...(query?.sortBy ? { sortBy: query.sortBy } : {}),
          ...(query?.sortDirection ? { sortDirection: query.sortDirection } : {}),
          ...(query?.filter ? { filter: query.filter } : {}),
        },
      },
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerContainerLinkedList(input?: LinkedContainerQueryInput) {
  return useQuery(
    dockerEndpoints.containers.linked.queryOptions({
      input: {
        query: {
          limit: input?.query?.limit ?? 100,
          offset: input?.query?.offset ?? 0,
          include: input?.include,
          maxDepth: input?.maxDepth,
        },
      },
      refetchInterval: false,
    }),
  )
}

export function useDockerImageList(input?: QueryInput) {
  return useQuery(
    dockerEndpoints.images.list.queryOptions({
      input: {
        query: {
          limit: input?.query?.limit ?? 100,
          offset: input?.query?.offset ?? 0,
        },
      },
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchInterval: false,
    }),
  )
}

export function useDockerNetworkList(input?: QueryInput) {
  return useQuery(
    dockerEndpoints.networks.list.queryOptions({
      input: {
        query: {
          limit: input?.query?.limit ?? 100,
          offset: input?.query?.offset ?? 0,
        },
      },
      refetchInterval: false,
    }),
  )
}

export function useDockerVolumeList(input?: QueryInput) {
  return useQuery(
    dockerEndpoints.volumes.list.queryOptions({
      input: {
        query: {
          limit: input?.query?.limit ?? 100,
          offset: input?.query?.offset ?? 0,
        },
      },
      refetchInterval: false,
    }),
  )
}

export function useDockerRegistryList(input?: QueryInput) {
  return useQuery(
    dockerEndpoints.registries.list.queryOptions({
      input: {
        query: {
          limit: input?.query?.limit ?? 100,
          offset: input?.query?.offset ?? 0,
        },
      },
      refetchInterval: false,
    }),
  )
}

export function useDockerStackList(input?: QueryInput) {
  return useQuery(
    dockerEndpoints.stacks.list.queryOptions({
      input: {
        query: {
          limit: input?.query?.limit ?? 100,
          offset: input?.query?.offset ?? 0,
        },
      },
      refetchInterval: false,
    }),
  )
}

type DockerRuntimeEventsStreamInput = Parameters<
  typeof dockerEndpoints.runtime.stream.experimental_liveObservableOptions
>[0]['input']

type DockerRuntimeActivityListInput = Parameters<
  typeof dockerEndpoints.runtime.activity.list.queryOptions
>[0]['input']

type DockerRuntimeActivityDetailInput = Parameters<
  typeof dockerEndpoints.runtime.activity.detail.queryOptions
>[0]['input']

type DockerContainerInspectStreamInput = Parameters<
  typeof dockerEndpoints.containers.streams.inspect.experimental_liveObservableOptions
>[0]['input']

type DockerContainerInspectInput = Parameters<
  typeof dockerEndpoints.containers.inspect.queryOptions
>[0]['input']

type DockerContainerLogsStreamInput = Parameters<
  typeof dockerEndpoints.containers.streams.logs.experimental_streamedObservableOptions
>[0]['input']

type DockerContainerLogsSnapshotInput = Parameters<
  typeof dockerEndpoints.containers.logs.list.queryOptions
>[0]['input']

type DockerContainerProcessesInput = Parameters<
  typeof dockerEndpoints.containers.processes.list.queryOptions
>[0]['input']

type DockerContainerProcessesStreamInput = Parameters<
  typeof dockerEndpoints.containers.streams.processes.experimental_liveObservableOptions
>[0]['input']

type DockerContainerProcessLogsStreamInput = Parameters<
  typeof dockerEndpoints.containers.streams.processLogs.experimental_streamedObservableOptions
>[0]['input']

type DockerContainerFilesInput = Parameters<
  typeof dockerEndpoints.containers.filesystem.list.queryOptions
>[0]['input']

type DockerContainerReadFileInput = Parameters<
  typeof dockerEndpoints.containers.filesystem.read.queryOptions
>[0]['input']

type DockerImageInspectStreamInput = Parameters<
  typeof dockerEndpoints.images.streams.inspect.experimental_liveObservableOptions
>[0]['input']

type DockerImageInspectInput = Parameters<
  typeof dockerEndpoints.images.inspect.queryOptions
>[0]['input']

type DockerImageSecurityScanStreamInput = Parameters<
  typeof dockerEndpoints.images.security.scanning.stream.experimental_streamedObservableOptions
>[0]['input']

type DockerRuntimeEventFilterInput = NonNullable<DockerRuntimeEventsStreamInput['query']>['filter']
type DockerRuntimeScope = Exclude<DockerRuntimeEvent['source'], 'unknown'>

export type DockerRuntimeScopeSelection<
  Scope extends DockerRuntimeScope = DockerRuntimeScope,
  Actions extends readonly string[] | undefined = readonly string[] | undefined,
> = {
  scope: Scope
  actions?: Actions
}

type DockerRuntimeScopeSelections = readonly DockerRuntimeScopeSelection[]

export type DockerRuntimeTypedStreamInput<
  Selections extends DockerRuntimeScopeSelections | undefined = undefined,
> = DockerRuntimeEventsStreamInput & {
  readonly __scopeSelections?: Selections
}

type DockerRuntimeEventFromSelections<
  Selections extends DockerRuntimeScopeSelections | undefined,
> = Selections extends DockerRuntimeScopeSelections
  ? Extract<DockerRuntimeEvent, { source: Selections[number]['scope'] }>
  : DockerRuntimeEvent

export type DockerRuntimeEventFromTypedInput<Input> = Input extends DockerRuntimeTypedStreamInput<
  infer Selections
>
  ? DockerRuntimeEventFromSelections<Selections>
  : DockerRuntimeEvent

interface BuildDockerRuntimeStreamInputOptions<
  Selections extends DockerRuntimeScopeSelections | undefined = undefined,
> {
  since?: string
  until?: string
  filter?: DockerRuntimeEventFilterInput
  scopes?: Selections
}

type DockerScopedEventsStreamInput<
  Actions extends readonly string[] | undefined = readonly string[] | undefined,
> = {
  query?: {
    since?: string
    until?: string
    actions?: Actions
    filter?: DockerRuntimeEventFilterInput
  }
}

type DockerRuntimeExceptionalSelectionTuple<
  Scopes extends readonly DockerRuntimeScope[] | undefined,
> = Scopes extends readonly DockerRuntimeScope[]
  ? {
      [K in keyof Scopes]: Scopes[K] extends DockerRuntimeScope
        ? DockerRuntimeScopeSelection<Scopes[K], readonly string[]>
        : never
    }
  : readonly DockerRuntimeScopeSelection[]

const DEFAULT_DOCKER_DOMAIN_STREAM_INPUT: DockerScopedEventsStreamInput = { query: {} }

const EXCEPTIONAL_ACTIONS_BY_SCOPE: Record<DockerRuntimeScope, readonly string[]> = {
  container: ['create', 'update', 'rename', 'start', 'stop', 'die', 'kill', 'pause', 'unpause', 'destroy', 'delete'],
  image: ['create', 'update', 'pull', 'tag', 'untag', 'destroy', 'delete', 'scan_queued', 'scan_start', 'scan_progress', 'scan_complete', 'scan_error'],
  network: ['create', 'update', 'connect', 'disconnect', 'destroy', 'delete'],
  volume: ['create', 'update', 'mount', 'unmount', 'destroy', 'delete'],
  daemon: ['start', 'stop', 'restart', 'reload', 'update'],
  service: ['create', 'update', 'remove', 'delete'],
  node: ['create', 'update', 'remove', 'delete'],
  secret: ['create', 'update', 'remove', 'delete'],
  config: ['create', 'update', 'remove', 'delete'],
  builder: ['create', 'update', 'destroy', 'delete'],
}

const DEFAULT_EXCEPTIONAL_SCOPE_SELECTIONS: readonly DockerRuntimeScopeSelection[] =
  (Object.entries(EXCEPTIONAL_ACTIONS_BY_SCOPE) as Array<[DockerRuntimeScope, readonly string[]]>)
    .map(([scope, actions]) => ({ scope, actions }))

function mergeRuntimeFilters(
  scopeFilter: DockerRuntimeEventFilterInput | undefined,
  extraFilter: DockerRuntimeEventFilterInput | undefined,
): DockerRuntimeEventFilterInput | undefined {
  if (!scopeFilter) {
    return extraFilter
  }

  if (!extraFilter) {
    return scopeFilter
  }

  return {
    _and: [scopeFilter as Record<string, unknown>, extraFilter as Record<string, unknown>],
  } as DockerRuntimeEventFilterInput
}

function buildScopeFilter(scopes: readonly DockerRuntimeScopeSelection[]): DockerRuntimeEventFilterInput | undefined {
  if (scopes.length === 0) {
    return undefined
  }

  const nodes = scopes.map((selection) => {
    const normalizedActions = (selection.actions ?? [])
      .map((action) => action.trim())
      .filter((action) => action.length > 0)

    return {
      source: {
        operator: 'eq' as const,
        value: selection.scope,
      },
      ...(normalizedActions.length > 0
        ? {
            action: {
              operator: 'in' as const,
              value: normalizedActions,
            },
          }
        : {}),
    }
  })

  if (nodes.length === 1) {
    return nodes[0] as DockerRuntimeEventFilterInput
  }

  return {
    _or: nodes,
  } as DockerRuntimeEventFilterInput
}

export function buildDockerRuntimeStreamInput<
  Selections extends DockerRuntimeScopeSelections | undefined = undefined,
>(
  options: BuildDockerRuntimeStreamInputOptions<Selections> = {} as BuildDockerRuntimeStreamInputOptions<Selections>,
): DockerRuntimeTypedStreamInput<Selections> {
  const scopeFilter = buildScopeFilter(options.scopes ?? [])
  const mergedFilter = mergeRuntimeFilters(scopeFilter, options.filter)
  const query: Record<string, unknown> = {}

  if (options.since) {
    query.since = options.since
  }

  if (options.until) {
    query.until = options.until
  }

  if (mergedFilter) {
    query.filter = mergedFilter
  }

  return { query } as DockerRuntimeTypedStreamInput<Selections>
}

export function buildDockerExceptionalRuntimeStreamInput<
  Scopes extends readonly DockerRuntimeScope[] | undefined = undefined,
>(
  scopes?: Scopes,
): DockerRuntimeTypedStreamInput<DockerRuntimeExceptionalSelectionTuple<Scopes>> {
  const selectedScopes = scopes && scopes.length > 0
    ? scopes
    : (Object.keys(EXCEPTIONAL_ACTIONS_BY_SCOPE) as DockerRuntimeScope[])

  return buildDockerRuntimeStreamInput({
    scopes: selectedScopes.map((scope) => ({
      scope,
      actions: EXCEPTIONAL_ACTIONS_BY_SCOPE[scope],
    })),
  }) as DockerRuntimeTypedStreamInput<DockerRuntimeExceptionalSelectionTuple<Scopes>>
}

const DEFAULT_DOCKER_RUNTIME_STREAM_INPUT = buildDockerRuntimeStreamInput({
  scopes: DEFAULT_EXCEPTIONAL_SCOPE_SELECTIONS,
})

function mergeRuntimeScopedInput<
  Scope extends DockerRuntimeScope,
  Actions extends readonly string[] | undefined = undefined,
>(
  source: Scope,
  input: DockerScopedEventsStreamInput<Actions>,
): DockerRuntimeTypedStreamInput<readonly [DockerRuntimeScopeSelection<Scope, Actions>]> {
  const query = input.query ?? {}

  return buildDockerRuntimeStreamInput({
    since: query.since,
    until: query.until,
    filter: query.filter,
    scopes: [
      {
        scope: source,
        actions: query.actions,
      },
    ],
  }) as DockerRuntimeTypedStreamInput<readonly [DockerRuntimeScopeSelection<Scope, Actions>]>
}

interface DockerRuntimeEventSubscriptionOptions<
  Input extends DockerRuntimeTypedStreamInput | DockerRuntimeEventsStreamInput = typeof DEFAULT_DOCKER_RUNTIME_STREAM_INPUT,
> {
  enabled?: boolean
  input?: Input
  filter?: (event: DockerRuntimeEventFromTypedInput<Input>) => boolean
  cooldownMs?: number
  onEvent: (event: DockerRuntimeEventFromTypedInput<Input>) => void
}

interface DockerRuntimeEventSubscriberOptions {
  enabled?: boolean
  filter?: (event: DockerRuntimeEvent) => boolean
  cooldownMs?: number
  onEvent: (event: DockerRuntimeEvent) => void
}

interface UseEventTriggerOptions {
  enabled?: boolean
  cooldownMs?: number
}

type DockerRuntimeStreamStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface DockerRuntimeSseState {
  status: DockerRuntimeStreamStatus
  lastError: string | null
  event: DockerRuntimeEvent | null
}

interface UseContainerLiveUpdateOptions {
  enabled?: boolean
  containerId?: string
  containerName?: string
  includeServiceEvents?: boolean
  includeDaemonEvents?: boolean
  cooldownMs?: number
}

interface RealtimeMetricsState {
  timelineByHash: Record<string, DockerContainerMetricPoint[]>
  latestAtByHash: Record<string, string>
}

interface UseRealtimeMetricsOptions {
  enabled?: boolean
  cooldownMs?: number
  historySize?: number
  resolveHash?: (event: DockerRuntimeEvent) => string | null
}

interface DockerRuntimeEventsProviderProps {
  children: ReactNode
  input?: DockerRuntimeEventsStreamInput
  enabled?: boolean
  cooldownMs?: number
}

interface RuntimeEventSubscriptionEntry {
  id: number
  filter?: (event: DockerRuntimeEvent) => boolean
  cooldownMs: number
  lastDispatchedAt: number
  onEventRef: React.MutableRefObject<(event: DockerRuntimeEvent) => void>
}

interface DockerRuntimeEventsContextValue {
  subscribe: (
    options: Omit<RuntimeEventSubscriptionEntry, 'id' | 'lastDispatchedAt'>,
  ) => () => void
  sseState: DockerRuntimeSseState
}

const DockerRuntimeEventsContext = createContext<DockerRuntimeEventsContextValue | null>(null)

function buildRuntimeEventFingerprint(event: DockerRuntimeEvent): string {
  const payload = event.payload as Record<string, unknown>
  const containerId =
    typeof payload.containerId === 'string' ? payload.containerId : ''
  const containerName =
    typeof payload.containerName === 'string' ? payload.containerName : ''

  return [
    event.eventId ?? '',
    event.timestamp,
    event.source,
    event.action,
    containerId,
    containerName,
  ].join('|')
}

export function useDockerRuntimeEventsHub<
  Input extends DockerRuntimeTypedStreamInput | DockerRuntimeEventsStreamInput = typeof DEFAULT_DOCKER_RUNTIME_STREAM_INPUT,
>(
  input: Input = DEFAULT_DOCKER_RUNTIME_STREAM_INPUT as Input,
  options?: { enabled?: boolean },
) {
  const streamQuery = useQuery(
    dockerEndpoints.runtime.stream.experimental_liveObservableOptions({
      input: input as DockerRuntimeEventsStreamInput,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )

  const parsed = dockerRuntimeEventSchema.safeParse(streamQuery.data)

  return {
    ...streamQuery,
    event: (parsed.success ? parsed.data : null) as DockerRuntimeEventFromTypedInput<Input> | null,
  }
}

export function  DockerRuntimeEventsProvider({
  children,
  input = DEFAULT_DOCKER_RUNTIME_STREAM_INPUT,
  enabled = true,
  cooldownMs = 300,
}: DockerRuntimeEventsProviderProps) {
  const runtimeEventsHub = useDockerRuntimeEventsHub(input, { enabled })
  const { event } = runtimeEventsHub

  const subscriptionsRef = useRef<Map<number, RuntimeEventSubscriptionEntry>>(new Map())
  const subscriptionIdRef = useRef(0)
  const lastFingerprintRef = useRef<string | null>(null)
  const lastDispatchAtRef = useRef<number>(0)

  useEffect(() => {
    if (!enabled || !event) {
      return
    }

    const fingerprint = buildRuntimeEventFingerprint(event)
    if (lastFingerprintRef.current === fingerprint) {
      return
    }

    const now = Date.now()
    if (cooldownMs > 0 && now - lastDispatchAtRef.current < cooldownMs) {
      lastFingerprintRef.current = fingerprint
      return
    }

    lastFingerprintRef.current = fingerprint
    lastDispatchAtRef.current = now

    for (const subscription of subscriptionsRef.current.values()) {
      if (subscription.filter && !subscription.filter(event)) {
        continue
      }

      if (
        subscription.cooldownMs > 0
        && now - subscription.lastDispatchedAt < subscription.cooldownMs
      ) {
        continue
      }

      subscription.lastDispatchedAt = now

      try {
        subscription.onEventRef.current(event)
      } catch {
        // Subscriber handlers should not break other listeners.
      }
    }
  }, [cooldownMs, enabled, event])

  const sseState = useMemo<DockerRuntimeSseState>(() => {
    const status: DockerRuntimeStreamStatus = runtimeEventsHub.isError
      ? 'error'
      : runtimeEventsHub.fetchStatus === 'fetching'
        ? runtimeEventsHub.data
          ? 'connected'
          : 'connecting'
        : 'disconnected'

    return {
      status,
      lastError: runtimeEventsHub.isError
        ? runtimeEventsHub.error instanceof Error
          ? runtimeEventsHub.error.message
          : 'Docker runtime stream connection error'
        : null,
      event,
    }
  }, [event, runtimeEventsHub.data, runtimeEventsHub.error, runtimeEventsHub.fetchStatus, runtimeEventsHub.isError])

  const contextValue = useMemo<DockerRuntimeEventsContextValue>(() => {
    return {
      subscribe: (options) => {
        const id = subscriptionIdRef.current
        subscriptionIdRef.current += 1

        subscriptionsRef.current.set(id, {
          ...options,
          id,
          lastDispatchedAt: 0,
        })

        return () => {
          subscriptionsRef.current.delete(id)
        }
      },
      sseState,
    }
  }, [sseState])

  return createElement(
    DockerRuntimeEventsContext.Provider,
    { value: contextValue },
    children,
  )
}

export function useDockerRuntimeEventSubscriber({
  enabled = true,
  filter,
  cooldownMs = 750,
  onEvent,
}: DockerRuntimeEventSubscriberOptions): void {
  const runtimeEventsContext = useContext(DockerRuntimeEventsContext)

  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!enabled || !runtimeEventsContext) {
      return
    }

    return runtimeEventsContext.subscribe({
      filter,
      cooldownMs,
      onEventRef,
    })
  }, [cooldownMs, enabled, filter, runtimeEventsContext])

  useDockerRuntimeEventSubscription({
    enabled: enabled && runtimeEventsContext === null,
    filter,
    cooldownMs,
    onEvent,
  })
}

interface UseDockerRuntimeRefetchOnStreamOptions {
  /**
   * Restrict the source observable to one or more runtime scopes
   * (`container`, `image`, `service`, `daemon`, ...). When omitted, every
   * event emitted by the docker runtime stream is observed.
   */
  scopes?: readonly DockerRuntimeScope[]
  /**
   * Restrict the source observable to a list of docker event actions
   * (e.g. `["create", "update", "destroy"]`). Forwarded to the underlying
   * ORPC stream input.
   */
  actions?: readonly string[]
  /**
   * Wait this many milliseconds of quiet on the source observable before
   * emitting a single value. Defaults to `200`. This is the canonical way
   * to coalesce bursts of docker events into a single refetch signal.
   */
  debounceMs?: number
  enabled?: boolean
  onData: () => void
}

/**
 * Subscribe to the docker runtime SSE stream and invoke `onData` once after
 * a quiet period (debounced) following any matching event.
 *
 * This is the recommended replacement for the legacy
 * `useContainerLiveUpdate` + `cooldownMs` pattern when the goal is simply
 * to refetch another query (container list, image list, ...) in response to
 * docker runtime activity.
 *
 * Internally it leverages the new `queryFnOptions.pipe` parameter from
 * `@repo/orpc-utils` so that consumers can pass `pipe(obs) => obs.pipe(...)`
 * directly to the underlying stream. Default behavior (no pipe) is to
 * forward every event unchanged.
 */
export function useRealtimeMetrics(
  containerHashes: string[],
  {
    enabled = true,
    cooldownMs = 1000,
    historySize = 90,
    resolveHash,
  }: UseRealtimeMetricsOptions = {},
): RealtimeMetricsState {
  const [state, setState] = useState<RealtimeMetricsState>({
    timelineByHash: {},
    latestAtByHash: {},
  })

  const hashFilterSet = useMemo(() => {
    return new Set(containerHashes.map((value) => value.trim()).filter((value) => value.length > 0))
  }, [containerHashes])

  const streamQuery = useDockerContainerEventsStream(
    { query: {} },
    {
      enabled: enabled && hashFilterSet.size > 0,
    },
  )

  const lastFingerprintRef = useRef<string | null>(null)
  const lastDispatchAtRef = useRef<number>(0)

  useEffect(() => {
    if (!enabled || hashFilterSet.size === 0 || !streamQuery.data) {
      return
    }

    const parsedEvent = dockerContainerRuntimeEventSchema.safeParse(streamQuery.data)
    if (!parsedEvent.success) {
      return
    }

    const event = parsedEvent.data
    const fingerprint = buildRuntimeEventFingerprint(event)
    if (lastFingerprintRef.current === fingerprint) {
      return
    }

    const now = Date.now()
    if (cooldownMs > 0 && now - lastDispatchAtRef.current < cooldownMs) {
      lastFingerprintRef.current = fingerprint
      return
    }

    lastFingerprintRef.current = fingerprint
    lastDispatchAtRef.current = now

    const resolvedHash =
      resolveHash?.(event)
      ?? event.payload.containerId
      ?? event.payload.containerName
      ?? event.actorId
      ?? null

    if (!resolvedHash || !hashFilterSet.has(resolvedHash)) {
      return
    }

    const eventTimestamp = event.timestamp
    const eventPoint = dockerContainerMetricPointSchema.parse({
      at: eventTimestamp,
      cpu: 0,
      memory: 0,
      networkRxKb: 0,
      networkTxKb: 0,
      ioReadKb: 0,
      ioWriteKb: 0,
    })

    setState((previous) => {
      const timeline = previous.timelineByHash[resolvedHash] ?? []
      const nextTimeline = [...timeline, eventPoint].slice(-historySize)

      return {
        timelineByHash: {
          ...previous.timelineByHash,
          [resolvedHash]: nextTimeline,
        },
        latestAtByHash: {
          ...previous.latestAtByHash,
          [resolvedHash]: eventTimestamp,
        },
      }
    })
  }, [cooldownMs, enabled, hashFilterSet, historySize, resolveHash, streamQuery.data])

  return state
}

export function useDockerRuntimeEventSubscription<
  Input extends DockerRuntimeTypedStreamInput | DockerRuntimeEventsStreamInput = typeof DEFAULT_DOCKER_RUNTIME_STREAM_INPUT,
>({
  enabled = true,
  input = DEFAULT_DOCKER_RUNTIME_STREAM_INPUT as Input,
  filter,
  cooldownMs = 750,
  onEvent,
}: DockerRuntimeEventSubscriptionOptions<Input>): void {
  const { event } = useDockerRuntimeEventsHub(input, { enabled })

  const lastFingerprintRef = useRef<string | null>(null)
  const lastDispatchAtRef = useRef<number>(0)

  useEffect(() => {
    if (!enabled || !event) {
      return
    }

    const fingerprint = buildRuntimeEventFingerprint(event)
    if (lastFingerprintRef.current === fingerprint) {
      return
    }

    if (filter && !filter(event)) {
      lastFingerprintRef.current = fingerprint
      return
    }

    const now = Date.now()
    if (cooldownMs > 0 && now - lastDispatchAtRef.current < cooldownMs) {
      lastFingerprintRef.current = fingerprint
      return
    }

    lastFingerprintRef.current = fingerprint
    lastDispatchAtRef.current = now
    onEvent(event)
  }, [cooldownMs, enabled, event, filter, onEvent])
}

export function useDockerRuntimeSnapshot(options?: { enabled?: boolean }) {
  return useQuery(
    dockerEndpoints.runtime.snapshot.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerRuntimeActivityList(
  input?: DockerRuntimeActivityListInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.runtime.activity.list.queryOptions({
      input: input ?? {
        query: {
          limit: 200,
          offset: 0,
        },
      },
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerRuntimeActivityDetail(
  input: DockerRuntimeActivityDetailInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.runtime.activity.detail.queryOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerRuntimeSseState(
  input: DockerRuntimeEventsStreamInput = DEFAULT_DOCKER_RUNTIME_STREAM_INPUT,
): DockerRuntimeSseState {
  const runtimeEventsContext = useContext(DockerRuntimeEventsContext)

  const streamQuery = useQuery(
    dockerEndpoints.runtime.stream.experimental_liveObservableOptions({
      input,
      enabled: runtimeEventsContext === null,
      refetchInterval: false,
    }),
  )

  if (runtimeEventsContext) {
    return runtimeEventsContext.sseState
  }

  const parsedEvent = dockerRuntimeEventSchema.safeParse(streamQuery.data)
  const event = parsedEvent.success ? parsedEvent.data : null

  const status: DockerRuntimeStreamStatus = streamQuery.isError
    ? 'error'
    : streamQuery.fetchStatus === 'fetching'
      ? streamQuery.data
        ? 'connected'
        : 'connecting'
      : 'disconnected'

  return {
    status,
    lastError: streamQuery.isError
      ? streamQuery.error instanceof Error
        ? streamQuery.error.message
        : 'Docker runtime stream connection error'
      : null,
    event,
  }
}

export type DockerRuntimeCatalogEntityKind = 'containers' | 'images' | 'networks' | 'volumes' | 'registries' | 'stacks'

type DockerRuntimeCatalogEntityMap = {
  [K in DockerRuntimeCatalogEntityKind]: DockerRuntimeCatalog[K][number]
}

export function useDockerRuntimeEntityDetail<K extends DockerRuntimeCatalogEntityKind>(
  kind: K,
  id: string,
  options?: { enabled?: boolean },
) {
  const runtimeSnapshotQuery = useDockerRuntimeSnapshot(options)
  const entityList = runtimeSnapshotQuery.data?.[kind] ?? []
  const entity = entityList.find((item) => item.id === id) as DockerRuntimeCatalogEntityMap[K] | undefined

  return {
    ...runtimeSnapshotQuery,
    data: entity ?? null,
  }
}

type DockerScopedRuntimeEvent<Scope extends DockerRuntimeScope> = Extract<
  DockerRuntimeEvent,
  { source: Scope }
>

function narrowRuntimeEventByScope<Scope extends DockerRuntimeScope>(
  event: DockerRuntimeEvent | null,
  scope: Scope,
): DockerScopedRuntimeEvent<Scope> | null {
  if (event?.source !== scope) {
    return null
  }

  return event as DockerScopedRuntimeEvent<Scope>
}

function useDockerScopedRuntimeEventsStream<
  Scope extends DockerRuntimeScope,
  Actions extends readonly string[] | undefined = undefined,
>(
  scope: Scope,
  input: DockerScopedEventsStreamInput<Actions> = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT as DockerScopedEventsStreamInput<Actions>,
  options?: { enabled?: boolean },
) {
  const streamQuery = useQuery(
    dockerEndpoints.runtime.stream.experimental_liveObservableOptions({
      input: mergeRuntimeScopedInput(scope, input),
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )

  const parsed = dockerRuntimeEventSchema.safeParse(streamQuery.data)

  return {
    ...streamQuery,
    event: parsed.success ? narrowRuntimeEventByScope(parsed.data, scope) : null,
  }
}

export function useDockerContainerEventsStream(
  input: DockerScopedEventsStreamInput = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT,
  options?: { enabled?: boolean },
) {
  const streamQuery = useQuery(
    dockerEndpoints.runtime.stream.experimental_liveObservableOptions({
      input: mergeRuntimeScopedInput('container', input),
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )

  const parsed = dockerContainerRuntimeEventSchema.safeParse(streamQuery.data)

  return {
    ...streamQuery,
    event: parsed.success ? parsed.data : null,
  }
}

export function useDockerContainerInspectStream(
  input: DockerContainerInspectStreamInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.containers.streams.inspect.experimental_liveObservableOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerContainerInspect(
  input: DockerContainerInspectInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.containers.inspect.queryOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerContainerLogsStream(
  input: DockerContainerLogsStreamInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.containers.streams.logs.experimental_streamedObservableOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
      
    }),
  )
}

export function useDockerContainerLogsSnapshot(
  input: DockerContainerLogsSnapshotInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.containers.logs.list.queryOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerContainerProcesses(
  input: DockerContainerProcessesInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.containers.processes.list.queryOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerContainerProcessesStream(
  input: DockerContainerProcessesStreamInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.containers.streams.processes.experimental_liveObservableOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerContainerProcessLogsStream(
  input: DockerContainerProcessLogsStreamInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.containers.streams.processLogs.experimental_streamedObservableOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerContainerFiles(
  input: DockerContainerFilesInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.containers.filesystem.list.queryOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerContainerReadFile(
  input: DockerContainerReadFileInput,
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.containers.filesystem.read.queryOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerWriteContainerFile() {
  return useMutation(dockerEndpoints.containers.filesystem.write.mutationOptions())
}

export function useDockerDeleteContainerPath() {
  return useMutation(dockerEndpoints.containers.filesystem.deletePath.mutationOptions())
}

export function useDockerRenameContainerPath() {
  return useMutation(dockerEndpoints.containers.filesystem.renamePath.mutationOptions())
}

export function useDockerCreateContainerDirectory() {
  return useMutation(dockerEndpoints.containers.filesystem.createDirectory.mutationOptions())
}

export function useDockerRunContainerAction() {
  return useMutation(dockerEndpoints.containers.actions.run.mutationOptions())
}

export function useDockerOpenContainerTerminalSession() {
  return useMutation(dockerEndpoints.containers.terminal.open.mutationOptions())
}

export function useDockerContainerTerminalSessionStream(
  input: Parameters<typeof dockerEndpoints.containers.terminal.stream.experimental_liveObservableOptions>[0]['input'],
  options?: { enabled?: boolean },
) {
  return useQuery(
    dockerEndpoints.containers.terminal.stream.experimental_liveObservableOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )
}

export function useDockerSendContainerTerminalInput() {
  return useMutation(dockerEndpoints.containers.terminal.sendInput.mutationOptions())
}

export function useDockerCloseContainerTerminalSession() {
  return useMutation(dockerEndpoints.containers.terminal.close.mutationOptions())
}

export function useDockerImageInspectStream(
  input: DockerImageInspectStreamInput,
  options?: { enabled?: boolean },
) {
  const query = useQuery(
    dockerEndpoints.images.streams.inspect.experimental_liveObservableOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )

  const parsed = dockerImageInspectDetailSchema.safeParse(query.data)

  return {
    ...query,
    detail: parsed.success ? parsed.data : null,
  }
}

export function useDockerImageSecurityScanStream(
  input: DockerImageSecurityScanStreamInput,
  options?: { enabled?: boolean },
) {
  const query = useQuery(
    dockerEndpoints.images.security.scanning.stream.experimental_streamedObservableOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
      refetchOnMount: 'always',
      refetchOnReconnect: 'always',
    }),
  )

  const events = useMemo(() => {
    const data = query.data
    if (!data) {
      return []
    }

    const candidates = Array.isArray(data) ? data : [data]
    return candidates.flatMap((candidate) => {
      const parsed = dockerImageSecurityScanEventSchema.safeParse(candidate)
      return parsed.success ? [parsed.data] : []
    })
  }, [query.data])

  return {
    ...query,
    event: events.length > 0 ? events[events.length - 1] : null,
    events,
  }
}

export function useDockerImageInspect(
  input: DockerImageInspectInput,
  options?: { enabled?: boolean },
) {
  const query = useQuery(
    dockerEndpoints.images.inspect.queryOptions({
      input,
      enabled: options?.enabled ?? true,
      refetchInterval: false,
    }),
  )

  return query;
}

export function useDockerImageEventsStream<
  Actions extends readonly string[] | undefined = undefined,
>(
  input: DockerScopedEventsStreamInput<Actions> = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT as DockerScopedEventsStreamInput<Actions>,
  options?: { enabled?: boolean },
) {
  return useDockerScopedRuntimeEventsStream('image', input, options)
}

export function useDockerNetworkEventsStream<
  Actions extends readonly string[] | undefined = undefined,
>(
  input: DockerScopedEventsStreamInput<Actions> = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT as DockerScopedEventsStreamInput<Actions>,
) {
  return useDockerScopedRuntimeEventsStream('network', input)
}

export function useDockerVolumeEventsStream<
  Actions extends readonly string[] | undefined = undefined,
>(
  input: DockerScopedEventsStreamInput<Actions> = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT as DockerScopedEventsStreamInput<Actions>,
) {
  return useDockerScopedRuntimeEventsStream('volume', input)
}

export function useDockerDaemonEventsStream<
  Actions extends readonly string[] | undefined = undefined,
>(
  input: DockerScopedEventsStreamInput<Actions> = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT as DockerScopedEventsStreamInput<Actions>,
) {
  return useDockerScopedRuntimeEventsStream('daemon', input)
}

export function useDockerServiceEventsStream<
  Actions extends readonly string[] | undefined = undefined,
>(
  input: DockerScopedEventsStreamInput<Actions> = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT as DockerScopedEventsStreamInput<Actions>,
) {
  return useDockerScopedRuntimeEventsStream('service', input)
}

export function useDockerNodeEventsStream<
  Actions extends readonly string[] | undefined = undefined,
>(
  input: DockerScopedEventsStreamInput<Actions> = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT as DockerScopedEventsStreamInput<Actions>,
) {
  return useDockerScopedRuntimeEventsStream('node', input)
}

export function useDockerSecretEventsStream<
  Actions extends readonly string[] | undefined = undefined,
>(
  input: DockerScopedEventsStreamInput<Actions> = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT as DockerScopedEventsStreamInput<Actions>,
) {
  return useDockerScopedRuntimeEventsStream('secret', input)
}

export function useDockerConfigEventsStream<
  Actions extends readonly string[] | undefined = undefined,
>(
  input: DockerScopedEventsStreamInput<Actions> = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT as DockerScopedEventsStreamInput<Actions>,
) {
  return useDockerScopedRuntimeEventsStream('config', input)
}

export function useDockerBuilderEventsStream<
  Actions extends readonly string[] | undefined = undefined,
>(
  input: DockerScopedEventsStreamInput<Actions> = DEFAULT_DOCKER_DOMAIN_STREAM_INPUT as DockerScopedEventsStreamInput<Actions>,
) {
  return useDockerScopedRuntimeEventsStream('builder', input)
}

// Compatibility adapters used by existing docker/admin pages, now backed by real APIs.
export function useDockerDeploymentList(input?: QueryInput) {
  return useDeploymentList({
    query: {
      limit: input?.query?.limit ?? 100,
      offset: input?.query?.offset ?? 0,
    },
  })
}

export function useDockerServiceList(input?: QueryInput) {
  return useServiceList({
    query: {
      limit: input?.query?.limit ?? 100,
      offset: input?.query?.offset ?? 0,
    },
  })
}

export function useDockerFleetServers() {
  return useFleetServers()
}

export function useDockerMeshEventStreams(input?: QueryInput) {
  return useMeshEventStreams({
    query: {
      limit: input?.query?.limit ?? 100,
      offset: input?.query?.offset ?? 0,
    },
  })
}

export function useDockerMeshSseState() {
  return useMeshSseState()
}
