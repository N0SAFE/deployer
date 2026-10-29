import z from "zod/v4";

/** A replica as the directory reports it. Mirrors the agent's record; gossiped between agents. */
export const replicaSchema = z.object({
  service: z.string(),
  replicaId: z.string(),
  nodeId: z.string(),
  /** Where the replica's RPC endpoint answers on the overlay network. */
  address: z.string(),
  /** 0 (idle) to 1 (saturated). */
  load: z.number().min(0).max(1),
  /** The resources the replica currently holds in memory (a deployment, a terminal session, a stream). */
  keys: z.array(z.string()),
  generation: z.number().int().nonnegative(),
  /** Epoch ms after which the record is dead. */
  expiresAt: z.number(),
});

export const resolveReasonSchema = z.enum(["key-holder", "local-node", "affinity", "least-loaded"]);
