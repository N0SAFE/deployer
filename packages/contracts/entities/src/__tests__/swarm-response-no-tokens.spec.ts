import { describe, expect, it } from "vitest";

import { clusterSnapshotSchema } from "../entities/swarm/cluster.schema";
import { swarmConfigViewSchema } from "../entities/swarm/swarm-config.schema";

/**
 * SEC-005: join tokens are cluster-admin secrets. No response schema may carry them, even when the
 * producer still hands them over — zod strips the unknown key instead of echoing it to the client.
 */
describe("swarm response schemas never carry join tokens", () => {
	it("strips joinTokens from the swarm config view", () => {
		const parsed = swarmConfigViewSchema.parse({
			participation: { mode: "create", policy: "auto", advertiseAddr: null, joinToken: null, joinAddrs: [] },
			setupDone: true,
			engineState: "active",
			role: "manager",
			availability: "active",
			nodeCount: 1,
			managerCount: 1,
			resolveNote: "ready",
			joinTokens: { worker: "SWMTKN-worker", manager: "SWMTKN-manager" },
		});

		expect("joinTokens" in parsed).toBe(false);
		expect(JSON.stringify(parsed)).not.toContain("SWMTKN");
	});

	it("strips joinTokens from the cluster snapshot", () => {
		const parsed = clusterSnapshotSchema.parse({
			clusterId: "cluster-1",
			clusterName: "main",
			localNodeState: "active",
			controlAvailable: true,
			nodeCount: 1,
			managerCount: 1,
			localNode: { nodeId: "node-1", swarmRole: "manager" },
			master: null,
			membership: { nodeId: "node-1", state: "active", joinedAt: "" },
			joinTokens: { worker: "SWMTKN-worker", manager: "SWMTKN-manager" },
		});

		expect("joinTokens" in parsed).toBe(false);
		expect(JSON.stringify(parsed)).not.toContain("SWMTKN");
	});
});
