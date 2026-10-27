import { Injectable, Logger } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { Inject, Optional } from "@nestjs/common";
import { Pool } from "pg";
import { GLOBAL_DATABASE_POOL } from "@deployer/nest-database-core/database-connection";

import type { IndicatorResult } from "../types";

/**
 * The Postgres check — a REAL round trip, not a presence test.
 *
 * ── WHAT MAKES THIS "REAL" ──────────────────────────────────────────────────
 * It does three things a naive check does not:
 *
 *   1. runs an actual statement through the app's OWN pool (so it proves the
 *      pool is usable, not just that some host answers on 5432);
 *   2. reads the SERVER VERSION, so the payload says WHICH database answered —
 *      the thing that tells you a compose stack is pointed at the wrong one;
 *   3. reports latency, so a database that answers slowly is visible BEFORE it
 *      starts failing.
 *
 * ── WHY IT NEVER THROWS ─────────────────────────────────────────────────────
 * A health check that throws when a dependency is down has hidden the diagnosis
 * it exists to provide. Every failure becomes `indicator.down({ message })`,
 * which Terminus renders as `{ database: { status: "down", message } }` — the
 * shape a client and the Terminus UI already understand.
 */
@Injectable()
export class DatabaseHealthIndicator {
	private readonly logger = new Logger(DatabaseHealthIndicator.name);

	constructor(
		private readonly indicator: HealthIndicatorService,
		// ── THE POOL, NOT THE CONNECTION ────────────────────────────────────────
		// `GLOBAL_DATABASE_CONNECTION` is the DRIZZLE handle (a query builder) and
		// `GLOBAL_DATABASE_POOL` is the raw `pg.Pool`. This check issues a bare
		// `SELECT version()`, which only the pool can do — so injecting the
		// connection produced, on every boot:
		//
		//   this.pool.query is not a function
		//   (In 'this.pool.query("SELECT version() AS version")',
		//    'this.pool.query' is an instance of Object)
		//
		// That reads as "the pool is broken" when the truth was "the pool was
		// never injected", and it held `/health/ready` at 503 forever: preflight
		// retried `this.pool.query` a hundred times and never once touched
		// Postgres. Every service was therefore permanently unhealthy and the BFF
		// that depends on them never started. `preflight.service.ts` injects the
		// pool for this exact reason; these indicators did not.
		@Optional() @Inject(GLOBAL_DATABASE_POOL) private readonly pool: Pool | null | undefined,
	) {}

	/** The indicator's name in the payload. */
	static readonly NAME = "database";

	async check(): Promise<IndicatorResult> {
		const check = this.indicator.check(DatabaseHealthIndicator.NAME);

		// `@Optional()` yields `undefined` (not `null`) when no pool is bound —
		// both must be rejected, or the check would throw a TypeError instead of
		// reporting the actionable cause.
		if (this.pool === undefined || this.pool === null) {
			return check.down({
				message: "no database pool is bound to this service",
				hint: "declare DatabaseModule in the service's root module",
			});
		}

		const started = Date.now();
		try {
			const result = await this.pool.query<{ version: string } & Record<string, unknown>>(
				"SELECT version() AS version",
			);
			const latencyMs = Date.now() - started;
			const version = result.rows[0]?.version;

			// The server banner is long ("PostgreSQL 16.4 (Debian …) on x86_64…");
			// the product + version is the useful part.
			const shortVersion =
				typeof version === "string" ? (version.split(" ").slice(0, 2).join(" ") || version) : "unknown";

			return check.up({ latencyMs, version: shortVersion });
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.debug(`database check failed: ${message}`);
			return check.down({
				message,
				latencyMs: Date.now() - started,
				// The classification the operator actually needs: "refused" and
				// "wrong password" have different fixes.
				cause: classifyDatabaseError(message),
			});
		}
	}
}

/** A short, actionable classification of a Postgres connection failure. */
function classifyDatabaseError(message: string): string {
	if (message.includes("ECONNREFUSED")) return "connection refused — is the database running?";
	if (message.includes("ETIMEDOUT") || /timeout/i.test(message)) return "connection timed out — check network/firewall";
	if (message.includes("ENOTFOUND")) return "hostname did not resolve — check DNS";
	if (/password|authentication/i.test(message)) return "authentication failed — check credentials";
	if (/does not exist/i.test(message)) return "database does not exist";
	return "database error";
}
