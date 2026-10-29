import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import { meshRosterExchangeContract } from "./exchange";
import { meshJoinContract } from "./join";

/** The gossip between agents. Internal to the mesh. */
export const meshRosterContract = oc.meta(openapi({ tags: ["Mesh roster"], prefix: "/mesh/roster" })).router({
  exchange: meshRosterExchangeContract,
  join: meshJoinContract,
});

export type MeshRosterContract = typeof meshRosterContract;

export * from "./exchange";
export * from "./join";
