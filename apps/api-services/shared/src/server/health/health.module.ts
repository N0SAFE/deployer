import { Controller, Inject, Module, Sse } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import type { Observable } from "rxjs";
import { interval, map, startWith, switchMap } from "rxjs";

import { HEALTH_INDICATORS, HealthRegistry, type HealthIndicatorEntry } from "./health-registry.service";
import { DatabaseHealthIndicator } from "./indicators/database.indicator";
import { DiskHealthIndicator } from "./indicators/disk.indicator";
import { MemoryHealthIndicator } from "./indicators/memory.indicator";
import { MigrationsHealthIndicator } from "./indicators/migrations.indicator";
import { RedisHealthIndicator } from "./indicators/redis.indicator";
import type { HealthSnapshot } from "./types";

/** The indicator sets a service can ask for by name. */
export const INDICATORS = {
	/** Always safe: nothing external, cannot fail because a peer is down. */
	local: ["memory", "disk"] as const,
	/** Local + the database, including "has anyone migrated it". */
	database: ["memory", "disk", "database", "migrations"] as const,
	/** The full set. */
	platform: ["memory", "disk", "database", "migrations", "redis"] as const,
} as const;

export type IndicatorSet = keyof typeof INDICATORS;

/**
 * Streaming health, over SSE.
 *
 * ── WHY THIS ENDPOINT EXISTS SEPARATELY FROM `/health/ready` ────────────────
 * They answer different questions with different costs:
 *
 *   `/health/ready`  — ONE boolean, for a compose/swarm probe, polled forever.
 *                      Cheap by design: reads the cached snapshot.
 *   `/health/stream` — the FULL picture as it CHANGES, for a human or a UI.
 *                      Carries every indicator's detail and emits only on
 *                      transitions, so a dashboard shows the moment something
 *                      goes down without the server being polled at all.
 *
 * SSE rather than a WebSocket because the flow is one-way (server → client) and
 * SSE reconnects on its own — a WebSocket here would add a handshake, a
 * ping/pong, and reconnection logic to deliver a one-directional feed.
 */
@Controller("health")
export class HealthStreamController {
	constructor(private readonly registry: HealthRegistry) {}

	/**
	 * The current full snapshot, on demand.
	 *
	 * For a UI that opened a page and wants the state immediately, rather than
	 * waiting for the next transition.
	 */
	@Sse("stream")
	stream(): Observable<{ data: HealthSnapshot | { heartbeat: true } }> {
		// A heartbeat every 15s so a proxy does not close an idle connection, and
		// so the client can tell "nothing changed" from "the stream died".
		const heartbeats = interval(15_000).pipe(map(() => ({ data: { heartbeat: true as const } })));
		const changes = this.registry.changes$.pipe(
			map((snapshot) => ({ data: snapshot })),
			// Emission on subscribe matters: a client that connects while the
			// platform is DEGRADED must see that immediately, not on the next edge.
			startWith(null),
			switchMap((value) => (value === null ? this.registry.snapshots$.pipe(map((s) => ({ data: s }))) : [value])),
		);

		return changes;
	}
}

/**
 * Wires real health indicators and their stream for one app.
 *
 * `forRoot` takes the indicator set because it is a property of the APP: a
 * service that never touches Redis declaring the redis check would be reporting
 * a dependency it does not have, and would go red for it. Naming the set makes
 * that a visible choice in the root module.
 */
@Module({})
export class HealthModule {
	/**
	 * The registry is bound HERE, after `HEALTH_INDICATORS` is provided, so
	 * construction order is guaranteed: the registry's constructor reads the
	 * entries, and a registry built before them would silently see none.
	 */
	static forRoot(options: { indicators: IndicatorSet }): DynamicModule {
		const names = INDICATORS[options.indicators];

		return {
			module: HealthModule,
			imports: [TerminusModule.forRoot({ logger: false })],
			providers: [
				DatabaseHealthIndicator,
				MigrationsHealthIndicator,
				RedisHealthIndicator,
				MemoryHealthIndicator,
				DiskHealthIndicator,
				{
					provide: HEALTH_INDICATORS,
					useFactory: (
						database: DatabaseHealthIndicator,
						migrations: MigrationsHealthIndicator,
						redis: RedisHealthIndicator,
						memory: MemoryHealthIndicator,
						disk: DiskHealthIndicator,
					): HealthIndicatorEntry[] => {
						const available = { database, migrations, redis, memory, disk };
						return names.map((name) => entryFor(name, available));
					},
					inject: [
						DatabaseHealthIndicator,
						MigrationsHealthIndicator,
						RedisHealthIndicator,
						MemoryHealthIndicator,
						DiskHealthIndicator,
					],
				},
				HealthRegistry,
			],
			controllers: [HealthStreamController],
			exports: [HealthRegistry, HEALTH_INDICATORS],
		};
	}
}

/** Map an indicator name to its entry. */
function entryFor(
	name: string,
	indicators: {
		database: DatabaseHealthIndicator;
		migrations: MigrationsHealthIndicator;
		redis: RedisHealthIndicator;
		memory: MemoryHealthIndicator;
		disk: DiskHealthIndicator;
	},
): HealthIndicatorEntry {
	switch (name) {
		case "database":
			return { name, run: () => indicators.database.check(), description: "Postgres round-trip + server version" };
		case "migrations":
			return { name, run: () => indicators.migrations.check(), description: "drizzle migration journal has entries" };
		case "redis":
			return { name, run: () => indicators.redis.check(), description: "Redis PING/PONG over the wire" };
		case "memory":
			return { name, run: () => indicators.memory.check(), description: "heap ratio + cgroup ceiling" };
		case "disk":
			return { name, run: () => indicators.disk.check(), description: "free space on the data volume" };
		default:
			// Unreachable for a named set; throwing keeps a typo from becoming a
			// silently missing check.
			throw new Error(`unknown health indicator "${name}"`);
	}
}

export { HealthRegistry, type HealthIndicatorEntry } from "./health-registry.service";
export { HEALTH_INDICATORS } from "./health-registry.service";
export type { HealthSnapshot, IndicatorSnapshot, IndicatorResult } from "./types";
