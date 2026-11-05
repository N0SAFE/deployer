import { connect as tcpConnect } from "node:net";

import { Context, Effect } from "effect";

import type { Pool } from "pg";

import { DEFAULT_CHECK_TIMEOUT_MS } from "./checks";
import { WAIT_FOR_DEPENDENCIES, runPreflight, type PreflightPolicy } from "./runner";
import {
	PreflightDependency,
	formatPreflightReport,
	type CheckContext,
	type PreflightReport,
} from "./types";



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
export type PreflightServiceShape = {
	/** Runs the checks once (the verdict is cached) and logs the report. Never fails: a dependency that is not up is in the report. */
	readonly run: () => Effect.Effect<PreflightReport>;
	/** The readiness answer: false until a run succeeded. */
	readonly isReady: () => Effect.Effect<boolean>;
	readonly reportOrNull: () => PreflightReport | null;
};

type Ports = {
	readonly dependencies: readonly PreflightDependency[];
	readonly policy: PreflightPolicy | null;
	/**
	 * `undefined`/`null` when the app binds no pool: an app that declares a database dependency without wiring one must get
	 * a clear message rather than an internal TypeError. It is the raw `pg.Pool` (not the Drizzle handle): the check runs
	 * `SELECT 1` before any schema is known.
	 */
	readonly pool: Pool | null | undefined;
};

export function makePreflightService({ dependencies, policy, pool }: Ports): PreflightServiceShape {
	let verdict: PreflightReport | null = null;

	const report = (result: PreflightReport) => {
		const lines = formatPreflightReport(result);
		if (result.ready) {
			return Effect.logInfo(`Dependencies ready (${String(result.durationMs)}ms)`).pipe(
				Effect.andThen(Effect.forEach(lines, (line) => Effect.logInfo(line), { discard: true })),
			);
		}
		// A failed preflight is FATAL, not a warning: the app was started against dependencies that are not there, and
		// serving would mean failing every request with a less useful error. Exiting lets the orchestrator (or the swarm)
		// see a dead task and act, instead of a live one that lies.
		return Effect.logError(`Dependencies NOT ready after ${String(result.durationMs)}ms`).pipe(
			Effect.andThen(Effect.forEach(lines, (line) => Effect.logError(line), { discard: true })),
		);
	};

	const buildContext = (): CheckContext => ({
		env: (key) => process.env[key],
		query: async (sql) => {
			if (pool === undefined || pool === null) {
				throw new Error("no database pool is bound — declare DatabaseModule (or provide GLOBAL_DATABASE_POOL) in this app's root module");
			}
			const result = await pool.query<Record<string, unknown>>(sql);
			return result.rows;
		},
		tcp: (host, port, timeoutMs) =>
			new Promise<void>((resolve, reject) => {
				const socket = tcpConnect({ host, port });
				// Bounded: a connect to a black-holed host must fail the check, not hang the boot past its own deadline.
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
		// `console` rather than the app logger: preflight retries log DURING boot, and this is the one place a dependency
		// failure must be visible even if the logger itself failed to configure.
		log: (message) => {
			console.log(`[preflight] ${message}`);
		},
	});

	return {
		run: () =>
			Effect.gen(function* () {
				if (verdict !== null) return verdict;

				if (dependencies.length === 0) {
					verdict = { ready: true, results: [], durationMs: 0 };
					return verdict;
				}

				const result = yield* Effect.promise(() =>
					runPreflight({ context: buildContext(), dependencies, policy: policy ?? WAIT_FOR_DEPENDENCIES }),
				);
				verdict = result;
				yield* report(result);
				return result;
			}),
		isReady: () => Effect.sync(() => verdict?.ready ?? false),
		reportOrNull: () => verdict,
	};
}

export class PreflightService extends Context.Service<PreflightService, PreflightServiceShape>()("shared/PreflightService") {}

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
