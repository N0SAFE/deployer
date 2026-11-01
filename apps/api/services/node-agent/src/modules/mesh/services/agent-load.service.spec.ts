import { describe, expect, it } from "vitest";

import { agentLoadOver } from "./agent-load.service";

/**
 * The load windows are read by the lease policy, so they must stay honest AND bounded: a peer flooding bytes or calls
 * must not grow the agent's memory without limit.
 */

describe("AgentLoad", () => {
	it("keeps the bytes window bounded, dropping the oldest samples", () => {
		const load = agentLoadOver({ now: () => 1_000, eventLoopLagMs: () => 0 });

		for (let sample = 0; sample < 10_050; sample += 1) {
			load.bytesMoved(1);
		}

		// The window holds the last 10_000 bytes, not the 10_050 that were reported.
		expect(load.sample().bytesPerSecond).toBe(10_000);
	});

	it("keeps each pair's call window bounded", () => {
		const load = agentLoadOver({ now: () => 1_000, eventLoopLagMs: () => 0 });
		let calls = 0;

		for (let call = 0; call < 10_050; call += 1) {
			calls = load.callStarted("runtime/stream-1");
		}

		expect(calls).toBe(10_000);
	});
});
