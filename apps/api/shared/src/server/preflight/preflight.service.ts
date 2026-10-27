import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Pool } from "pg";
import { connect as tcpConnect } from "node:net";
import { GLOBAL_DATABASE_POOL } from "@deployer/nest-database-core/database-connection";

import { DEFAULT_CHECK_TIMEOUT_MS } from "./checks";
import { WAIT_FOR_DEPENDENCIES, runPreflight, type PreflightPolicy } from "./runner";
import {
	PreflightDependency,
	formatPreflightReport,
	type CheckContext,
	type PreflightReport,
} from "./types";

/**
 * The dependency set `forRoot` registers this service against.
 *
 * An opaque token rather than a bare array so a module cannot accidentally
 * satisfy the constructor with some unrelated array of strings.
 */
export const PREFLIGHT_DEPENDENCIES = Symbol("api-server:preflight-dependencies");

/** Policy token, so an app can choose to report rather than wait. */
export const PREFLIGHT_POLICY = Symbol("api-server:preflight-policy");

/**
 * Proves an app's dependencies are ready, and answers readiness for it.
 *
 * ── WHY THE VERDICT IS CACHED, AND WHY THAT IS NOT STALE ────────────────────
 * The check runs ONCE, at boot, and its verdict is what `/health/ready` reports.
 * An earlier design re-ran the suite per probe, which is wrong twice over: it
 * runs a query against the database every 15 seconds forever (the probe interval
 * is a compose/swarm setting this process does not control), and it makes a
 * transient blip look like a decision.
 *
 * A dependency that fails AFTER boot is a different condition with a different
 * owner: the swarm restarts the task, and `deployer status` reports the roll-up.
 * Boot readiness answers "may traffic be routed here?", which is a question about
 * startup, not about the present.
 *
 * ── WHY IT IS NOT RUN FROM `onApplicationBootstrap` ─────────────────────────
 * It is invoked by `bootstrapApiServer` AFTER the port is bound. Running it from
 * a lifecycle hook would block `app.init()`, so the port would not exist while
 * dependencies were still coming up — and a swarm healthcheck probing a
 * not-yet-bound port reports the task as dead and restarts it, which is exactly
 * the failure this ordering avoids.
 */
@Injectable()
export class PreflightService {
	private readonly logger = new Logger("Preflight");
	private verdict: PreflightReport | null = null;

	constructor(
		@Inject(PREFLIGHT_DEPENDENCIES) private readonly dependencies: readonly PreflightDependency[],
		@Optional() @Inject(PREFLIGHT_POLICY) private readonly policy: PreflightPolicy | null,
		// `undefined` when the app binds no pool: `@Optional()` produces `undefined`,
		// not `null`, and an app that declares a database dependency without wiring
		// one must get a clear message rather than an internal TypeError.
		// ── WHY THIS INJECTS THE POOL AND NOT THE CONNECTION ────────────────────
		// `GLOBAL_DATABASE_CONNECTION` is the DRIZZLE handle (a query builder), while
		// `GLOBAL_DATABASE_POOL` is the raw `pg.Pool`. This check runs `SELECT 1` before any
		// schema is known, so it needs the pool — and injecting the connection produced a
		// failure that named the wrong thing entirely:
		//
		//   ✗ database  this.pool.query is not a function
		//
		// That reads as "the pool is broken" when the truth was "the pool was never
		// injected". The message below is kept specific for the same reason.
		@Optional() @Inject(GLOBAL_DATABASE_POOL) private readonly pool: Pool | null | undefined,
	) {}

	/**
	 * Run the checks and report. Safe to call twice — the second call returns the
	 * first verdict rather than re-probing.
	 */
	async run(): Promise<PreflightReport> {
		if (this.verdict !== null) return this.verdict;

		if (this.dependencies.length === 0) {
			this.verdict = { ready: true, results: [], durationMs: 0 };
			return this.verdict;
		}

		const report = await runPreflight({
			context: this.buildContext(),
			dependencies: this.dependencies,
			policy: this.policy ?? WAIT_FOR_DEPENDENCIES,
		});

		this.verdict = report;
		this.report(report);
		return report;
	}

	/**
	 * The readiness answer, for binding as `SERVICE_READINESS`.
	 *
	 * `false` before {@link run} — an app that has not proved its dependencies
	 * must not be routed to, and "not ready yet" is the honest answer.
	 */
	async isReady(): Promise<boolean> {
		return this.verdict?.ready ?? false;
	}

	/** The last verdict, or `null` if preflight has not run. */
	reportOrNull(): PreflightReport | null {
		return this.verdict;
	}

	private report(report: PreflightReport): void {
		const lines = formatPreflightReport(report);
		if (report.ready) {
			this.logger.log(`Dependencies ready (${String(report.durationMs)}ms)`);
			for (const line of lines) this.logger.log(line);
			return;
		}
		// A failed preflight is FATAL, not a warning: the app was started against
		// dependencies that are not there, and serving would mean failing every
		// request with a less useful error. Exiting lets the orchestrator (or the
		// swarm) see a dead task and act, instead of a live one that lies.
		this.logger.error(`Dependencies NOT ready after ${String(report.durationMs)}ms`);
		for (const line of lines) this.logger.error(line);
	}

	/**
	 * The real context: the app's own pool, a real TCP connect, and `process.env`.
	 *
	 * `process.env` directly — not `EnvService` — because preflight runs during
	 * boot, and the checks must be able to report a missing/invalid environment
	 * rather than depend on the module that validates it having already loaded.
	 */
	private buildContext(): CheckContext {
		return {
			env: (key) => process.env[key],
			query: async (sql) => {
				// `@Optional()` injects `undefined` (not `null`) when no provider
				// exists, so both must be rejected — otherwise the check falls through
				// and throws "cannot read properties of undefined", which reports an
				// internal error where an actionable one belongs.
				if (this.pool === undefined || this.pool === null) {
					throw new Error(
						"no database pool is bound — declare DatabaseModule (or provide GLOBAL_DATABASE_POOL) in this app's root module",
					);
				}
				const result = await this.pool.query<Record<string, unknown>>(sql);
				return result.rows;
			},
			tcp: (host, port, timeoutMs) =>
				new Promise<void>((resolve, reject) => {
					const socket = tcpConnect({ host, port });
					// Bounded: a connect to a black-holed host must fail the check, not
					// hang the boot past its own deadline.
					socket.setTimeout(timeoutMs);
					socket.once("connect", () => {
						socket.destroy();
						resolve();
					});
					socket.once("timeout", () => {
						socket.destroy();
						reject(new Error(`connect to ${host}:${String(port)} timed out after ${String(timeoutMs)}ms`));
					});
					socket.once("error", (error) => {
						socket.destroy();
						reject(error);
					});
				}),
			// `console` rather than the app logger: preflight retries log DURING
			// boot, and this is the one place a dependency failure must be visible
			// even if the logger itself failed to configure.
			log: (message) => { console.log(`[preflight] ${message}`); },
		};
	}
}

/**
 * The dependency sets the platform's apps declare.
 *
 * Named rather than inlined at each call site so "what does the BFF need?" has
 * exactly one answer, and a change to it is a change in one place.
 */
export const DEPENDENCIES = {
	/** An app that only serves other services: it needs its own liveness and nothing external. */
	none: [] as readonly PreflightDependency[],

	/** Reads the global Postgres and the schema must already be migrated. */
	database: [PreflightDependency.Database, PreflightDependency.Migrations] as const,

	/** The full set: Postgres (+schema) and Redis. */
	platform: [
		PreflightDependency.Database,
		PreflightDependency.Migrations,
		PreflightDependency.Redis,
	] as const,
} as const;

export { DEFAULT_CHECK_TIMEOUT_MS };
