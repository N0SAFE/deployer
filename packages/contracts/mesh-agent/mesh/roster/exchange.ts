import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { replicaSchema } from "../directory/replica";

/** An agent as the others reach it: its node, and where its websocket answers on the overlay network. */
export const agentInfoSchema = z.object({
  nodeId: z.string().min(1),
  address: z.string().min(1),
});

/**
 * What an agent knows, sent to a peer and answered with the peer's own: the replicas it has, and the agents it can
 * reach. Gossip is symmetric, so one exchange teaches both sides, and an agent that only knows one seed learns the
 * rest of the mesh from it.
 */
export const meshRosterView = z.object({
  from: agentInfoSchema,
  replicas: z.array(replicaSchema),
  agents: z.array(agentInfoSchema),
});

export type AgentInfo = z.infer<typeof agentInfoSchema>;
export type MeshRosterView = z.infer<typeof meshRosterView>;

const meshRosterOps = standard.zod(agentInfoSchema, "meshRoster");

export const meshRosterExchangeContract = meshRosterOps
  .create()
  .path("/exchange")
  .input((b) => b.body(meshRosterView))
  .output(meshRosterView)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
