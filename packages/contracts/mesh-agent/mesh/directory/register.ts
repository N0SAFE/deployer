import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { replicaSchema } from "./replica";

/**
 * A replica announces itself, or refreshes its lease. The agent stamps `nodeId`, the generation and the expiry, so a
 * replica cannot claim another node or outlive its own heartbeat.
 */
export const meshRegisterInput = z.object({
  service: z.string().min(1),
  replicaId: z.string().min(1),
  address: z.string().min(1),
  load: z.number().min(0).max(1).default(0),
  keys: z.array(z.string()).default([]),
  /** How long the registration lives without a refresh. */
  ttlMs: z.number().int().positive().max(300_000).default(15_000),
});

export const meshRegisterOutput = replicaSchema;

const meshRegisterOps = standard.zod(meshRegisterOutput, "meshRegister");

export const meshRegisterContract = meshRegisterOps
  .create()
  .path("/register")
  .input((b) => b.body(meshRegisterInput))
  .output(meshRegisterOutput)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
