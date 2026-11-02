import z from "zod/v4";

import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { replicaSchema, resolveReasonSchema } from "./replica";

/**
 * Which replica should this call go to: the one holding `key`, else one on the agent's own node, else the key's
 * rendezvous replica, else the least loaded. `exclude` lists replicas the caller already tried.
 */
export const meshResolveInput = z.object({
  service: z.string().min(1),
  key: z.string().optional(),
  exclude: z.array(z.string()).optional(),
});

export const meshResolveOutput = z.object({
  replica: replicaSchema,
  reason: resolveReasonSchema,
});

const meshResolveOps = standard.zod(meshResolveOutput, "meshResolve");

export const meshResolveContract = meshResolveOps
  .create()
  .path("/resolve")
  .input((b) => b.body(meshResolveInput))
  .output(meshResolveOutput)
  .errors((e) => [
    // 404 when no live replica of the service is known.
    ...standardDomainErrorContracts(e),
  ])
  .build();
