import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { agentInfoSchema } from "./exchange";

/** A join token issued by an agent of the swarm: it carries where to find the swarm and the credential that proves membership. */
export const meshJoinInput = z.object({
  token: z.string().min(1),
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
 * separate act, and this is it: redeem a token from an agent of the swarm, at any time. The agent adopts the swarm's
 * credential, remembers the seed so it rejoins by itself after a restart, and merges what it holds with what the swarm
 * knows. Nothing about the node was configured beforehand.
 */
export const meshJoinContract = meshJoinOps
  .create()
  .path("/join")
  .input((b) => b.body(meshJoinInput))
  .output(meshJoinOutput)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
