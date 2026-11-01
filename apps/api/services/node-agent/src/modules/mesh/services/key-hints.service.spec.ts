import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { keyHintsOver } from "./key-hints.service";
import { MeshClock } from "./mesh-clock.service";

import type { KeyHintsShape } from "./key-hints.service";

/** A hint only ever speeds a call up, so the store is bounded: the oldest entry goes when the cap is reached. */
const withClock = <A>(hints: KeyHintsShape, effect: Effect.Effect<A, never, MeshClock>) =>
	Effect.runPromise(effect.pipe(Effect.provideService(MeshClock, { now: () => 1_000 })));

describe("KeyHints", () => {
	it("drops the oldest hint when the cap is reached", async () => {
		const hints = keyHintsOver(new Map(), 2);

		await withClock(hints, hints.remember("runtime", "a", "replica-1", 60_000));
		await withClock(hints, hints.remember("runtime", "b", "replica-1", 60_000));
		await withClock(hints, hints.remember("runtime", "c", "replica-1", 60_000));

		expect(await withClock(hints, hints.lookup("runtime", "a"))).toBeUndefined();
		expect(await withClock(hints, hints.lookup("runtime", "b"))).toBe("replica-1");
		expect(await withClock(hints, hints.lookup("runtime", "c"))).toBe("replica-1");
	});

	it("refreshes a key it already holds without evicting anything", async () => {
		const hints = keyHintsOver(new Map(), 2);

		await withClock(hints, hints.remember("runtime", "a", "replica-1", 60_000));
		await withClock(hints, hints.remember("runtime", "b", "replica-1", 60_000));
		await withClock(hints, hints.remember("runtime", "a", "replica-2", 60_000));

		expect(await withClock(hints, hints.lookup("runtime", "a"))).toBe("replica-2");
		expect(await withClock(hints, hints.lookup("runtime", "b"))).toBe("replica-1");
	});

	it("forgets a hint whose TTL has passed", async () => {
		const hints = keyHintsOver(new Map());

		await withClock(hints, hints.remember("runtime", "a", "replica-1", 0));

		expect(await withClock(hints, hints.lookup("runtime", "a"))).toBeUndefined();
	});
});
