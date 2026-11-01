import { Context, Effect } from "effect";

import { indicatorFor, type HealthIndicatorShape } from "./indicator-result";

import type { IndicatorResult } from "../types";

import type { Pool } from "pg";

/** The journal table drizzle writes when it applies a migration. */
const MIGRATION_JOURNAL = "drizzle.__drizzle_migrations";

/**
 * The schema check — proves a deployment has actually run here.
 *
 * ── THE FAILURE THIS CATCHES THAT REACHABILITY CANNOT ───────────────────────
 * A freshly initialised Postgres accepts EVERY connection and fails every real
 * query with `relation "projects" does not exist`. A connection-only check calls
 * that database healthy, and the platform's first user request discovers the
 * truth. So this asserts the two facts that mean "someone set this up":
 *
 *   - the drizzle journal table exists;
 *   - it records at least one applied migration.
 *
 * It reports the COUNT, which is the useful number: an operator comparing two
 * environments can see they are at different migration levels, which is a real
 * class of bug this platform has hit (a node migrated while another was not).
 */
export class MigrationsHealthIndicator extends Context.Service<MigrationsHealthIndicator, HealthIndicatorShape>()(
	"shared/health/MigrationsHealthIndicator",
) {
	static readonly NAME = "migrations";

	static readonly live = class MigrationsHealthIndicatorImpl implements HealthIndicatorShape {
		/** The raw `pg.Pool`, NOT `GLOBAL_DATABASE_CONNECTION` (the drizzle handle): `check()` runs a bare statement. */
		constructor(private readonly pool: Pool | null | undefined = undefined) {}

		check(): Effect.Effect<IndicatorResult> {
			const name = MigrationsHealthIndicator.NAME;
			const pool = this.pool;
			return Effect.gen(function* () {
				const check = indicatorFor(name);

				if (pool === undefined || pool === null) {
					return check.down({
						message: "no database pool is bound to this service",
						hint: "declare DatabaseModule in the service's root module",
					});
				}

				const started = Date.now();
				const outcome = yield* Effect.result(
					Effect.tryPromise({
						try: () =>
							pool.query<{ applied: number; latest: string | null }>(
								`SELECT count(*)::int AS applied, max(created_at)::text AS latest FROM ${MIGRATION_JOURNAL}`,
							),
						catch: (error) => error,
					}),
				);

				if (outcome._tag === "Failure") {
					const cause: unknown = outcome.failure;
					const message = cause instanceof Error ? cause.message : String(cause);
					// The most common cause by far is that the journal table does not
					// exist yet, which reads as a cryptic Postgres error. Say it plainly.
					const hint = /does not exist/i.test(message)
						? `the migration journal (${MIGRATION_JOURNAL}) is absent — this database has never been migrated`
						: undefined;
					return check.down({ message, ...(hint === undefined ? {} : { hint }), latencyMs: Date.now() - started });
				}

				const row = outcome.success.rows[0];

				// A driver may return the count as a string; coerce rather than assume,
				// because "0" is truthy and would report an unmigrated database as fine.
				const applied = typeof row?.applied === "number" ? row.applied : Number(row?.applied ?? 0);
				const latencyMs = Date.now() - started;

				if (!Number.isFinite(applied) || applied === 0) {
					return check.down({
						message: "no migrations have been applied to this database",
						hint: "run `deployer start`, or the migrate command, before serving",
						latencyMs,
					});
				}

				return check.up({ applied, latest: row?.latest ?? null, latencyMs });
			});
		}
	};
}
