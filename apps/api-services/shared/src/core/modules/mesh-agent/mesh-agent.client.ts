/**
 * MeshAgentClient — the API's handle on THIS node's mesh agent.
 *
 * The agent owns everything node-local below Swarm (identity, WireGuard, doors)
 * and holds the replicated cluster settings. The API reaches it over the agent's
 * unix socket, mounted into the API task from the agent's run volume — so it only
 * ever talks to the agent on its own node, and that is enough: every agent holds
 * the full roster.
 *
 * The wire format lives in `@deployer/mesh-network` (`MeshAgentHttpClient`, shared with
 * setup); this wrapper only maps its failures onto the API's error hierarchy, so a
 * missing agent ("not started yet", normal during onboarding) stays distinguishable
 * from a refused request.
 */

import { Injectable } from "@nestjs/common";
import {
	AGENT_SOCKET_PATH,
	MeshAgentHttpClient,
	MeshAgentRefusedError,
	MeshAgentUnreachableError,
	type AdmitResponse,
	type AgentStatus,
	type CreateClusterRequest,
	type JoinRequestRequest,
	type JsonValue,
	type RosterState,
	type SignedMemberEntry,
} from "@deployer/mesh-network";
import { AppError } from "@deployer/errors";

import { EnvService } from "@/config/env/env.module";

/** There is no agent on this node yet (socket missing, or nothing answering). */
export class MeshAgentUnavailableError extends AppError {
	constructor(socketPath: string, cause?: string) {
		super(`mesh agent is not reachable at ${socketPath}${cause === undefined ? "" : ` (${cause})`}`, "MESH_AGENT_UNAVAILABLE", { socketPath });
		this.name = "MeshAgentUnavailableError";
	}
}

/** The agent answered and refused the request. `agentCode` is the agent's own code. */
export class MeshAgentRequestError extends AppError {
	constructor(
		readonly agentCode: string,
		readonly status: number,
		message: string,
	) {
		super(`mesh agent refused the request: ${message}`, "MESH_AGENT_REQUEST_FAILED", { agentCode, status });
		this.name = "MeshAgentRequestError";
	}
}

@Injectable()
export class MeshAgentClient {
	private readonly http: MeshAgentHttpClient;

	constructor(env: EnvService) {
		this.http = new MeshAgentHttpClient(env.get("MESH_AGENT_SOCKET") ?? AGENT_SOCKET_PATH);
	}

	socketPath(): string {
		return this.http.socketPath;
	}

	private async call<T>(request: () => Promise<T>): Promise<T> {
		try {
			return await request();
		} catch (error) {
			if (error instanceof MeshAgentUnreachableError) throw new MeshAgentUnavailableError(error.socketPath, error.message);
			if (error instanceof MeshAgentRefusedError) throw new MeshAgentRequestError(error.code, error.status, error.message);
			throw error;
		}
	}

	status(): Promise<AgentStatus> {
		return this.call(() => this.http.status());
	}

	/** Found a one-member cluster, or report the one the agent is already in. */
	ensureCluster(request: CreateClusterRequest): Promise<AgentStatus> {
		return this.call(() => this.http.ensureCluster(request));
	}

	createJoinRequest(request: JoinRequestRequest): Promise<SignedMemberEntry> {
		return this.call(() => this.http.createJoinRequest(request));
	}

	/** Admit a joiner. The caller has already authorised the operator behind it. */
	admit(request: SignedMemberEntry): Promise<AdmitResponse> {
		return this.call(() => this.http.admit(request));
	}

	join(roster: RosterState): Promise<AgentStatus> {
		return this.call(() => this.http.join(roster));
	}

	readSettings(): Promise<Record<string, JsonValue>> {
		return this.call(() => this.http.readSettings());
	}

	writeSetting(key: string, value: JsonValue): Promise<void> {
		return this.call(() => this.http.writeSetting(key, value));
	}

	/** Publish facts about this node (swarm node id, platform node id) in its roster entry. */
	setLabels(labels: Record<string, string>): Promise<AgentStatus> {
		return this.call(() => this.http.setLabels(labels));
	}

	/** Revoke a member. The caller has already authorised the operator behind it. */
	revoke(memberId: string, reason: string): Promise<AgentStatus> {
		return this.call(() => this.http.revoke(memberId, reason));
	}
}
