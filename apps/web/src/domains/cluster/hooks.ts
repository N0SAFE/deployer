"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { clusterEndpoints } from "./endpoints";
import { clusterInvalidations } from "./invalidations";
import { wrapWithInvalidations } from "@/domains/shared/helpers";

const enhancedCluster = wrapWithInvalidations(clusterEndpoints, clusterInvalidations);

/**
 * Cluster hooks — query the Swarm cluster state (snapshot, fleet
 * inventory, elected master) and drive node role/ingress updates.
 */
export function useClusterSnapshot(options?: { enabled?: boolean }) {
  return useQuery(
    enhancedCluster.getSnapshot.queryOptions({
      input: {},
      enabled: options?.enabled ?? true,
      refetchInterval: 30_000,
    }),
  );
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