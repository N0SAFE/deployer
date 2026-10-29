import { meshDirectoryContract } from "./directory";

/** Every mesh-agent procedure. Internal: never composed into the public BFF router. */
export const meshAgentContract = {
  directory: meshDirectoryContract,
};

export type MeshAgentContract = typeof meshAgentContract;

export * from "./directory";
