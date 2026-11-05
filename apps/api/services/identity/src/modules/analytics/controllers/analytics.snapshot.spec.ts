import { Context, Effect } from "effect";
import { describe, expect, it } from "vitest";

import { liveSnapshot } from "@deployer/shared/core/utils/live-snapshot.utils";

/**
 * Regression guard for the analytics stream boundary.
 *
 * `liveSnapshot` evaluates on a TIMER, so the evaluation starts from an empty Effect context. An
 * analytics query requires `AnalyticsRepository` (which resolves over `DatabasePort`), so an
 * evaluation that does not carry the module's context fails with
 * `Service not found: identity/AnalyticsRepository` — a DEFECT, which `liveSnapshot` swallows. The
 * symptom was a stream that connected and then never emitted.
 *
 * The controller used to hide this behind `effect as Effect.Effect<A, E>`; the cast was the bug. It
 * now captures `Effect.context()` inside the request fiber and re-provides it per tick, so this spec
 * asserts the property that makes that work: a snapshot built from a captured context RESOLVES its
 * services, and one built without it does not.
 */

/** Stand-in for a port: a service whose presence is the only thing that matters. */
class FakePort extends Context.Service<FakePort, { readonly value: number }>()("test/FakePort") {}

const query = Effect.gen(function* () {
	const port = yield* FakePort;
	return { value: port.value };
});

/** Mirrors `snapshotOf`: run one tick with a context captured earlier. */
const snapshotOf = (ports: Context.Context<FakePort>) => () =>
	Effect.runPromise(query.pipe(Effect.provideContext(ports)));

describe("analytics snapshot boundary", () => {
	it("resolves the captured ports on every tick, not just the first", async () => {
		const ports = Context.make(FakePort, { value: 42 });

		const first = await snapshotOf(ports)();
		const second = await snapshotOf(ports)();

		expect(first).toEqual({ value: 42 });
		expect(second).toEqual({ value: 42 });
	});

	it("fails when the ports were erased — the defect the fix removes", async () => {
		// An empty context is what a bare `Effect.runPromise(effect)` gives a timer tick.
		await expect(Effect.runPromise(query as Effect.Effect<{ value: number }>)).rejects.toBeDefined();
	});

	it("keeps emitting after a tick fails, so one bad query does not end the stream", async () => {
		const ports = Context.make(FakePort, { value: 7 });
		let calls = 0;
		const evaluate = () => {
			calls += 1;
			// First poll fails (a blip), the rest succeed.
			return calls === 1 ? Promise.reject(new Error("db down")) : snapshotOf(ports)();
		};

		const emitted: { value: number }[] = [];
		await new Promise<void>((resolve) => {
			const subscription = liveSnapshot(evaluate, { intervalMs: 10 }).subscribe({
				next: (snapshot) => {
					emitted.push(snapshot);
					subscription.unsubscribe();
					resolve();
				},
				error: () => {
					resolve();
				},
			});
		});

		expect(emitted).toEqual([{ value: 7 }]);
		expect(calls).toBeGreaterThan(1);
	});
});
