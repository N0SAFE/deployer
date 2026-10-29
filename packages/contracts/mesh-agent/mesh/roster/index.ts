import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import { meshRosterExchangeContract } from "./exchange";
import { meshJoinContract } from "./join";
import { meshTokenContract } from "./token";

/** The gossip between agents. Internal to the mesh. */
export const meshRosterContract = oc.meta(openapi({ tags: ["Mesh roster"], prefix: "/mesh/roster" })).router({
  exchange: meshRosterExchangeContract,
  join: meshJoinContract,
  token: meshTokenContract,
});

export type MeshRosterContract = typeof meshRosterContract;

export * from "./exchange";
export * from "./join";
export * from "./token";
