"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { clusterEndpoints } from "./endpoints";
import { clusterInvalidations } from "./invalidations";
import { wrapWithInvalidations } from "@/domains/shared/helpers";
import type { ClusterSnapshot, SwarmNodeResources } from "@repo/contracts-entities";

const enhancedCluster = wrapWithInvalidations(clusterEndpoints, clusterInvalidations);

/**
 * Cluster hooks — query the Swarm cluster state (snapshot, fleet
 * inventory, elected master) and drive node role/ingress updates.
 */
export function useClusterSnapshot(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true

  // Initial REST fetch for immediate data
  const queryResult = useQuery(
    enhancedCluster.getSnapshot.queryOptions({
      input: {},
      enabled,
      refetchInterval: false,
    }),
  )

  // SSE stream for real-time updates (30s interval from server)
  const streamResult = useQuery(
    clusterEndpoints.streamSnapshot.experimental_liveObservableOptions({
      input: {},
      enabled,
    }),
  )

  // Use stream data when available, fall back to REST query data
  const streamData = streamResult.data as ClusterSnapshot | undefined
  const data = streamData ?? queryResult.data

  return {
    ...queryResult,
    data,
    isPending: queryResult.isPending && !streamData,
    isError: queryResult.isError && !streamData,
  }
}

export function useClusterNodes(
  input?: { includeDown?: boolean },
  options?: { enabled?: boolean },
) {
  return useQuery(
    enhancedCluster.listNodes.queryOptions({
      input: { includeDown: input?.includeDown ?? false },
      enabled: options?.enabled ?? true,
      refetchInterval: 30_000,
    }),
  );
}

export function useClusterMaster(options?: { enabled?: boolean }) {
  return useQuery(
    enhancedCluster.getMaster.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      refetchInterval: 15_000,
    }),
  );
}

export function useUpdateClusterNode() {
  return useMutation(
    enhancedCluster.updateNode.mutationOptions({
      onSuccess: enhancedCluster.updateNode.withInvalidationOnSuccess(),
    }),
  );
}

// ─── Fleet workload surface ────────────────────────────────────────────────

/** Mesh-wide swarm services (mode + desired/running task counts). */
export function useClusterServices(options?: { enabled?: boolean }) {
  return useQuery(
    enhancedCluster.services.list.queryOptions({
      enabled: options?.enabled ?? true,
      refetchInterval: 15_000,
    }),
  );
}

/** Swarm tasks, optionally filtered by service and/or node. */
export function useClusterTasks(
  input?: { serviceId?: string; nodeId?: string },
  options?: { enabled?: boolean },
) {
  return useQuery(
    enhancedCluster.tasks.list.queryOptions({
      input: {
        query: {
          serviceId: input?.serviceId,
          nodeId: input?.nodeId,
        },
      },
      enabled: options?.enabled ?? true,
      refetchInterval: 10_000,
    }),
  );
}

/** Per-node resource aggregation (swarm view + local engine artifacts). */
export function useNodeResources(nodeId: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true

  const queryResult = useQuery(
    enhancedCluster.nodeResources.get.queryOptions({
      input: { query: { nodeId } },
      enabled,
      refetchInterval: false,
    }),
  )

  const streamResult = useQuery(
    clusterEndpoints.nodeResources.stream.experimental_liveObservableOptions({
      input: { query: { nodeId } },
      enabled,
    }),
  )

  const streamData = streamResult.data as SwarmNodeResources | undefined
  const data = streamData ?? queryResult.data

  return {
    ...queryResult,
    data,
    isPending: queryResult.isPending && !streamData,
    isError: queryResult.isError && !streamData,
  }
}