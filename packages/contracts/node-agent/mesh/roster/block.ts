import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

/** One node to exclude from this agent's mesh, by its mesh node id. */
export const meshRosterBlockInput = z.object({
  nodeId: z.string().min(1),
});

export const meshRosterBlocklist = z.object({
  /** The nodes this agent excludes, in node id order. */
  blocked: z.array(z.string()),
});

const meshRosterBlockOps = standard.zod(meshRosterBlocklist, "meshRosterBlock");

/**
 * Revokes a NODE, not a join token: its agents are dropped from the roster and nothing it gossips is absorbed. The
 * blocklist is local to this agent and survives a restart, because a revoked node must not come back on reboot.
 */
export const meshRosterBlockContract = meshRosterBlockOps
  .create()
  .path("/block")
  .input((b) => b.body(meshRosterBlockInput))
  .output(meshRosterBlocklist)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();

const meshRosterUnblockOps = standard.zod(meshRosterBlocklist, "meshRosterUnblock");

/** Lifts a block: the node may be learned again, the next time it gossips. */
export const meshRosterUnblockContract = meshRosterUnblockOps
  .create()
  .path("/unblock")
  .input((b) => b.body(meshRosterBlockInput))
  .output(meshRosterBlocklist)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
