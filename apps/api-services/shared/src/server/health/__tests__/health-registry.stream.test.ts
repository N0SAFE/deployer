import { firstValueFrom, take, toArray } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HealthRegistry, type HealthIndicatorEntry } from "../health-registry.service";

/**
 * The STREAMING behaviour of the registry — the reason it is rxjs rather than a
 * polling function.
 *
 * These tests drive `runOnce()` directly instead of waiting out the 15s cadence,
 * so they assert the stream contract without a timer: what `snapshots$` emits,
 * what `changes$` suppresses, and what `indicator$` isolates.
 */
function entry(
	name: string,
	results: Array<{ status: "up" | "down"; [key: string]: unknown }>,
	delayMs = 0,
): HealthIndicatorEntry {
	let call = 0;
	return {
		name,
		description: `test indicator ${name}`,
		async run() {
			const result = results[Math.min(call, results.length - 1)] ?? { status: "down" as const };
			call += 1;
			if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
			return { [name]: result };
		},
	};
}

/** A registry with the given entries, with the background cadence never started. */
function registryOf(...entries: HealthIndicatorEntry[]): HealthRegistry {
	return new HealthRegistry(entries);
}

describe("HealthRegistry — snapshots", () => {
	it("starts with no snapshot, then reports one after a pass", async () => {
		const registry = registryOf(entry("database", [{ status: "up", version: "PostgreSQL 16.4" }]));

		expect(registry.current()).toBeNull();

		const snapshot = await registry.runOnce();

		expect(snapshot.status).toBe("up");
		expect(registry.current()).toStrictEqual(snapshot);
	});

	it("derives up/down from every indicator, not from the first", async () => {
		const registry = registryOf(
			entry("database", [{ status: "up" }]),
			entry("redis", [{ status: "down", message: "connection refused" }]),
		);

		const snapshot = await registry.runOnce();

		expect(snapshot.status).toBe("down");
		expect(snapshot.info).toHaveProperty("database");
		expect(snapshot.error).toHaveProperty("redis");
		// The reason survives into the payload, which is the difference between
		// "something is down" and an actionable report.
		expect(snapshot.error.redis?.message).toBe("connection refused");
	});

	it("produces Terminus' own info/error/details shape", async () => {
		const registry = registryOf(
			entry("database", [{ status: "up", latencyMs: 3 }]),
			entry("disk", [{ status: "down", message: "only 2% free" }]),
		);

		const snapshot = await registry.runOnce();

		// A Terminus client can consume these three without a translator, which is
		// why they are passed through rather than re-shaped.
		expect(snapshot.info.database).toMatchObject({ status: "up" });
		expect(snapshot.error.disk).toMatchObject({ status: "down" });
		expect(Object.keys(snapshot.details)).toEqual(["database", "disk"]);
	});

	it("flattens indicators in DECLARATION order, regardless of completion order", async () => {
		// `disk` is slow and declared second; a naive `Promise.all` + iteration
		// would still be ordered, but a completion-ordered push would not be. The
		// payload must be stable between passes.
		const registry = registryOf(
			entry("database", [{ status: "up" }], 0),
			entry("disk", [{ status: "up" }], 40),
		);

		const snapshot = await registry.runOnce();

		expect(snapshot.indicators.map((indicator) => indicator.name)).toEqual(["database", "disk"]);
	});

	it("keeps each indicator's own facts in `detail`", async () => {
		const registry = registryOf(entry("database", [{ status: "up", version: "PostgreSQL 16.4", latencyMs: 7 }]));

		const snapshot = await registry.runOnce();

		// `latencyMs` is lifted onto the snapshot; the rest stays as the check's
		// own detail, which is what lets a new indicator add fields without a
		// contract change.
		expect(snapshot.indicators[0]?.latencyMs).toBe(7);
		expect(snapshot.indicators[0]?.detail).toMatchObject({ version: "PostgreSQL 16.4" });
	});

	it("times out a hung check instead of stalling the pass", async () => {
		const hung: HealthIndicatorEntry = {
			name: "hung",
			// Never resolves — the case a real probe hits when a dependency
			// black-holes a connection.
			run: () => new Promise(() => undefined),
		};
		const registry = registryOf(hung, entry("database", [{ status: "up" }]));

		const snapshot = await registry.runOnce();

		expect(snapshot.status).toBe("down");
		expect(snapshot.error.hung?.message).toMatch(/did not finish/);
		// The healthy indicator still reported — one bad dependency does not hide
		// the others.
		expect(snapshot.info).toHaveProperty("database");
	}, 15_000);
});

describe("HealthRegistry — the rxjs streams", () => {
	it("emits on snapshots$ only after a pass completes", async () => {
		const registry = registryOf(entry("database", [{ status: "up" }]));

		const collected = firstValueFrom(registry.snapshots$.pipe(take(1)));
		await registry.runOnce();

		expect((await collected).status).toBe("up");
	});

	it("replays the latest snapshot to a late subscriber", async () => {
		const registry = registryOf(entry("database", [{ status: "up" }]));
		await registry.runOnce();

		// `shareReplay(1)`: a UI that opens after the first pass must not sit blank
		// until the next interval — this is the difference between a dashboard that
		// renders on load and one that renders 15 seconds later.
		const late = await firstValueFrom(registry.snapshots$.pipe(take(1)));

		expect(late.status).toBe("up");
	});

	it("changes$ emits a TRANSITION and then stays silent while nothing changes", async () => {
		// The key property: a subscriber that wants edges (`up → down`) is not
		// woken every 15 seconds by a confirmation of the same state.
		const indicator = entry("database", [{ status: "up" }, { status: "up" }, { status: "down" }]);
		const registry = registryOf(indicator);

		const transitions: string[] = [];
		registry.changes$.subscribe((snapshot) => transitions.push(snapshot.status));

		await registry.runOnce(); // up    → emit
		await registry.runOnce(); // up    → suppressed (identical signature)
		await registry.runOnce(); // down  → emit

		expect(transitions).toEqual(["up", "down"]);
	});

	it("changes$ emits when ANY indicator flips, not only the overall status", async () => {
		// The overall status stays `down`, but a DIFFERENT dependency failing is a
		// real change an operator must be told about.
		const a = entry("database", [{ status: "down" }, { status: "up" }]);
		const b = entry("redis", [{ status: "down" }, { status: "down" }]);
		const registry = registryOf(a, b);

		const seen: string[] = [];
		registry.changes$.subscribe((snapshot) =>
			seen.push(snapshot.indicators.map((i) => `${i.name}:${i.status}`).join(",")),
		);

		await registry.runOnce(); // database:down,redis:down  → emit
		await registry.runOnce(); // database:up,redis:down    → emit (a flip)

		expect(seen).toEqual(["database:down,redis:down", "database:up,redis:down"]);
	});

	it("indicator$ isolates ONE dependency's history", async () => {
		const registry = registryOf(
			entry("database", [{ status: "up" }, { status: "down" }]),
			entry("redis", [{ status: "up" }, { status: "up" }]),
		);

		const database: string[] = [];
		registry.indicator$("database").subscribe((snapshot) => database.push(snapshot.status));

		await registry.runOnce();
		await registry.runOnce();

		// Both passes of `database` only; `redis` never appears.
		expect(database).toEqual(["up", "down"]);
	});

	it("collects every emission of a multi-pass stream, in order", async () => {
		const registry = registryOf(entry("database", [{ status: "up" }, { status: "down" }]));

		const collected = firstValueFrom(registry.snapshots$.pipe(take(2), toArray()));
		await registry.runOnce();
		await registry.runOnce();

		expect((await collected).map((snapshot) => snapshot.status)).toEqual(["up", "down"]);
	});

	it("completes its streams on stop, so subscribers are released", async () => {
		const registry = registryOf(entry("database", [{ status: "up" }]));
		await registry.runOnce();

		let completed = false;
		registry.snapshots$.subscribe({ complete: () => (completed = true) });

		registry.stop();

		expect(completed).toBe(true);
	});

	it("refuses a duplicate indicator name instead of silently shadowing", () => {
		// Two checks under one name would make `changes$` compare the wrong pair.
		expect(() => registryOf(entry("database", [{ status: "up" }]), entry("database", [{ status: "up" }]))).toThrow(
			/already registered|registered twice/,
		);
	});

	it("still publishes a snapshot when a check throws outright", async () => {
		// A broken CHECK is not a broken registry: the pass must complete so every
		// other indicator is still reported.
		const exploding: HealthIndicatorEntry = {
			name: "exploding",
			run: vi.fn(async () => {
				throw new Error("indicator bug");
			}),
		};
		const registry = registryOf(exploding, entry("database", [{ status: "up" }]));

		const snapshot = await registry.runOnce();

		expect(snapshot.error.exploding?.message).toBe("indicator bug");
		expect(snapshot.info).toHaveProperty("database");
	});
});
