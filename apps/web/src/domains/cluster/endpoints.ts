import { orpc } from "@/lib/orpc";

/**
 * Cluster (Swarm) endpoints — the Swarm-cluster surface of the platform.
 * Snapshot state, fleet inventory, controlling-master view, and
 * node label (role/ingress) updates. SDK-driven on the API side.
 */
export const clusterEndpoints = {
  getSnapshot: orpc.cluster.getSnapshot,
  listNodes: orpc.cluster.listNodes,
  getMaster: orpc.cluster.getMaster,
  updateNode: orpc.cluster.updateNode,
} as const;

export type ClusterEndpoints = typeof clusterEndpoints;