import { defineInvalidations } from "@/domains/shared/helpers";
import { fleetEndpoints } from "./endpoints";

export const fleetInvalidations = defineInvalidations(fleetEndpoints, {
  setServerCapacity: ({ keys }) => [
    keys.listServers({ input: {} }),
  ],
  createMyAdmissionRequest: ({ keys }) => [
    keys.listMyAdmissionRequests({ input: { query: {} } }),
    keys.listAdmissionRequests({ input: { query: {} } }),
  ],
  resolveAdmissionRequest: ({ keys }) => [
    keys.listMyAdmissionRequests({ input: { query: {} } }),
    keys.listAdmissionRequests({ input: { query: {} } }),
  ],
  upsertAllocation: ({ keys }) => [
    keys.listServers({ input: {} }),
    keys.listAllocations({ input: { query: {} } }),
    keys.listMyAllocations({ input: {} }),
  ],
  deleteAllocation: ({ keys }) => [
    keys.listServers({ input: {} }),
    keys.listAllocations({ input: { query: {} } }),
    keys.listMyAllocations({ input: {} }),
  ],
});
