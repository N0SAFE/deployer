import { Controller, Inject, Module, Sse } from "@nestjs/common";
import { declareModule } from "@deployer/nest-effect";
import type { DynamicModule } from "@nestjs/common";

import type { Pool } from "pg";
import type { Observable } from "rxjs";
import { interval, map, startWith, switchMap } from "rxjs";

import { GLOBAL_DATABASE_POOL } from "../../core/modules/database/database-connection";

import { HealthRegistry, type HealthIndicatorEntry } from "./health-registry.service";
import { HealthRegistryCadence } from "./health-registry-cadence.provider";
import { DatabaseHealthIndicator } from "./indicators/database.indicator";
import { DiskHealthIndicator } from "./indicators/disk.indicator";
import { MemoryHealthIndicator } from "./indicators/memory.indicator";
import { MigrationsHealthIndicator } from "./indicators/migrations.indicator";
import { RedisHealthIndicator } from "./indicators/redis.indicator";

import type { Effect } from "effect";

import type { HealthSnapshot, IndicatorResult } from "./types";

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
	constructor(@Inject(HealthRegistry) private readonly registry: HealthRegistry["Service"]) {}

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
 * service that never touches Redis declaring the redis check would be reporting a
 * dependency it does not have, and would go red for it. Naming the set makes
 * that a visible choice in the root module.
 */
@Module({})
export class HealthModule {
	/**
	 * Each indicator is an Effect service; the registry is built in a factory, after them, because it reads their
	 * entries once at construction.
	 *
	 * The database-backed checks take the raw pool rather than a connection, and the injection is OPTIONAL: a service
	 * that does not import `DatabaseModule` still gets a registry, and the check reports "no pool bound" instead of
	 * failing at boot.
	 */
	static forRoot(options: { indicators: IndicatorSet }): DynamicModule {
		const names = INDICATORS[options.indicators];
		const pool = { token: GLOBAL_DATABASE_POOL, optional: true as const };

		return declareModule(
			{
				module: HealthModule,
				providers: [
					{ provide: MemoryHealthIndicator, useClass: MemoryHealthIndicator.live },
					{ provide: DiskHealthIndicator, useClass: DiskHealthIndicator.live },
					{ provide: RedisHealthIndicator, useClass: RedisHealthIndicator.live },
					{
						provide: DatabaseHealthIndicator,
						useFactory: (databasePool: Pool | null | undefined) => new DatabaseHealthIndicator.live(databasePool),
						inject: [pool],
					},
					{
						provide: MigrationsHealthIndicator,
						useFactory: (databasePool: Pool | null | undefined) => new MigrationsHealthIndicator.live(databasePool),
						inject: [pool],
					},
					{
						provide: HealthRegistry,
						useFactory: (
							database: DatabaseHealthIndicator["Service"],
							migrations: MigrationsHealthIndicator["Service"],
							redis: RedisHealthIndicator["Service"],
							memory: MemoryHealthIndicator["Service"],
							disk: DiskHealthIndicator["Service"],
						): HealthRegistry["Service"] =>
							new HealthRegistry.live(entriesFor(names, { database, migrations, redis, memory, disk })),
						inject: [
							DatabaseHealthIndicator,
							MigrationsHealthIndicator,
							RedisHealthIndicator,
							MemoryHealthIndicator,
							DiskHealthIndicator,
						],
					},
					HealthRegistryCadence,
				],
				controllers: [HealthStreamController],
				exports: [HealthRegistry],
			},
			{},
		);
	}
}

/** Map an indicator name to its entry. */
function entriesFor(
	names: readonly string[],
	indicators: {
		database: DatabaseHealthIndicator["Service"];
		migrations: MigrationsHealthIndicator["Service"];
		redis: RedisHealthIndicator["Service"];
		memory: MemoryHealthIndicator["Service"];
		disk: DiskHealthIndicator["Service"];
	},
): HealthIndicatorEntry[] {
	const entry = (name: string, description: string, run: () => Effect.Effect<IndicatorResult>): HealthIndicatorEntry => ({
		name,
		description,
		run,
	});

	return names.map((name) => {
		switch (name) {
			case "database":
				return entry("database", "Postgres round-trip + server version", () => indicators.database.check());
			case "migrations":
				return entry("migrations", "drizzle migration journal has entries", () => indicators.migrations.check());
			case "redis":
				return entry("redis", "Redis PING/PONG over the wire", () => indicators.redis.check());
			case "memory":
				return entry("memory", "heap ratio + cgroup ceiling", () => indicators.memory.check());
			case "disk":
				return entry("disk", "free space on the data volume", () => indicators.disk.check());
			default:
				// Unreachable for a named set; throwing keeps a typo from becoming a
				// silently missing check.
				throw new Error(`unknown health indicator "${name}"`);
		}
	});
}
