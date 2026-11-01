import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";

/** The record every endpoint speaks: the same wire shape the agent stores. */
export const replicaSchema = z.object({
	service: z.string(),
	replicaId: z.string(),
	address: z.string(),
	leaseToken: z.string(),
	expiresAt: z.number(),
});

export const directoryContract = {
	register: oc
		.meta(openapi({ method: "POST", path: "/directory/replicas", summary: "Announce a replica" }))
		.input(z.object({ service: z.string(), replicaId: z.string(), address: z.string() }))
		.output(replicaSchema),
	unregister: oc
		.meta(openapi({ method: "DELETE", path: "/directory/replicas/{replicaId}", summary: "Remove a replica" }))
		.input(z.object({ replicaId: z.string() }))
		.output(z.object({ removed: z.boolean() })),
	resolve: oc
		.meta(openapi({ method: "GET", path: "/directory/resolve", summary: "Resolve a service" }))
		.input(z.object({ service: z.string() }))
		.errors({ NOT_FOUND: { message: "No live replica", data: z.object({ service: z.string() }) } })
		.output(z.object({ replica: replicaSchema, reason: z.enum(["local", "remote"]) })),
	snapshot: oc
		.meta(openapi({ method: "GET", path: "/directory/replicas", summary: "List live replicas" }))
		.output(z.object({ replicas: z.array(replicaSchema) })),
};

export const relayContract = {
	forward: oc
		.meta(openapi({ method: "POST", path: "/relay/forward", summary: "Forward a call to a replica" }))
		.input(z.object({ replicaId: z.string() }))
		.output(z.object({ accepted: z.boolean() })),
};
