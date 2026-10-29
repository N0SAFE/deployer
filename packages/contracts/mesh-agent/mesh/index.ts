import { meshAccessContract } from "./access";
import { meshDirectoryContract } from "./directory";
import { meshRelayContract } from "./relay";
import { meshRosterContract } from "./roster";

/** Every mesh-agent procedure. Internal: never composed into the public BFF router. */
export const meshAgentContract = {
  access: meshAccessContract,
  directory: meshDirectoryContract,
  relay: meshRelayContract,
  roster: meshRosterContract,
};

export type MeshAgentContract = typeof meshAgentContract;

export * from "./access";
export * from "./directory";
export * from "./errors";
export * from "./transport";
export * from "./relay";
export * from "./roster";
