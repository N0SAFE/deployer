/**
 * Preflight: proving an app's DEPENDENCIES are ready before it claims to serve.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * "Did the process start?" and "can it do its job?" are different questions, and
 * conflating them is how a boot reports success while every request fails. A
 * service whose database does not exist yet is RUNNING and USELESS: Nest resolves
 * the graph, the port binds, `/health` returns 200, and the first query throws
 * `relation "projects" does not exist`.
 *
 * So starting an app is a two-part claim, and the parts are checked separately:
 *
 *   1. the app assembled — Nest DI resolved, modules loaded     (Nest does this)
 *   2. its dependencies are usable — DB reachable, schema applied, Redis up
 *                                                              (this module)
 *
 * Only when (2) passes does the app report READY, and only READY gates traffic
 * (`/health/ready` → 503 until then).
 *
 * ── WHY THE CHECKS ARE PURE ─────────────────────────────────────────────────
 * The same checks are needed by two very different callers:
 *
 *   - each app, at boot, deciding whether it may serve
 *     (`PreflightService.assertReady`);
 *   - the CLI, as the orchestrator, deciding whether to bring a service up and
 *     reporting what is missing when it will not (`deployer start` / `doctor`).
 *
 * Writing them as pure functions over an explicit {@link CheckContext} — no DI,
 * no Nest, no `pg` import — is what lets both callers share ONE definition of
 * "the database is ready" instead of drifting into two.
 */

/** A dependency an app can require before it may serve. */
export const PreflightDependency = {
	/** The Postgres the app reads/writes is reachable. */
	Database: "database",
	/** The schema has been MIGRATED — reachable is not enough; a table must exist. */
	Migrations: "migrations",
	/** The Redis the app coordinates through is reachable. */
	Redis: "redis",
} as const;

export type PreflightDependency = (typeof PreflightDependency)[keyof typeof PreflightDependency];

/** How a single check ended. */
export type CheckOutcome = "ok" | "failed" | "skipped";

/** The result of one check. Never throws — "not ready" is an answer. */
export type CheckResult = {
	readonly dependency: PreflightDependency;
	readonly outcome: CheckOutcome;
	/** One line an operator can act on. Present unless `skipped`. */
	readonly detail: string;
	/** How long the check took. */
	readonly durationMs: number;
}

/**
 * Everything a check is allowed to touch.
 *
 * Injected rather than imported so a check is a pure function of its inputs:
 * testable without a database, and reusable by the CLI, which has no Nest
 * container at all.
 */
export type CheckContext = {
	/** Read a key. Injected so a check never reaches for global `process.env`. */
	readonly env: (key: string) => string | undefined;
	/** Run one SQL statement and return its rows. */
	readonly query: (sql: string) => Promise<Record<string, unknown>[]>;
	/** Open and close a TCP connection, throwing when it cannot. */
	readonly tcp: (host: string, port: number, timeoutMs: number) => Promise<void>;
	/** Emit one line. Kept tiny on purpose — this runs during boot, pre-logger. */
	readonly log: (message: string) => void;
}

/** A dependency check. */
export type PreflightCheck = (context: CheckContext) => Promise<CheckResult>;

/**
 * What a caller must be told when preflight fails.
 *
 * Carries the individual results rather than a joined string: the CLI prints
 * them as a list, and a health endpoint returns them as data.
 */
export type PreflightReport = {
	readonly ready: boolean;
	readonly results: readonly CheckResult[];
	readonly durationMs: number;
}

/** Render a report as the operator-facing block both callers print. */
export function formatPreflightReport(report: PreflightReport): string[] {
	return report.results.map((result) => {
		const mark = result.outcome === "ok" ? "✓" : result.outcome === "skipped" ? "–" : "✗";
		return `${mark} ${result.dependency.padEnd(11)} ${result.detail}`;
	});
}
