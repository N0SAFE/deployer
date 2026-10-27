/**
 * MeshAdmissionService — the mesh half of joining a cluster, on both sides.
 *
 * The platform's join exchange (issue a grant on any member, consume it from the
 * joiner) already authenticates the OPERATOR. This service rides on it so the
 * joiner enters the peer-equal mesh in the same round trip:
 *
 *   admitter: issueJoinGrant   → the cluster id + CIDR a join request must name
 *   joiner:   createJoinRequest → its own signed entry (its agent signs it)
 *   admitter: consumeJoinGrant → its agent admits the entry, returns the roster
 *   joiner:   adopt the roster → WireGuard links come up → Swarm joins over them
 *
 * Any member can be the admitter — whichever one the joiner reached.
 */

import { Injectable, Logger } from "@nestjs/common";
import { rosterStateSchema, signedMemberEntrySchema } from "@deployer/mesh-network";
import type { MeshNetworkCluster } from "@deployer/contracts-entities";

import { MeshAgentClient } from "./mesh-agent.client";

type JsonValue = Parameters<MeshAgentClient["writeSetting"]>[1];

@Injectable()
export class MeshAdmissionService {
	private readonly logger = new Logger(MeshAdmissionService.name);

	constructor(private readonly mesh: MeshAgentClient) {}

	/** ADMITTER: the cluster a joiner must name, or null when this node has no mesh yet. */
	async clusterForGrant(): Promise<MeshNetworkCluster | null> {
		const status = await this.mesh.status().catch(() => null);
		return status?.cluster === null || status?.cluster === undefined ? null : { clusterId: status.cluster.clusterId, cidr: status.cluster.cidr };
	}

	/**
	 * ADMITTER: admit a joiner's signed entry. Null (never a throw) when it cannot be
	 * admitted — the operator-level join still completes and the joiner reports the
	 * mesh as missing, rather than the whole join failing on a network detail.
	 */
	async admit(request: unknown): Promise<{ roster: JsonValue } | null> {
		const parsed = signedMemberEntrySchema.safeParse(request);
		if (!parsed.success) {
			this.logger.warn("Mesh join request rejected: it is not a signed member entry");
			return null;
		}
		try {
			const { roster } = await this.mesh.admit(parsed.data);
			this.logger.log(`Admitted ${parsed.data.record.name} (${parsed.data.record.memberId}) into the mesh at ${parsed.data.record.address}`);
			return { roster: roster };
		} catch (error) {
			this.logger.warn(`Mesh admission of ${parsed.data.record.memberId} failed: ${error instanceof Error ? error.message : String(error)}`);
			return null;
		}
	}

	/** JOINER: this node's signed request to join `cluster`. */
	async createJoinRequest(cluster: MeshNetworkCluster): Promise<JsonValue> {
		// No node-id label here: the platform assigns this node's id AFTER the join
		// handshake; `MeshAgentBootstrapService` publishes it once the node is set up.
		return await this.mesh.createJoinRequest({ clusterId: cluster.clusterId, cidr: cluster.cidr });
	}

	/** JOINER: adopt the roster the admitter returned (the agent verifies it admits us). */
	async adopt(admission: { roster: unknown }): Promise<void> {
		await this.mesh.join(rosterStateSchema.parse(admission.roster));
	}

	/**
	 * JOINER: wait until a WireGuard handshake with some member is fresh — the
	 * moment Swarm can reach a manager's mesh address. Returns false on timeout
	 * (the caller proceeds and lets Swarm's own join retry report the outcome).
	 */
	async waitForLink(timeoutMs = 60_000, pollMs = 2_000): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const status = await this.mesh.status().catch(() => null);
			if (status?.cluster?.interfaceUp === true && status.members.some((member) => member.link.path === "direct")) return true;
			await new Promise((resolve) => setTimeout(resolve, pollMs));
		}
		return false;
	}
}
