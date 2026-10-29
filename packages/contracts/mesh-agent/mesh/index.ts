import { meshDirectoryContract } from "./directory";
import { meshRelayContract } from "./relay";

/** Every mesh-agent procedure. Internal: never composed into the public BFF router. */
export const meshAgentContract = {
  directory: meshDirectoryContract,
  relay: meshRelayContract,
};

export type MeshAgentContract = typeof meshAgentContract;

export * from "./directory";
export * from "./errors";
export * from "./relay";
