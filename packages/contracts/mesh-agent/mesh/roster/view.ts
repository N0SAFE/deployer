import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { agentInfoSchema } from "./exchange";

export const meshViewOutput = z.object({
  /** This agent: its node and where it says it can be reached. */
  self: agentInfoSchema,
  /** Every other agent it knows of. */
  agents: z.array(agentInfoSchema),
});

const meshViewOps = standard.zod(meshViewOutput, "meshView");

/** What this agent knows of the swarm, read-only: the dashboard's picture of the nodes. Teaches the agent nothing. */
export const meshViewContract = meshViewOps
  .list()
  .path("/view")
  .input(z.object({}))
  .output(meshViewOutput)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
