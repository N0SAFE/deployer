'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dockerEndpoints } from './endpoints'
import { orpcClient } from '@/lib/orpc'
import type {
} from "@deployer/contracts-entities";
import { isRecord } from "@deployer/type-guards";
import type {
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
  DockerEntityKind,
  DockerEntityStreamChunk,
  DockerEntityRemovedEvent,
} from '@deployer/contracts-entities'

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
export interface DockerLiveOnMap {
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

export interface DockerLiveEntitiesOptions {
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

export interface DockerLiveEntitiesResult<TKind extends DockerEntityKind, TEntity> {
  kind: TKind
  data: TEntity[]
  byId: Map<string, TEntity>
  lastSyncedAt: Date | null
  status: DockerLiveEntityStatus
  /** Why the last sync failed (null while healthy). */
  error: Error | null
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

interface KindConfig<TEntity> {
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
      return chunkToEntity<DockerContainer>(chunk)
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
      return chunkToEntity<DockerImage>(chunk)
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
      return chunkToEntity<DockerNetwork>(chunk)
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
      return chunkToEntity<DockerVolume>(chunk)
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
  for (const [scope, scopeActions] of Object.entries(on) as [DockerEntityKind, readonly string[] | undefined][]) {
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

const REMOVAL_ACTIONS = new Set(['destroy', 'delete'])

/** An id-only chunk (`DockerEntityRemovedEvent`): carries no entity fields. */
function isIdOnlyChunk(chunk: DockerEntityStreamChunk): chunk is DockerEntityRemovedEvent {
  return (
    'id' in chunk &&
    typeof (chunk as { id?: unknown }).id === 'string' &&
    !('name' in chunk) &&
    !('createdAt' in chunk) &&
    !('updatedAt' in chunk)
  )
}

/**
 * A `die` is not a removal: it fires on every stop/restart and the entity still
 * exists. The stream sends it id-only, so the entity must be re-read instead of
 * being dropped from the list until the next reconcile.
 */
function isRefreshEvent(chunk: DockerEntityStreamChunk): boolean {
  return isIdOnlyChunk(chunk) && (chunk as { action?: string }).action === 'die'
}

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
  kind: DockerEntityKind,
): TEntity[] {
  const byIdIndex = new Map<string, TEntity>()
  for (const item of state) {
    const id = config.getId(item)
    if (id) byIdIndex.set(id, item)
  }

  for (const chunk of events) {
    // The stream can be shared between kinds (no `kinds` filter): a chunk of
    // another kind must never land in this kind's list.
    if (chunk.kind !== kind) continue
    if (isRefreshEvent(chunk)) continue
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
    ? ({ [kind]: actionsForKind })
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

  const containerResult = useDockerLiveEntitiesInner<'container', DockerContainer>({
    kind: 'container',
    on: { container: on.on.container },
    config: containerConfig,
    debounceMs: on.debounceMs,
    reconcileIntervalMs: on.reconcileIntervalMs,
    customReducer: on.applyEvents as DockerLiveApplyFn<DockerContainer> | undefined,
    // Hooks cannot be conditional: a kind the caller did not ask for runs
    // disabled (idle, no stream, no reconcile) and is dropped from the result.
    enabled: (on.enabled ?? true) && on.on.container !== undefined,
  })
  const container = on.on.container ? containerResult : undefined

  const imageResult = useDockerLiveEntitiesInner<'image', DockerImage>({
    kind: 'image',
    on: { image: on.on.image },
    config: imageConfig,
    debounceMs: on.debounceMs,
    reconcileIntervalMs: on.reconcileIntervalMs,
    customReducer: on.applyEvents as DockerLiveApplyFn<DockerImage> | undefined,
    // Hooks cannot be conditional: a kind the caller did not ask for runs
    // disabled (idle, no stream, no reconcile) and is dropped from the result.
    enabled: (on.enabled ?? true) && on.on.image !== undefined,
  })
  const image = on.on.image ? imageResult : undefined

  const networkResult = useDockerLiveEntitiesInner<'network', DockerNetwork>({
    kind: 'network',
    on: { network: on.on.network },
    config: networkConfig,
    debounceMs: on.debounceMs,
    reconcileIntervalMs: on.reconcileIntervalMs,
    customReducer: on.applyEvents as DockerLiveApplyFn<DockerNetwork> | undefined,
    // Hooks cannot be conditional: a kind the caller did not ask for runs
    // disabled (idle, no stream, no reconcile) and is dropped from the result.
    enabled: (on.enabled ?? true) && on.on.network !== undefined,
  })
  const network = on.on.network ? networkResult : undefined

  const volumeResult = useDockerLiveEntitiesInner<'volume', DockerVolume>({
    kind: 'volume',
    on: { volume: on.on.volume },
    config: volumeConfig,
    debounceMs: on.debounceMs,
    reconcileIntervalMs: on.reconcileIntervalMs,
    customReducer: on.applyEvents as DockerLiveApplyFn<DockerVolume> | undefined,
    // Hooks cannot be conditional: a kind the caller did not ask for runs
    // disabled (idle, no stream, no reconcile) and is dropped from the result.
    enabled: (on.enabled ?? true) && on.on.volume !== undefined,
  })
  const volume = on.on.volume ? volumeResult : undefined

  return {
    ...(container
      ? { container: container }
      : {}),
    ...(image ? { image: image } : {}),
    ...(network
      ? { network: network }
      : {}),
    ...(volume
      ? { volume: volume }
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
  const [reconcileStatus, setReconcileStatus] = useState<DockerLiveEntityStatus | null>(enabled ? 'reconciling' : null)
  const [error, setError] = useState<Error | null>(null)

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
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [])

  const flushBuffer = useCallback(() => {
    const events = eventBufferRef.current
    eventBufferRef.current = []
    if (events.length === 0) {
      return
    }

    const reducer = customReducerRef.current
    const currentData = dataRef.current

    // `die` arrives id-only: re-read those entities and patch the result in.
    const refreshIds = new Set<string>()
    for (const chunk of reducer ? [] : events) {
      if (chunk.kind === kind && isRefreshEvent(chunk)) refreshIds.add((chunk as DockerEntityRemovedEvent).id)
    }
    for (const id of refreshIds) {
      void config.fetchOne(id).then((fresh) => {
        if (!mountedRef.current) return
        const next = fresh
          ? applyDefaultEvent(dataRef.current, [{ ...(fresh as object), kind } as unknown as DockerEntityStreamChunk], config, kind)
          : dataRef.current.filter((item) => config.getId(item) !== id)
        setData(next)
        dataRef.current = next
      }).catch(() => undefined) // the periodic reconcile heals a failed re-read
    }

    if (reducer) {
      const next = reducer(currentData, events)
      setData(next)
      dataRef.current = next
      return
    }

    // Default reducer path: every chunk is a `DockerEntityEvent` (full
    // payload) or `DockerEntityRemovedEvent` (id-only). The default
    // reducer patches/inserts on the former and removes on the latter.
    const next = applyDefaultEvent(currentData, events, config, kind)
    setData(next)
    dataRef.current = next
  }, [config, kind])

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

    eventBufferRef.current.push(streamQuery.data)
    // Throttle, not debounce: the timer is NOT reset by later events. A debounce
    // never fires while events keep arriving faster than `debounceMs`, so a busy
    // engine froze the list and then applied one giant batch.
    debounceTimerRef.current ??= setTimeout(() => {
      debounceTimerRef.current = null
      flushBuffer()
    }, debounceMs)
  }, [streamQuery.data, debounceMs, flushBuffer, enabled, streamQuery.isError])

  // -------------------------------------------------------------------------
  // Connection status
  // -------------------------------------------------------------------------
  // Status is derived from the stream; a reconcile result overrides it until the
  // stream's own state next changes (tracked while rendering, not in an effect).
  const streamStatus: DockerLiveEntityStatus = !enabled
    ? 'idle'
    : streamQuery.isError
      ? 'error'
      : streamQuery.fetchStatus === 'fetching'
        ? 'connected'
        : streamQuery.isLoading
          ? 'connecting'
          : 'disconnected'
  const streamKey = `${String(enabled)}|${String(streamQuery.isError)}|${streamQuery.fetchStatus}|${String(streamQuery.isLoading)}`
  const [tracked, setTracked] = useState({ key: streamKey, enabled })
  if (tracked.key !== streamKey) {
    setTracked({ key: streamKey, enabled })
    setReconcileStatus(enabled && !tracked.enabled ? 'reconciling' : null)
  }
  const status = reconcileStatus ?? streamStatus

  // -------------------------------------------------------------------------
  // Reconciliation (initial + periodic)
  // -------------------------------------------------------------------------
  // A promise chain (not async/await): the callbacks run after the fetch
  // settles, so state is never set synchronously from the effect that kicks the
  // first reconcile off.
  const runReconcile = useCallback(
    () =>
      config
        .fetchList()
        .then((fresh) => {
          setData(fresh)
          dataRef.current = fresh
          setLastSyncedAt(new Date())
          setError(null)
          setReconcileStatus('connected')
        })
        .catch((caught: unknown) => {
          setError(caught instanceof Error ? caught : new Error('The Docker engine did not answer.'))
          setReconcileStatus('error')
        }),
    [config],
  )

  const reconcile = useCallback(async () => {
    setReconcileStatus('reconciling')
    await runReconcile()
  }, [runReconcile])

  useEffect(() => {
    // The 'reconciling' status for this first run is already set by the state
    // initialiser / render-time tracking above, so it is not set here.
    if (enabled) {
      void runReconcile()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when `enabled` flips, not on every config/reconcile identity change
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
    /** The reason the last reconcile failed (null while healthy). */
    error: error ?? (streamQuery.isError ? streamQuery.error : null),
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
