'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { reachabilityEndpoints, reachabilityEndpointOperations } from './endpoints'
import { wrapWithInvalidations } from '../shared/helpers'
import { reachabilityInvalidations } from './invalidations'

const enhancedReachability = wrapWithInvalidations(reachabilityEndpointOperations, reachabilityInvalidations as never)

export function useReachabilityCheck() {
  return useMutation(reachabilityEndpoints.check.mutationOptions())
}

export function useReachabilityConfig() {
  return useQuery(
    reachabilityEndpoints.getConfig.queryOptions({ input: {} }),
  )
}

export function useUpdateReachabilityConfig() {
  return useMutation(reachabilityEndpoints.updateConfig.mutationOptions())
}

export function useDomainReachabilityCheck() {
  return useMutation(reachabilityEndpoints.checkDomain.mutationOptions())
}

export function useGetPublicIp() {
  return useQuery(
    reachabilityEndpoints.getPublicIp.queryOptions({ input: {} }),
  )
}

export function useNodeNetworkConfig(nodeId?: string) {
  return useQuery(
    reachabilityEndpoints.getNodeNetworkConfig.queryOptions({
      input: { nodeId: nodeId ?? undefined },
    }),
  )
}

/** Every node's network config (per-node selector + tunnel binding tags). */
export function useListNodeNetworkConfigs() {
  return useQuery(
    reachabilityEndpoints.listNodeNetworkConfigs.queryOptions({ input: {} }),
  )
}

export function useUpdateNodeNetworkConfig() {
  return useMutation(
    reachabilityEndpoints.updateNodeNetworkConfig.mutationOptions({
      onSuccess: enhancedReachability.updateNodeNetworkConfig.withInvalidationOnSuccess(),
    }),
  )
}

export function useCheckDomainGate() {
  return useQuery(
    reachabilityEndpoints.checkDomainGate.queryOptions({ input: {} }),
  )
}

/**
 * First-class public access point: request ⇒ server re-checks availability,
 * emits onto the global event relay, returns the fresh discriminated-union state.
 */
export function usePublicAccessPoint() {
  return useQuery(
    reachabilityEndpoints.getPublicAccessPoint.queryOptions({ input: {} }),
  )
}

/** Watch the global public-access-point event relay (live updates). */
export function useWatchPublicAccessPoint() {
  return useQuery(
    reachabilityEndpoints.watchPublicAccessPoint.experimental_liveObservableOptions({
      input: {},
    }),
  )
}

/** Discriminated-union state of the node's public access point. */
export interface PublicAccessPointState {
  configured: boolean
  kind: 'ip' | 'hostname' | 'tunnel' | null
  address: string | null
  publicUrl: string | null
  providerId: string | null
  tunnelEnabled: boolean
  reachable: boolean | null
  lastCheckedAt: string | null
  latencyMs: number | null
  statusCode: number | null
  error: string | null
}

function toAccessPointState(raw: unknown): PublicAccessPointState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<PublicAccessPointState>
  if (typeof r.configured !== 'boolean') return null
  return {
    configured: r.configured,
    kind: r.kind ?? null,
    address: r.address ?? null,
    publicUrl: r.publicUrl ?? null,
    providerId: r.providerId ?? null,
    tunnelEnabled: r.tunnelEnabled ?? false,
    reachable: r.reachable ?? null,
    lastCheckedAt: r.lastCheckedAt ?? null,
    latencyMs: r.latencyMs ?? null,
    statusCode: r.statusCode ?? null,
    error: r.error ?? null,
  }
}

/**
 * LIVE-FIRST public access point hook. Opens the SSE watch stream so the LAST
 * data is always on screen (every server emission re-renders the consumer),
 * and falls back to the one-shot GET (which triggers a fresh server re-check +
 * global relay emit) when the stream has not produced a value yet.
 */
export function usePublicAccessPointLive() {
  // 1. Continuous SSE stream — source of truth for "always the latest".
  const stream = useWatchPublicAccessPoint()
  const streamState = toAccessPointState(stream.data)

  // 2. One-shot GET (request ⇒ server re-checks + emits onto the relay).
  const snapshot = usePublicAccessPoint()

  const state = streamState ?? toAccessPointState(snapshot.data) ?? null

  return {
    state,
    stream,
    snapshot,
    isLoading: (stream.isLoading || snapshot.isLoading) && !state,
  }
}
