/**
 * A typed client for a mesh agent's control socket, with no framework attached.
 *
 * Every process that runs on a node and needs its agent (setup before the API
 * exists, the API after) uses this one client, so the wire format has exactly one
 * reader. The socket's filesystem permission is the authority (see `control.ts`).
 *
 * The only I/O in this package; it is opt-in and takes `fetch` as a parameter so it
 * is tested without a socket.
 */

import z from "zod/v4";

import {
	admitResponseSchema,
	AGENT_ROUTES,
	agentErrorSchema,
	agentStatusSchema,
	settingsReadSchema,
	type AdmitResponse,
	type AgentStatus,
	type CreateClusterRequest,
	type JoinRequestRequest,
} from "./control";
import { rosterStateSchema, signedMemberEntrySchema, type RosterState, type SignedMemberEntry } from "./schemas";

/** The socket is not there or nothing answers on it (agent not started yet). */
export class MeshAgentUnreachableError extends Error {
	constructor(
		readonly socketPath: string,
		cause: string,
	) {
		super(`mesh agent is not reachable at ${socketPath} (${cause})`);
		this.name = "MeshAgentUnreachableError";
	}
}

/** The agent answered and refused; `code` is the agent's own reason. */
export class MeshAgentRefusedError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
		message: string,
	) {
		super(`mesh agent refused the request: ${message}`);
		this.name = "MeshAgentRefusedError";
	}
}

export type JsonValue = z.output<ReturnType<typeof z.json>>;

/** `fetch` with Bun's `unix` option. */
export type UnixFetch = (url: string, init: RequestInit & { unix: string }) => Promise<Response>;

export class MeshAgentHttpClient {
	constructor(
		readonly socketPath: string,
		private readonly fetchImpl: UnixFetch = fetch,
		private readonly timeoutMs = 10_000,
	) {}

	private async request<T extends z.ZodType>(method: string, route: string, schema: T, body?: unknown): Promise<z.output<T>> {
		let response: Response;
		try {
			response = await this.fetchImpl(`http://mesh-agent${route}`, {
				method,
				unix: this.socketPath,
				headers: body === undefined ? undefined : { "content-type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeoutMs),
			});
		} catch (error) {
			throw new MeshAgentUnreachableError(this.socketPath, error instanceof Error ? error.message : String(error));
		}
		const payload: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			const parsed = agentErrorSchema.safeParse(payload);
			throw parsed.success
				? new MeshAgentRefusedError(parsed.data.code, response.status, parsed.data.message)
				: new MeshAgentRefusedError("unknown", response.status, `HTTP ${String(response.status)}`);
		}
		return schema.parse(payload);
	}

	status(): Promise<AgentStatus> {
		return this.request("GET", AGENT_ROUTES.status, agentStatusSchema);
	}

	/** Found a one-member cluster, or report the one the agent is already in. */
	ensureCluster(request: CreateClusterRequest): Promise<AgentStatus> {
		return this.request("POST", AGENT_ROUTES.cluster, agentStatusSchema, request);
	}

	createJoinRequest(request: JoinRequestRequest): Promise<SignedMemberEntry> {
		return this.request("POST", AGENT_ROUTES.joinRequest, signedMemberEntrySchema, request);
	}

	admit(request: SignedMemberEntry): Promise<AdmitResponse> {
		return this.request("POST", AGENT_ROUTES.admissions, admitResponseSchema, { request });
	}

	join(roster: RosterState): Promise<AgentStatus> {
		return this.request("POST", AGENT_ROUTES.join, agentStatusSchema, { roster: rosterStateSchema.parse(roster) });
	}

	readSettings(): Promise<Record<string, JsonValue>> {
		return this.request("GET", AGENT_ROUTES.settings, settingsReadSchema);
	}

	async writeSetting(key: string, value: JsonValue): Promise<void> {
		await this.request("PUT", AGENT_ROUTES.settings, z.object({ key: z.string() }), { key, value });
	}

	setLabels(labels: Record<string, string>): Promise<AgentStatus> {
		return this.request("PUT", AGENT_ROUTES.labels, agentStatusSchema, { labels });
	}

	/** Revoke a member: its admission ends and every peer drops it on the next gossip round. */
	revoke(memberId: string, reason: string): Promise<AgentStatus> {
		return this.request("POST", AGENT_ROUTES.revocations, agentStatusSchema, { memberId, reason });
	}

	/**
	 * Poll until the agent answers, or give up after `timeoutMs`.
	 *
	 * For the process that just started the agent container: the socket appears a
	 * moment after the container does.
	 */
	async waitUntilReachable(timeoutMs = 30_000, pollMs = 500): Promise<AgentStatus> {
		const deadline = Date.now() + timeoutMs;
		let last: unknown = null;
		while (Date.now() < deadline) {
			try {
				return await this.status();
			} catch (error) {
				last = error;
				await new Promise((resolve) => setTimeout(resolve, pollMs));
			}
		}
		throw last instanceof Error ? last : new MeshAgentUnreachableError(this.socketPath, "timed out");
	}
}
