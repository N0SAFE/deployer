'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dockerEndpoints } from './endpoints'
import { orpcClient } from '@/lib/orpc'
import type {
} from "@repo/contracts-entities";
import { isRecord, isObjectLike } from "@repo/type-guards";
import type {
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
  DockerEntityKind,
  DockerEntityStreamChunk,
  DockerEntityRemovedEvent,
} from '@repo/contracts-entities'

// ============================================================================
// Public types
// ============================================================================


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
export type DockerLiveEntityStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconciling'
  | 'error'
  | 'disconnected'

/**
 * Type-safe per-kind action set. The keys of `on` are restricted to the
 * four `DockerEntityKind` values, and the action arrays carry the runtime
 * action strings for the matching source. We use `string` here instead of
 * the per-kind action enums so callers don't have to deal with discriminated
 * union gymnastics; the underlying stream still validates the values.
 */
export type DockerLiveOnMap = {
  container?: readonly string[]
  image?: readonly string[]
  network?: readonly string[]
  volume?: readonly string[]
}

/**
 * Custom reducer signature. By default the hook uses the built-in reducer
 * which:
 *   - removes ids on `destroy` / `die` / `delete`
 *   - patches/inserts the entity on `create` / `update` / `rename` / etc.
 *   - falls through to a reconcile for ambiguous events
 */
export type DockerLiveApplyFn<TEntity> = (
  state: TEntity[],
  events: readonly DockerEntityStreamChunk[],
) => TEntity[]

export type DockerLiveEntitiesOptions = {
  /**
   * Declarative event subscription. Each kind's action array is type-checked
   * against the matching docker runtime action.
   *
   * @example
   *   on: {
   *     container: ['create', 'update', 'destroy', 'die'],
   *     image: ['create', 'update', 'destroy', 'delete'],
   *   }
   */
  on: DockerLiveOnMap
  /**
   * Coalesce bursty events before applying them. Default `200ms`.
   */
  debounceMs?: number
  /**
   * Periodically re-fetch the full list to heal any missed events.
   * Default `60_000ms`. Set to `0` to disable.
   */
  reconcileIntervalMs?: number
  /**
   * Custom reducer. Omit to use the built-in default.
   */
  applyEvents?: DockerLiveApplyFn<unknown>
  enabled?: boolean
}

export type DockerLiveEntitiesResult<TKind extends DockerEntityKind, TEntity> = {
  kind: TKind
  data: TEntity[]
  byId: Map<string, TEntity>
  lastSyncedAt: Date | null
  status: DockerLiveEntityStatus
  refetch: () => Promise<void>
}

// ============================================================================
// Per-kind config
// ============================================================================

/**
 * Convert a `DockerEntityStreamChunk` to its entity shape. The chunk is
 * the full entity payload with `kind`, `action`, `occurredAt`, `eventId`
 * appended — we just pass it through; the consumer's `getId` and the
 * reducer only care about the entity fields, and the extra metadata is
 * harmless.
 */
function chunkToEntity<T>(chunk: DockerEntityStreamChunk): T {
  return chunk as unknown as T
}

type KindConfig<TEntity> = {
  fetchList: () => Promise<TEntity[]>
  fetchOne: (id: string) => Promise<TEntity | null>
  getId: (item: TEntity) => string
}

const kindConfigs = {
  container: {
    fetchList: async () => {
      const result = await orpcClient.docker.entity.list({ kind: 'container' })
      const chunks = (result as { data?: DockerEntityStreamChunk[] }).data ?? []
      return chunks.map((c) => chunkToEntity<DockerContainer>(c))
    },
    fetchOne: async (id) => {
      const chunk = await orpcClient.docker.entity.inspect({ kind: 'container', id })
      if (!chunk) return null
      return chunkToEntity<DockerContainer>(chunk as DockerEntityStreamChunk)
    },
    getId: (c) => (c as DockerContainer).id,
  },
  image: {
    fetchList: async () => {
      const result = await orpcClient.docker.entity.list({ kind: 'image' })
      const chunks = (result as { data?: DockerEntityStreamChunk[] }).data ?? []
      return chunks.map((c) => chunkToEntity<DockerImage>(c))
    },
    fetchOne: async (id) => {
      const chunk = await orpcClient.docker.entity.inspect({ kind: 'image', id })
      if (!chunk) return null
      return chunkToEntity<DockerImage>(chunk as DockerEntityStreamChunk)
    },
    getId: (i) => (i as DockerImage).id,
  },
  network: {
    fetchList: async () => {
      const result = await orpcClient.docker.entity.list({ kind: 'network' })
      const chunks = (result as { data?: DockerEntityStreamChunk[] }).data ?? []
      return chunks.map((c) => chunkToEntity<DockerNetwork>(c))
    },
    fetchOne: async (id) => {
      const chunk = await orpcClient.docker.entity.inspect({ kind: 'network', id })
      if (!chunk) return null
      return chunkToEntity<DockerNetwork>(chunk as DockerEntityStreamChunk)
    },
    getId: (n) => (n as DockerNetwork).id,
  },
  volume: {
    fetchList: async () => {
      const result = await orpcClient.docker.entity.list({ kind: 'volume' })
      const chunks = (result as { data?: DockerEntityStreamChunk[] }).data ?? []
      return chunks.map((c) => chunkToEntity<DockerVolume>(c))
    },
    fetchOne: async (id) => {
      const chunk = await orpcClient.docker.entity.inspect({ kind: 'volume', id })
      if (!chunk) return null
      return chunkToEntity<DockerVolume>(chunk as DockerEntityStreamChunk)
    },
    getId: (v) => (v as DockerVolume).name,
  },
} as const satisfies Record<DockerEntityKind, KindConfig<unknown>>

// ============================================================================
// Stream filter builder
// ============================================================================

function buildEntityStreamFilter(
  on: DockerLiveOnMap,
): { kinds: DockerEntityKind[]; actions: Record<string, readonly string[]> } | undefined {
  const kinds: DockerEntityKind[] = []
  const actions: Record<string, readonly string[]> = {}
  for (const [scope, scopeActions] of Object.entries(on) as Array<
    [DockerEntityKind, readonly string[] | undefined]
  >) {
    if (scopeActions && scopeActions.length > 0) {
      kinds.push(scope)
      actions[scope] = scopeActions
    }
  }
  if (kinds.length === 0) {
    return undefined
  }
  return { kinds, actions }
}

// ============================================================================
// Default reducer
// ============================================================================

const REMOVAL_ACTIONS = new Set(['destroy', 'die', 'delete'])

function isRemovalEvent(chunk: DockerEntityStreamChunk): chunk is DockerEntityRemovedEvent {
  return (
    'id' in chunk &&
    typeof (chunk as { id?: unknown }).id === 'string' &&
    REMOVAL_ACTIONS.has((chunk as { action?: string }).action ?? '')
  )
}

function applyDefaultEvent<TEntity>(
  state: TEntity[],
  events: readonly DockerEntityStreamChunk[],
  config: KindConfig<TEntity>,
): TEntity[] {
  const byIdIndex = new Map<string, TEntity>()
  for (const item of state) {
    const id = config.getId(item)
    if (id) byIdIndex.set(id, item)
  }

  for (const chunk of events) {
    if (isRemovalEvent(chunk)) {
      byIdIndex.delete(chunk.id)
      continue
    }
    // The stream emits `DockerEntityRemovedEvent` (id-only) or
    // `DockerEntityEvent` (full entity). For the latter, patch in place.
    const id = config.getId(chunkToEntity<TEntity>(chunk))
    if (id) {
      byIdIndex.set(id, chunkToEntity<TEntity>(chunk))
    }
  }

  // Rebuild the array, preserving the original ordering and appending
  // new ids at the end.
  const seen = new Set<string>()
  const rebuilt: TEntity[] = []
  for (const item of state) {
    const id = config.getId(item)
    const fresh = byIdIndex.get(id)
    if (fresh !== undefined) {
      rebuilt.push(fresh)
      seen.add(id)
    } else {
      rebuilt.push(item)
      seen.add(id)
    }
  }
  for (const [id, item] of byIdIndex) {
    if (!seen.has(id)) {
      rebuilt.push(item)
    }
  }
  return rebuilt
}

// ============================================================================
// Public single-kind hook
// ============================================================================

/**
 * Subscribe to a single docker entity kind in a fully type-safe way.
 *
 * @example
 *   const { data: containers, byId, status, refetch } = useDockerLiveEntityKind({
 *     kind: 'container',
 *     on: ['create', 'update', 'destroy', 'die'],
 *   })
 */
export function useDockerLiveEntityKind<TKind extends DockerEntityKind, TEntity>(
  options: {
    kind: TKind
    on?: readonly string[]
    debounceMs?: number
    reconcileIntervalMs?: number
    applyEvents?: DockerLiveApplyFn<TEntity>
    enabled?: boolean
  },
): DockerLiveEntitiesResult<TKind, TEntity> {
  const {
    kind,
    on: actionsForKind,
    debounceMs = 200,
    reconcileIntervalMs = 60_000,
    applyEvents: customReducer,
    enabled = true,
  } = options

  const config = kindConfigs[kind] as unknown as KindConfig<TEntity>
  const onMap: DockerLiveOnMap = actionsForKind
    ? ({ [kind]: actionsForKind } as DockerLiveOnMap)
    : {}

  return useDockerLiveEntitiesInner<TKind, TEntity>({
    kind,
    on: onMap,
    config,
    debounceMs,
    reconcileIntervalMs,
    customReducer,
    enabled,
  })
}

// ============================================================================
// Public multi-kind hook
// ============================================================================

/**
 * Subscribe to **multiple** docker entity kinds in a single hook. The
 * `on` map is type-checked per kind. Each kind runs in its own
 * subscription + reconciler so failures are isolated.
 *
 * @example
 *   const { container, image } = useDockerLiveEntities({
 *     on: {
 *       container: ['create', 'update', 'destroy', 'die'],
 *       image: ['create', 'update', 'destroy', 'delete'],
 *     },
 *   })
 */
export function useDockerLiveEntities(on: DockerLiveEntitiesOptions): {
  container?: DockerLiveEntitiesResult<'container', DockerContainer>
  image?: DockerLiveEntitiesResult<'image', DockerImage>
  network?: DockerLiveEntitiesResult<'network', DockerNetwork>
  volume?: DockerLiveEntitiesResult<'volume', DockerVolume>
} {
  const containerConfig = kindConfigs.container
  const imageConfig = kindConfigs.image
  const networkConfig = kindConfigs.network
  const volumeConfig = kindConfigs.volume

  const container = on.on.container
    ? useDockerLiveEntitiesInner<'container', DockerContainer>({
        kind: 'container',
        on: { container: on.on.container },
        config: containerConfig as unknown as KindConfig<DockerContainer>,
        debounceMs: on.debounceMs,
        reconcileIntervalMs: on.reconcileIntervalMs,
        customReducer: on.applyEvents as DockerLiveApplyFn<DockerContainer> | undefined,
        enabled: on.enabled,
      })
    : undefined

  const image = on.on.image
    ? useDockerLiveEntitiesInner<'image', DockerImage>({
        kind: 'image',
        on: { image: on.on.image },
        config: imageConfig as unknown as KindConfig<DockerImage>,
        debounceMs: on.debounceMs,
        reconcileIntervalMs: on.reconcileIntervalMs,
        customReducer: on.applyEvents as DockerLiveApplyFn<DockerImage> | undefined,
        enabled: on.enabled,
      })
    : undefined

  const network = on.on.network
    ? useDockerLiveEntitiesInner<'network', DockerNetwork>({
        kind: 'network',
        on: { network: on.on.network },
        config: networkConfig as unknown as KindConfig<DockerNetwork>,
        debounceMs: on.debounceMs,
        reconcileIntervalMs: on.reconcileIntervalMs,
        customReducer: on.applyEvents as DockerLiveApplyFn<DockerNetwork> | undefined,
        enabled: on.enabled,
      })
    : undefined

  const volume = on.on.volume
    ? useDockerLiveEntitiesInner<'volume', DockerVolume>({
        kind: 'volume',
        on: { volume: on.on.volume },
        config: volumeConfig as unknown as KindConfig<DockerVolume>,
        debounceMs: on.debounceMs,
        reconcileIntervalMs: on.reconcileIntervalMs,
        customReducer: on.applyEvents as DockerLiveApplyFn<DockerVolume> | undefined,
        enabled: on.enabled,
      })
    : undefined

  return {
    ...(container
      ? { container: container as DockerLiveEntitiesResult<'container', DockerContainer> }
      : {}),
    ...(image ? { image: image as DockerLiveEntitiesResult<'image', DockerImage> } : {}),
    ...(network
      ? { network: network as DockerLiveEntitiesResult<'network', DockerNetwork> }
      : {}),
    ...(volume
      ? { volume: volume as DockerLiveEntitiesResult<'volume', DockerVolume> }
      : {}),
  }
}

// ============================================================================
// Inner hook (single kind, all the real logic lives here)
// ============================================================================

function useDockerLiveEntitiesInner<TKind extends DockerEntityKind, TEntity>(
  args: {
    kind: TKind
    on: DockerLiveOnMap
    config: KindConfig<TEntity>
    debounceMs?: number
    reconcileIntervalMs?: number
    customReducer?: DockerLiveApplyFn<TEntity>
    enabled?: boolean
  },
): DockerLiveEntitiesResult<TKind, TEntity> {
  const {
    kind,
    on,
    config,
    debounceMs = 200,
    reconcileIntervalMs = 60_000,
    customReducer,
    enabled = true,
  } = args

  // -------------------------------------------------------------------------
  // Local state
  // -------------------------------------------------------------------------
  const [data, setData] = useState<TEntity[]>([])
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [status, setStatus] = useState<DockerLiveEntityStatus>('idle')

  const dataRef = useRef<TEntity[]>(data)
  const customReducerRef = useRef(customReducer)

  useEffect(() => {
    dataRef.current = data
  }, [data])
  useEffect(() => {
    customReducerRef.current = customReducer
  }, [customReducer])

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------
  const byId = useMemo(() => {
    const map = new Map<string, TEntity>()
    for (const item of data) {
      const id = config.getId(item)
      if (id) {
        map.set(id, item)
      }
    }
    return map
  }, [data, config])

  const filter = useMemo(() => buildEntityStreamFilter(on), [on])

  // -------------------------------------------------------------------------
  // Event buffer + debounced flush
  // -------------------------------------------------------------------------
  const eventBufferRef = useRef<DockerEntityStreamChunk[]>([])
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushBuffer = useCallback(() => {
    const events = eventBufferRef.current
    eventBufferRef.current = []
    if (events.length === 0) {
      return
    }

    const reducer = customReducerRef.current
    const currentData = dataRef.current

    if (reducer) {
      const next = reducer(currentData, events)
      setData(next)
      dataRef.current = next
      return
    }

    // Default reducer path: every chunk is a `DockerEntityEvent` (full
    // payload) or `DockerEntityRemovedEvent` (id-only). The default
    // reducer patches/inserts on the former and removes on the latter.
    const next = applyDefaultEvent(currentData, events, config)
    setData(next)
    dataRef.current = next
  }, [config])

  // -------------------------------------------------------------------------
  // Subscribe to the unified docker entity stream
  // -------------------------------------------------------------------------
  const streamQuery = useQuery(
    dockerEndpoints.entity.stream.experimental_liveObservableOptions({
      input: { query: isRecord(filter) ? filter : undefined },
      enabled,
    }),
  )

  useEffect(() => {
    if (!enabled || streamQuery.isError || !streamQuery.data) {
      return
    }

    eventBufferRef.current.push(streamQuery.data as DockerEntityStreamChunk)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(flushBuffer, debounceMs)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [streamQuery.data, debounceMs, flushBuffer, enabled, streamQuery.isError])

  // -------------------------------------------------------------------------
  // Connection status
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }
    if (streamQuery.isError) {
      setStatus('error')
    } else if (streamQuery.fetchStatus === 'fetching') {
      setStatus('connected')
    } else if (streamQuery.isLoading) {
      setStatus('connecting')
    } else {
      setStatus('disconnected')
    }
  }, [enabled, streamQuery.isError, streamQuery.fetchStatus, streamQuery.isLoading])

  // -------------------------------------------------------------------------
  // Reconciliation (initial + periodic)
  // -------------------------------------------------------------------------
  const reconcile = useCallback(async () => {
    setStatus('reconciling')
    try {
      const fresh = await config.fetchList()
      setData(fresh)
      dataRef.current = fresh
      setLastSyncedAt(new Date())
      setStatus('connected')
    } catch {
      setStatus('error')
    }
  }, [config])

  useEffect(() => {
    if (enabled) {
      void reconcile()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  useEffect(() => {
    if (!enabled || reconcileIntervalMs <= 0) {
      return
    }
    const intervalId = setInterval(() => {
      void reconcile()
    }, reconcileIntervalMs)
    return () => {
      clearInterval(intervalId)
    }
  }, [reconcile, reconcileIntervalMs, enabled])

  return {
    kind,
    data,
    byId,
    lastSyncedAt,
    status,
    refetch: reconcile,
  }
}

// ============================================================================
// Convenience per-kind wrappers
// ============================================================================

/**
 * Live store for docker containers. Drops the legacy
 * `useContainerLiveUpdate` + `cooldownMs` pattern in favor of a
 * declarative `on` array.
 *
 * @example
 *   const { data: containers, byId, status, refetch } = useDockerLiveContainers({
 *     on: ['create', 'update', 'destroy', 'die'],
 *     reconcileIntervalMs: 30_000,
 *   })
 */
export function useDockerLiveContainers(
  options: {
    on?: readonly string[]
    debounceMs?: number
    reconcileIntervalMs?: number
    applyEvents?: DockerLiveApplyFn<DockerContainer>
    enabled?: boolean
  } = {},
) {
  return useDockerLiveEntityKind<'container', DockerContainer>({
    kind: 'container',
    on: options.on,
    debounceMs: options.debounceMs,
    reconcileIntervalMs: options.reconcileIntervalMs,
    applyEvents: options.applyEvents,
    enabled: options.enabled,
  })
}

/**
 * Live store for docker images.
 */
export function useDockerLiveImages(
  options: {
    on?: readonly string[]
    debounceMs?: number
    reconcileIntervalMs?: number
    applyEvents?: DockerLiveApplyFn<DockerImage>
    enabled?: boolean
  } = {},
) {
  return useDockerLiveEntityKind<'image', DockerImage>({
    kind: 'image',
    on: options.on,
    debounceMs: options.debounceMs,
    reconcileIntervalMs: options.reconcileIntervalMs,
    applyEvents: options.applyEvents,
    enabled: options.enabled,
  })
}

export function useDockerLiveNetworks(
  options: {
    on?: readonly string[]
    debounceMs?: number
    reconcileIntervalMs?: number
    applyEvents?: DockerLiveApplyFn<DockerNetwork>
    enabled?: boolean
  } = {},
) {
  return useDockerLiveEntityKind<'network', DockerNetwork>({
    kind: 'network',
    on: options.on,
    debounceMs: options.debounceMs,
    reconcileIntervalMs: options.reconcileIntervalMs,
    applyEvents: options.applyEvents,
    enabled: options.enabled,
  })
}

export function useDockerLiveVolumes(
  options: {
    on?: readonly string[]
    debounceMs?: number
    reconcileIntervalMs?: number
    applyEvents?: DockerLiveApplyFn<DockerVolume>
    enabled?: boolean
  } = {},
) {
  return useDockerLiveEntityKind<'volume', DockerVolume>({
    kind: 'volume',
    on: options.on,
    debounceMs: options.debounceMs,
    reconcileIntervalMs: options.reconcileIntervalMs,
    applyEvents: options.applyEvents,
    enabled: options.enabled,
  })
}

// ============================================================================
// "Just refetch on event" hook (for legacy call sites that don't need a
// full in-memory store)
// ============================================================================

/**
 * Run a callback after the entity stream has been quiet for `debounceMs`
 * for any `(kind, actions)` pair in `on`. This is a thin wrapper around
 * the new pipe API and supersedes the legacy `useEventTrigger` /
 * `useContainerLiveUpdate` helpers.
 *
 * Use this only when you genuinely need a side-effecting refetch (e.g. the
 * page has its own per-page data store keyed by query keys). For everything
 * else, prefer `useDockerLiveEntities` / `useDockerLiveEntityKind` which
 * keeps an in-memory store and re-renders reactively.
 *
 * @example
 *   useDockerLiveRefetch({
 *     on: { container: ['create', 'update', 'destroy', 'die'] },
 *     onData: () => containerListQuery.refetch(),
 *   })
 */
export function useDockerLiveRefetch(options: {
  on: DockerLiveOnMap
  onData: () => void
  debounceMs?: number
  enabled?: boolean
}) {
  const { on, onData, debounceMs = 200, enabled = true } = options

  const onDataRef = useRef(onData)
  useEffect(() => {
    onDataRef.current = onData
  }, [onData])

  const filter = useMemo(() => buildEntityStreamFilter(on), [on])

  const streamQuery = useQuery(
    dockerEndpoints.entity.stream.experimental_liveObservableOptions({
      input: { query: isRecord(filter) ? filter : undefined },
      enabled,
    }),
  )

  useEffect(() => {
    if (!enabled || !streamQuery.data) {
      return
    }
    const timeout = setTimeout(() => {
      onDataRef.current()
    }, debounceMs)
    return () => {
      clearTimeout(timeout)
    }
  }, [enabled, streamQuery.data, debounceMs])
}
