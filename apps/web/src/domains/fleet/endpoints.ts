import { orpc } from "@/lib/orpc";

/**
 * Nodes (fleet) endpoints — the node-scoped surface of the platform.
 * Projects and services are mesh-wide; these operations are per node:
 * servers (cluster nodes), per-node allocations, capacity and admission.
 */
export const fleetEndpoints = {
  listServers: orpc.nodes.listServers,
  setServerCapacity: orpc.nodes.setServerCapacity,
  listAllocations: orpc.nodes.listAllocations,
  listMyAllocations: orpc.nodes.listMyAllocations,
  checkMyAdmission: orpc.nodes.checkMyAdmission,
  createMyAdmissionRequest: orpc.nodes.createMyAdmissionRequest,
  listMyAdmissionRequests: orpc.nodes.listMyAdmissionRequests,
  listAdmissionRequests: orpc.nodes.listAdmissionRequests,
  resolveAdmissionRequest: orpc.nodes.resolveAdmissionRequest,
  upsertAllocation: orpc.nodes.upsertAllocation,
  deleteAllocation: orpc.nodes.deleteAllocation,
} as const;

export type FleetEndpoints = typeof fleetEndpoints;
