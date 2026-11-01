import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import { meshVerifyContract } from "./verify";

/** What a service asks its agent about the peers that connect to it. Internal to the mesh. */
export const meshAccessContract = oc.meta(openapi({ tags: ["Mesh access"], prefix: "/mesh/access" })).router({
  verify: meshVerifyContract,
});

export type MeshAccessContract = typeof meshAccessContract;

export * from "./verify";
