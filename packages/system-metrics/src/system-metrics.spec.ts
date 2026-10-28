import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { MetricsUnavailable } from "./errors";
import { toSnapshot } from "./snapshot";
import { makeSystemMetrics } from "./system-metrics";

import type { Readings } from "./readings";


const readings = (overrides: Partial<Readings> = {}): Readings =>
	({
		cpu: { manufacturer: "Acme", brand: "X1", speed: 3.2, cores: 8, physicalCores: 4 },
		load: { currentLoad: 12, currentLoadUser: 8, currentLoadSystem: 3, currentLoadIdle: 88, cpus: [{ load: 12, loadUser: 8, loadSystem: 3, loadIdle: 88 }] },
		mem: { total: 100, free: 40, used: 60, active: 50, available: 45, buffcache: 5, swaptotal: 10, swapused: 1, swapfree: 9 },
		fsSize: [
			{ fs: "/dev/a", type: "ext4", size: 100, used: 25, available: 75, use: 25, mount: "/", rw: true },
			{ fs: "/dev/b", type: "ext4", size: 100, used: 75, available: 25, use: 75, mount: "/data", rw: true },
		],
		networkStats: [
			{ iface: "eth0", operstate: "up", rx_bytes: 10, tx_bytes: 20, rx_dropped: 1, tx_dropped: 2, rx_errors: 3, tx_errors: 4, rx_sec: 1, tx_sec: 2 },
			{ iface: "lo", operstate: "unknown", rx_bytes: 5, tx_bytes: 5, rx_dropped: 0, tx_dropped: 0, rx_errors: 0, tx_errors: 0, rx_sec: 0, tx_sec: 0 },
		],
		graphics: { controllers: [{ vendor: "V", model: "M", bus: "PCI", vram: 8, vramDynamic: false }], displays: [] },
		processes: { all: 2, running: 1, blocked: 0, sleeping: 1, unknown: 0, list: [{ pid: 1, name: "init" }, { pid: 42, name: "api", cpu: 1.5, mem: 2.5, command: "bun api", started: "now" }] },
		...overrides,
	}) as unknown as Readings;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("toSnapshot", () => {
	it("sums the disk and network totals and computes the disk use percentage", () => {
		const snapshot = toSnapshot(readings(), 42, new Date("2026-01-01T00:00:00Z"));
		expect(snapshot.capturedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(snapshot.disk.totals).toEqual({ size: 200, used: 100, available: 100, use: 50 });
		expect(snapshot.network.totals).toEqual({ rxBytes: 15, txBytes: 25, rxDropped: 1, txDropped: 2, rxErrors: 3, txErrors: 4 });
		expect(snapshot.network.interfaces.map((entry) => entry.iface)).toEqual(["eth0", "lo"]);
	});

	it("reports no disk use when there is no disk", () => {
		expect(toSnapshot(readings({ fsSize: [] }), 42, new Date()).disk.totals.use).toBe(0);
	});

	it("picks this process out of the list, or reports none", () => {
		expect(toSnapshot(readings(), 42, new Date()).process).toMatchObject({ pid: 42, name: "api", command: "bun api" });
		expect(toSnapshot(readings(), 99, new Date()).process).toBeNull();
	});
});

describe("SystemMetrics.snapshot", () => {
	const setup = (ttlMs = 1_000) => {
		let clock = 0;
		const probe = vi.fn(() => Effect.sync(() => readings()));
		return { metrics: makeSystemMetrics({ probe: Effect.suspend(probe), ttlMs, now: () => clock, pid: 42 }), probe, tick: (ms: number) => { clock += ms; } };
	};

	it("reuses a snapshot within the TTL and samples again after it", async () => {
		const { metrics, probe, tick } = setup();
		await run(metrics.snapshot());
		tick(999);
		await run(metrics.snapshot());
		expect(probe).toHaveBeenCalledTimes(1);
		tick(2);
		await run(metrics.snapshot());
		expect(probe).toHaveBeenCalledTimes(2);
	});

	it("takes a fresh snapshot when forced", async () => {
		const { metrics, probe, tick } = setup();
		await run(metrics.snapshot());
		tick(10);
		await run(metrics.snapshot({ force: true }));
		expect(probe).toHaveBeenCalledTimes(2);
	});

	it("makes concurrent callers share one sampling, even a forced one", async () => {
		const { metrics, probe } = setup();
		await Promise.all([metrics.snapshot(), metrics.snapshot({ force: true }), metrics.snapshot({ force: true })].map(run));
		expect(probe).toHaveBeenCalledTimes(1);
	});

	it("never caches a failure: the next call samples again", async () => {
		let fail = true;
		const probe = vi.fn(() => (fail ? Effect.fail(new MetricsUnavailable({ reason: "no /proc" })) : Effect.succeed(readings())));
		const metrics = makeSystemMetrics({ probe: Effect.suspend(probe), now: () => 0 });
		await expect(run(metrics.snapshot())).rejects.toMatchObject({ _tag: "MetricsUnavailable" });
		fail = false;
		await run(metrics.snapshot());
		expect(probe).toHaveBeenCalledTimes(2);
	});
});
