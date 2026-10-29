import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import { meshRelayCallContract } from "./call";

/** Every call between services goes through here: the caller's local agent brokers it, or answers with a direct grant. */
export const meshRelayContract = oc.meta(openapi({ tags: ["Mesh relay"], prefix: "/mesh/relay" })).router({
  call: meshRelayCallContract,
});

export type MeshRelayContract = typeof meshRelayContract;

export * from "./call";
