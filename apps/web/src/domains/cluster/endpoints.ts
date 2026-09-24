import { orpc } from "@/lib/orpc";

/**
 * Cluster (Swarm) endpoints — the Swarm-cluster surface of the platform.
 * Snapshot state, fleet inventory, controlling-master view, node label
 * (role/ingress) updates, and the live fleet workload surface
 * (services/tasks/node resources). SDK-driven on the API side.
 */
export const clusterEndpoints = {
  getSnapshot: orpc.cluster.getSnapshot,
  streamSnapshot: orpc.cluster.streamSnapshot,
  listNodes: orpc.cluster.listNodes,
  streamNodes: orpc.cluster.streamNodes,
  getMaster: orpc.cluster.getMaster,
  streamMaster: orpc.cluster.streamMaster,
  updateNode: orpc.cluster.updateNode,
  services: {
    list: orpc.cluster.listServices,
    stream: orpc.cluster.streamServices,
  },
  tasks: {
    list: orpc.cluster.listTasks,
    stream: orpc.cluster.streamTasks,
  },
  nodeResources: {
    get: orpc.cluster.getNodeResources,
    stream: orpc.cluster.streamNodeResources,
  },
  swarmConfig: {
    get: orpc.cluster.getSwarmConfig,
    set: orpc.cluster.setSwarmConfig,
  },
} as const;

export type ClusterEndpoints = typeof clusterEndpoints;