/**
 * Verification: "the mesh decides if a JOINING node becomes master when the
 * wizard selection is 'can be master or worker'".
 *
 * This is an EXECUTABLE trace of the decision, not a unit test of a helper: it
 * drives the real `SwarmJoinGrantService.buildGrant()` against a fake engine
 * and asserts the outcome the fleet hands back to the joiner.
 *
 * Run: bun --bun scripts/verify-mesh-master-decision.ts
 */

import { SwarmJoinGrantService } from "../packages/nest/swarm/src/services/swarm-join-grant.service";

interface FakeCluster {
	managerCount: number;
	nodeCount: number;
	localNodeState: string;
	joinTokens: { worker: string; manager: string } | null;
}

function makeService(cluster: FakeCluster): SwarmJoinGrantService {
	const stub = {
		getLocalClusterSnapshot: async () => ({
			localNodeState: cluster.localNodeState,
			managerCount: cluster.managerCount,
			nodeCount: cluster.nodeCount,
		}),
		getJoinTokens: async () => cluster.joinTokens,
		// The control-plane addresses a joiner may reach the cluster on.
		managerAddresses: async () => ["10.0.0.1:2377"],
	};
	// The package reads no environment: the quorum target and the advertise address are DATA
	// the app supplies, so the trace supplies them the same way (target 3 = the documented default).
	return new SwarmJoinGrantService(stub as never, { quorumMax: 3 }, { advertiseAddr: "10.0.0.1" });
}

/** The wizard's three selections. "auto" IS "can be master or worker". */
const SELECTIONS = ["auto", "manager", "worker"] as const;

async function main(): Promise<void> {
	const active = { localNodeState: "active", nodeCount: 3, joinTokens: { worker: "W", manager: "M" } };

	console.log("=== FLEET DECIDES THE ROLE OF A JOINING NODE ===");
	console.log('(wizard selection "auto" = "can be master or worker")\n');

	const cases: Array<{ managers: number; expect: "manager" | "worker" }> = [
		{ managers: 2, expect: "manager" }, // even + below target(3) → 2→3 gains tolerance
		{ managers: 3, expect: "worker" }, //  at target               → decline
		// A lone founding manager ADMITS a joiner even though 1→2 gains no tolerance: a strict
		// parity rule would decline every joiner at 1 and the fleet could never reach its target
		// (the "founding exception" in `swarm-join-grant.service.spec.ts`).
		{ managers: 1, expect: "manager" },
		{ managers: 4, expect: "worker" }, // even but ≥ target        → decline
	];

	let failed = false;
	for (const selection of SELECTIONS) {
		console.log(`── wizard selection: "${selection}"`);
		for (const c of cases) {
			const svc = makeService({ ...active, managerCount: c.managers });
			const grant = await svc.buildGrant(selection);
			const role = grant?.role ?? "(no grant)";

			// "worker" selection must ALWAYS yield worker, regardless of parity.
			const expected = selection === "worker" ? "worker" : c.expect;
			const ok = role === expected;
			if (!ok) failed = true;

			// The manager token must be withheld unless the role IS manager —
			// engine-level enforcement, not a trusted hint.
			const tokenOk = role === "manager" ? grant?.managerToken === "M" : grant?.managerToken === null;
			if (!tokenOk) failed = true;

			console.log(
				`   managers=${String(c.managers)} → role=${role.padEnd(8)} ` +
					`managerToken=${grant?.managerToken === null ? "WITHHELD" : "GRANTED "} ` +
					`${ok && tokenOk ? "✅" : "❌ expected " + expected}`,
			);
			console.log(`      reason: ${grant?.reason ?? "-"}`);
		}
		console.log("");
	}

	// No converged swarm → no grant at all (the joiner defers, never invents).
	const inactiveSvc = makeService({ ...active, localNodeState: "inactive", managerCount: 0 });
	const none = await inactiveSvc.buildGrant("auto");
	console.log(`── engine NOT an active cluster → grant=${none === null ? "null ✅" : "present ❌"}`);
	if (none !== null) failed = true;

	console.log("");
	if (failed) {
		console.error("❌ mesh master-decision verification FAILED");
		process.exit(1);
	}
	console.log("✅ mesh master-decision verification passed");
}

await main();
