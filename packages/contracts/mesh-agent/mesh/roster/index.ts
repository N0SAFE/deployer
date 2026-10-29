import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import { meshCheckContract } from "./check";
import { meshRosterExchangeContract } from "./exchange";
import { meshJoinContract } from "./join";
import { meshTokenContract } from "./token";
import { meshViewContract } from "./view";

/** The gossip between agents. Internal to the mesh. */
export const meshRosterContract = oc.meta(openapi({ tags: ["Mesh roster"], prefix: "/mesh/roster" })).router({
  check: meshCheckContract,
  exchange: meshRosterExchangeContract,
  join: meshJoinContract,
  token: meshTokenContract,
  view: meshViewContract,
});

export type MeshRosterContract = typeof meshRosterContract;

export * from "./check";
export * from "./exchange";
export * from "./join";
export * from "./token";
export * from "./view";
