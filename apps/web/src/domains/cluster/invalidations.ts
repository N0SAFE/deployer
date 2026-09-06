import { defineInvalidations } from "@/domains/shared/helpers";
import { clusterEndpoints } from "./endpoints";

export const clusterInvalidations = defineInvalidations(clusterEndpoints, {
  updateNode: ({ keys }) => [
    keys.listNodes({ input: { includeDown: false } }),
    keys.listNodes({ input: { includeDown: true } }),
    keys.getMaster({ input: {} }),
  ],
});