import z from "zod/v4";

import { baseSupervisorPayloadSchema, baseSupervisorProcessInfoSchema, swarmProcessInfoSchema } from "@deployer/supervision";

export const NODE_AGENT_SWARM_SUPERVISOR_ID = "node-agent-swarm";

/** What the supervisor reports: the runtime in force, this node's task, and the service it belongs to. */
export const nodeAgentSwarmSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	runtime: z.literal("swarm-global"),
	/** State of THIS node's task (`new`, `running`, `failed`, …), null when the node has none. */
	taskState: z.string().nullable(),
	service: z
		.object({
			id: z.string(),
			name: z.string(),
			runningTasks: z.number().int().min(0),
			exists: z.boolean(),
		})
		.nullable(),
});
export type NodeAgentSwarmSupervisorPayload = z.output<typeof nodeAgentSwarmSupervisorPayloadSchema>;

export const nodeAgentSwarmProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
});
export type NodeAgentSwarmProcessInfo = z.output<typeof nodeAgentSwarmProcessInfoSchema>;
