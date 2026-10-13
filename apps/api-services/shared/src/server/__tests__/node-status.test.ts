import { describe, expect, it } from "vitest";

import { deriveNodeState, exitCodeForState, type NodeStateFacts } from "../node-status";

/**
 * The derived state is what `deployer status` prints and what a script branches
 * on, so every combination of the two facts is pinned here. The distinctions
 * that matter are the ones where a plausible implementation would collapse two
 * cases into one — those are the assertions with a comment saying why.
 */
describe("deriveNodeState", () => {
	const cases: { facts: NodeStateFacts; state: string; why: string }[] = [
		{
			facts: { setupState: null, platform: null },
			state: "inactive",
			why: "no row at all is the same as never configured",
		},
		{
			facts: { setupState: "not_started", platform: null },
			state: "inactive",
			why: "a row exists but has never been provisioned",
		},
		{
			facts: { setupState: "setup_in_progress", platform: "unreachable" },
			state: "provisioning",
			why: "in flight beats unreachable — the platform SHOULD be unreachable mid-provision",
		},
		{
			facts: { setupState: "upgrade_in_progress", platform: null },
			state: "provisioning",
			why: "an upgrade in flight is also provisioning",
		},
		{
			facts: { setupState: "upgrade_failed", platform: "healthy" },
			state: "failed",
			why: "a failed upgrade is reported even when the OLD platform answers",
		},
		{
			facts: { setupState: "setup_done", platform: null },
			state: "stopped",
			why: "configured but silent is the expected resting state, not a failure",
		},
		{
			facts: { setupState: "setup_done", platform: "unreachable" },
			state: "stopped",
			why: "unreachable and absent mean the same thing to an operator: nothing is up",
		},
		{
			facts: { setupState: "setup_done", platform: "healthy" },
			state: "healthy",
			why: "the only healthy case",
		},
		{
			facts: { setupState: "setup_done", platform: "degraded" },
			state: "degraded",
			why: "degraded must not be collapsed into healthy",
		},
		{
			facts: { setupState: "upgrade_pending", platform: "healthy" },
			state: "healthy",
			why: "a pending upgrade that has not started is still a working platform",
		},
	];

	for (const { facts, state, why } of cases) {
		it(`${JSON.stringify(facts)} → ${state} (${why})`, () => {
			expect(deriveNodeState(facts).state).toBe(state);
		});
	}

	it("always returns an actionable detail line", () => {
		for (const { facts } of cases) {
			expect(deriveNodeState(facts).detail.length).toBeGreaterThan(0);
		}
	});

	it("tells an inactive node how to proceed", () => {
		const verdict = deriveNodeState({ setupState: null, platform: null });
		expect(verdict.detail).toContain("deployer start");
	});

	it("tells a stopped node how to proceed", () => {
		const verdict = deriveNodeState({ setupState: "setup_done", platform: null });
		expect(verdict.detail).toContain("deployer start");
	});

	it("points a failed node at diagnosis rather than a restart", () => {
		const verdict = deriveNodeState({ setupState: "upgrade_failed", platform: null });
		expect(verdict.detail).toContain("doctor");
	});
});

describe("exitCodeForState", () => {
	it("maps each state to the documented code", () => {
		// Pinned because scripts branch on these; a change here is a breaking change
		// to every automation built on the CLI.
		expect(exitCodeForState("healthy")).toBe(0);
		expect(exitCodeForState("provisioning")).toBe(0);
		expect(exitCodeForState("inactive")).toBe(3);
		expect(exitCodeForState("degraded")).toBe(4);
		expect(exitCodeForState("failed")).toBe(4);
		expect(exitCodeForState("stopped")).toBe(5);
	});
});
