/**
 * The agent's two HTTP surfaces, as plain `Request → Response` handlers.
 *
 *   control  unix socket, same node only — every operation
 *   gossip   the MESH address only — roster exchange and a read-only status
 *
 * Handlers are pure functions of the agent, so they are tested without a server;
 * `main.ts` only binds them to sockets.
 */

import {
	admitRequestSchema,
	AGENT_ROUTES,
	createClusterRequestSchema,
	gossipMessageSchema,
	joinClusterRequestSchema,
	joinRequestRequestSchema,
	labelsWriteSchema,
	revokeRequestSchema,
	settingWriteSchema,
} from "@deployer/mesh-network";
import z from "zod/v4";

import { AgentError, type MeshAgent } from "./agent";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorResponse(error: unknown): Response {
	if (error instanceof AgentError) return json({ code: error.code, message: error.message }, error.status);
	if (error instanceof z.ZodError) return json({ code: "invalid-request", message: z.prettifyError(error) }, 400);
	if (error instanceof SyntaxError) return json({ code: "invalid-request", message: "body is not valid JSON" }, 400);
	return json({ code: "internal", message: error instanceof Error ? error.message : String(error) }, 500);
}

async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
	return schema.parse(await request.json());
}

type Handler = (request: Request) => Promise<Response>;

function router(routes: Record<string, Partial<Record<string, Handler>>>): Handler {
	return async (request) => {
		const { pathname } = new URL(request.url);
		const methods = routes[pathname];
		if (methods === undefined) return json({ code: "not-found", message: `no route ${pathname}` }, 404);
		const handler = methods[request.method];
		if (handler === undefined) return json({ code: "method-not-allowed", message: `${request.method} ${pathname}` }, 405);
		try {
			return await handler(request);
		} catch (error) {
			return errorResponse(error);
		}
	};
}

/** Every operation — mounted on the unix socket only. */
export function createControlHandler(agent: MeshAgent): Handler {
	return router({
		[AGENT_ROUTES.status]: { GET: () => Promise.resolve(json(agent.status())) },
		[AGENT_ROUTES.cluster]: { POST: async (r) => json(await agent.ensureCluster(await body(r, createClusterRequestSchema))) },
		[AGENT_ROUTES.joinRequest]: { POST: async (r) => json(await agent.createJoinRequest(await body(r, joinRequestRequestSchema))) },
		[AGENT_ROUTES.admissions]: { POST: async (r) => json(await agent.admit((await body(r, admitRequestSchema)).request)) },
		[AGENT_ROUTES.join]: { POST: async (r) => json(await agent.join((await body(r, joinClusterRequestSchema)).roster)) },
		[AGENT_ROUTES.settings]: {
			GET: () => Promise.resolve(json(agent.readSettings())),
			PUT: async (r) => {
				const { key, value } = await body(r, settingWriteSchema);
				await agent.writeSetting(key, value);
				return json({ key });
			},
		},
		[AGENT_ROUTES.labels]: {
			PUT: async (r) => {
				await agent.setLabels((await body(r, labelsWriteSchema)).labels);
				return json(agent.status());
			},
		},
		[AGENT_ROUTES.revocations]: {
			POST: async (r) => {
				const { memberId, reason } = await body(r, revokeRequestSchema);
				await agent.revoke(memberId, reason);
				return json(agent.status());
			},
		},
		[AGENT_ROUTES.leave]: {
			POST: async () => {
				await agent.leave();
				return json(agent.status());
			},
		},
		[AGENT_ROUTES.gossip]: { POST: async (r) => json({ roster: await agent.receiveGossip((await body(r, gossipMessageSchema)).roster) }) },
	});
}

/**
 * Gossip and read-only status — mounted on the mesh address.
 *
 * Nothing here can admit, revoke or write a setting on this member's behalf:
 * gossip only merges records their authors already signed.
 */
export function createGossipHandler(agent: MeshAgent): Handler {
	return router({
		[AGENT_ROUTES.status]: { GET: () => Promise.resolve(json(agent.status())) },
		[AGENT_ROUTES.gossip]: { POST: async (r) => json({ roster: await agent.receiveGossip((await body(r, gossipMessageSchema)).roster) }) },
	});
}
