import { describe, expect, it } from "vitest";
import { firstValueFrom, take } from "rxjs";

import { OrchestrationStreamService } from "./orchestration-stream.service";
import type { EnvService } from "@/config/env/env.module";
import type { SetupStreamEvent } from "@repo/contracts-entities";

/**
 * `OrchestrationStreamService` is the re-sync source for the setup stream.
 *
 * ── WHAT WENT WRONG, AND WHAT THESE PIN ─────────────────────────────────────
 * The stream is re-subscribed for reasons the CLIENT does not control: the
 * ingress is replaced during the handover, tearing the SSE connection down, and
 * the browser reconnects to the same URL. Services are singletons, so the
 * reconnect reaches the SAME instance that has been running the pipeline.
 *
 * Three behaviours matter for that reconnect to land in place rather than
 * re-running the whole pipeline on screen:
 *
 *   1. `stepDetails()` is IDEMPOTENT, so a reconnect does not append a second
 *      full set of step definitions to the buffer.
 *   2. `currentSnapshot()` reports the CURRENT state of every known step, so a
 *      reconnecting client is re-synced rather than reset to all-`pending`.
 *   3. `liveAfter(count)` delivers ONLY what came after the checkpoint, so the
 *      replayed history is not applied on top of that snapshot.
 */

function makeService(mode: "dev" | "prod" = "prod"): OrchestrationStreamService {
	const env = {
		get: (key: string) => (key === "SETUP_MODE" ? mode : undefined),
	} as unknown as EnvService;

	return new OrchestrationStreamService(env);
}

describe("OrchestrationStreamService — reconnect re-sync", () => {
	it("announces the steps ONCE, so a reconnect does not duplicate them", () => {
		const service = makeService();

		const first = service.stepDetails();
		const second = service.stepDetails();

		// Same objects, same ids, and the same count — the second call is a
		// re-read, not a re-announcement. A reconnect that re-announced would
		// append another set to the replay buffer, and the client would rebuild
		// its step list from duplicates.
		expect(second).toBe(first);
		expect(first).toHaveLength(4); // initialize_swarm, start_api, await_api_boot, promote_ingress
	});

	it("reports no snapshot before anything has been reported", () => {
		const service = makeService();

		// Null rather than an empty snapshot: the caller falls back to the
		// all-pending placeholder, which is correct for a FIRST connection.
		expect(service.currentSnapshot()).toBeNull();
	});

	it("reports the CURRENT status of every step, not a reset", () => {
		const service = makeService();

		service.snapshot([
			{ id: "start_api", status: "completed" },
			{ id: "await_api_boot", status: "in_progress" },
		]);

		const snapshot = service.currentSnapshot();

		expect(snapshot?.type).toBe("snapshot");
		if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");

		// The statuses are carried through UNCHANGED — this is the assertion that
		// would have caught the all-pending reset.
		expect(snapshot.steps.map((step) => [step.id, step.status])).toEqual([
			["start_api", "completed"],
			["await_api_boot", "in_progress"],
		]);
	});

	it("carries the accumulated logs in the re-sync snapshot", () => {
		const service = makeService();

		service.snapshot([{ id: "await_api_boot", status: "in_progress" }]);
		service.log("await_api_boot", "line one");
		service.log("await_api_boot", "line two");

		const snapshot = service.currentSnapshot();
		if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");

		// Full logs, for the SAME reason the statuses are full: a reconnecting
		// client must be able to render the step without the event history.
		expect(snapshot.steps[0]?.logs).toEqual(["line one", "line two"]);
	});

	it("tracks the API's forwarded steps too, so a re-sync covers both producers", () => {
		const service = makeService();

		// A step only the API knows about, arriving as a forwarded frame.
		service.forward({
			type: "snapshot",
			seq: 1,
			ts: new Date().toISOString(),
			steps: [
				{
					id: "run_migrations",
					title: "Run migrations",
					description: "Applying database migrations",
					status: "completed",
					logs: [],
				},
			],
		} as SetupStreamEvent);

		const snapshot = service.currentSnapshot();
		if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");

		expect(snapshot.steps.map((step) => [step.id, step.status])).toEqual([
			["run_migrations", "completed"],
		]);
	});

	it("delivers ONLY events after the checkpoint, never the replayed history", async () => {
		const service = makeService();

		// The pipeline runs: these are the events a client that stays connected
		// would already have seen.
		service.stepDetails();
		service.snapshot([{ id: "start_api", status: "completed" }]);

		// A client reconnects NOW. It reads the count, takes the snapshot, then
		// subscribes to the tail.
		const checkpoint = service.emittedSoFar();
		const resync = service.currentSnapshot();
		expect(resync?.type).toBe("snapshot");

		// Collect a bounded number of events rather than awaiting completion:
		// the subject is long-lived (it is the live pipeline), so a `toArray()`
		// over it would never resolve. `take(2)` reads exactly what this test
		// emits afterwards.
		const tailPromise = firstValueFrom(
			service.liveAfter(checkpoint).pipe(take(2)) as import("rxjs").Observable<SetupStreamEvent>,
		);

		// Work continues after the reconnect.
		service.log("await_api_boot", "after the reconnect");
		service.snapshot([{ id: "await_api_boot", status: "completed" }]);

		const tail = await tailPromise;

		// ── THE ASSERTION THAT MATTERS ─────────────────────────────────────────
		// The tail STARTS after the checkpoint, so nothing from before it is
		// re-delivered. Applying the history again is what made the steps re-run
		// on screen; the client already has their aggregate state from the
		// re-sync snapshot.
		expect(tail.type).toBe("log");
		expect(tail.type === "log" && tail.line).toBe("after the reconnect");
	});

	it("counts every event it emits, so the checkpoint cannot drift", () => {
		const service = makeService();

		const before = service.emittedSoFar();
		service.stepDetails();

		// Four step_detail events.
		expect(service.emittedSoFar()).toBe(before + 4);

		service.snapshot([{ id: "start_api", status: "in_progress" }]);
		service.log("start_api", "one line");

		expect(service.emittedSoFar()).toBe(before + 6);
	});
});
