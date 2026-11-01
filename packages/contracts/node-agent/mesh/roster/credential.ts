import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

/**
 * The credential an agent is on right now, so a node that missed a rotation converges during the grace window: gossip
 * carries only the epoch, and an agent whose epoch is behind fetches this.
 *
 * It is the swarm's shared secret, answered only on the peer door behind that same secret — a peer that cannot open a
 * connection cannot ask.
 */
export const meshCredentialInput = z.object({});

export const meshCredentialOutput = z.object({
  secret: z.string().min(1),
  /** Epoch ms until which the previous secret is still accepted. */
  validUntil: z.number(),
  /** When this secret was installed. */
  epoch: z.number(),
});

const meshCredentialOps = standard.zod(meshCredentialOutput, "meshCredential");

export const meshCredentialContract = meshCredentialOps
  .create()
  .path("/credential")
  .input((b) => b.body(meshCredentialInput))
  .output(meshCredentialOutput)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
