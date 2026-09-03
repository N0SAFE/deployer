import { defineInvalidations } from "@/domains/shared/helpers";
import { fleetEndpoints } from "./endpoints";

export const fleetInvalidations = defineInvalidations(fleetEndpoints, {
  setServerCapacity: ({ keys }) => [
    keys.listServers({ input: undefined }),
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
    keys.listServers({ input: undefined }),
    keys.listAllocations({ input: { query: {} } }),
    keys.listMyAllocations({ input: undefined }),
  ],
  deleteAllocation: ({ keys }) => [
    keys.listServers({ input: undefined }),
    keys.listAllocations({ input: { query: {} } }),
    keys.listMyAllocations({ input: undefined }),
  ],
});
