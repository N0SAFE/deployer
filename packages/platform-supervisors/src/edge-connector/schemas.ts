import z from "zod/v4";

import { baseSupervisorPayloadSchema, baseSupervisorProcessInfoSchema, swarmProcessInfoSchema } from "@deployer/supervision";

export const EDGE_CONNECTOR_SUPERVISOR_ID = "platform-edge-connector";
export const EDGE_CONNECTOR_BASE_NAME = "deployer-edge-connector";

/** `managed` = nothing of ours to run (no tunnel edge); `swarm-replicated` = a connector runs. */
export const edgeConnectorRuntimeSchema = z.enum(["managed", "swarm-replicated"]);
export type EdgeConnectorRuntime = z.output<typeof edgeConnectorRuntimeSchema>;

export const edgeConnectorSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	runtime: edgeConnectorRuntimeSchema,
	/** The edge provider whose connector runs, when one does. */
	provider: z.string().nullable(),
	service: z
		.object({
			id: z.string(),
			name: z.string(),
			runningTasks: z.number().int().min(0).nullable(),
			exists: z.boolean(),
		})
		.nullable(),
	replicas: z.number().int().min(0),
	/** Where the connector forwards: Traefik's `public` entrypoint. */
	routeTarget: z.string(),
});
export type EdgeConnectorSupervisorPayload = z.output<typeof edgeConnectorSupervisorPayloadSchema>;

export const edgeConnectorProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
});
export type EdgeConnectorProcessInfo = z.output<typeof edgeConnectorProcessInfoSchema>;
