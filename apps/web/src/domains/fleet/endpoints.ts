import { orpc } from "@/lib/orpc";

export const fleetEndpoints = {
  listServers: orpc.core.fleet.listServers,
  setServerCapacity: orpc.core.fleet.setServerCapacity,
  listAllocations: orpc.core.fleet.listAllocations,
  listMyAllocations: orpc.core.fleet.listMyAllocations,
  checkMyAdmission: orpc.core.fleet.checkMyAdmission,
  createMyAdmissionRequest: orpc.core.fleet.createMyAdmissionRequest,
  listMyAdmissionRequests: orpc.core.fleet.listMyAdmissionRequests,
  listAdmissionRequests: orpc.core.fleet.listAdmissionRequests,
  resolveAdmissionRequest: orpc.core.fleet.resolveAdmissionRequest,
  upsertAllocation: orpc.core.fleet.upsertAllocation,
  deleteAllocation: orpc.core.fleet.deleteAllocation,
} as const;

export type FleetEndpoints = typeof fleetEndpoints;
