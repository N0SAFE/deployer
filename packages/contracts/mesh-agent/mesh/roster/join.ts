import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { agentInfoSchema } from "./exchange";

/** The agent to learn the mesh from: any reachable agent of the swarm will do, gossip finds the rest. */
export const meshJoinInput = z.object({
  address: z.string().min(1),
});

export const meshJoinOutput = z.object({
  /** Whether the seed taught this agent anything it did not already know. */
  learned: z.boolean(),
  /** Every other agent this one can reach now. */
  agents: z.array(agentInfoSchema),
});

const meshJoinOps = standard.zod(meshJoinOutput, "meshJoin");

/**
 * An agent starts alone and useful: it serves the replicas of its own node from memory. Joining the swarm is a later,
 * separate act, and this is it: point the agent at one agent of the swarm, at any time, and it merges what it holds
 * with what the swarm knows. Nothing needs to be redone, because nothing was persisted.
 */
export const meshJoinContract = meshJoinOps
  .create()
  .path("/join")
  .input((b) => b.body(meshJoinInput))
  .output(meshJoinOutput)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
