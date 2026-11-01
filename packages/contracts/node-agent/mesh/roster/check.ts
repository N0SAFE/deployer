import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

export const meshCheckInput = z.object({
  token: z.string().min(1).max(4096),
});

export const meshCheckOutput = z.object({
  /** Whether the token was issued by this agent's swarm and has not expired. */
  valid: z.boolean(),
});

const meshCheckOps = standard.zod(meshCheckOutput, "meshCheck");

/**
 * Whether a join token is one of this swarm's and still good. A service that must know a caller holds a token (the
 * fleet, when a joining node asks to be enrolled) asks its own agent, because only the agent holds the swarm's
 * credential. The answer never carries the credential.
 */
export const meshCheckContract = meshCheckOps
  .create()
  .path("/check")
  .input((b) => b.body(meshCheckInput))
  .output(meshCheckOutput)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
