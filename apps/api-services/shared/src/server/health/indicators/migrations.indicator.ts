import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import type { Pool } from "pg";
import { Inject, Optional } from "@nestjs/common";
import { GLOBAL_DATABASE_CONNECTION } from "@deployer/nest-database-core/database-connection";

import type { IndicatorResult } from "../types";

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
@Injectable()
export class MigrationsHealthIndicator {
	constructor(
		private readonly indicator: HealthIndicatorService,
		@Optional() @Inject(GLOBAL_DATABASE_CONNECTION) private readonly pool: Pool | null | undefined,
	) {}

	static readonly NAME = "migrations";

	async check(): Promise<IndicatorResult> {
		const check = this.indicator.check(MigrationsHealthIndicator.NAME);

		if (this.pool === undefined || this.pool === null) {
			return check.down({
				message: "no database pool is bound to this service",
				hint: "declare DatabaseModule in the service's root module",
			});
		}

		const started = Date.now();
		try {
			const result = await this.pool.query<{ applied: number; latest: string | null }>(
				`SELECT count(*)::int AS applied, max(created_at)::text AS latest FROM ${MIGRATION_JOURNAL}`,
			);
			const row = result.rows[0];

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
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			// The most common cause by far is that the journal table does not
			// exist yet, which reads as a cryptic Postgres error. Say it plainly.
			const hint = /does not exist/i.test(message)
				? `the migration journal (${MIGRATION_JOURNAL}) is absent — this database has never been migrated`
				: undefined;
			return check.down({ message, ...(hint === undefined ? {} : { hint }), latencyMs: Date.now() - started });
		}
	}
}
