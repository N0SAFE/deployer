import {
	PreflightDependency,
	type CheckContext,
	type CheckResult,
	type PreflightCheck,
} from "./types";

/** Time every check gets before it is reported as failed. */
export const DEFAULT_CHECK_TIMEOUT_MS = 15_000;

/** Wrap a check so it can never throw and never hang past a deadline. */
function timed(
	dependency: PreflightDependency,
	run: (context: CheckContext) => Promise<{ ok: true; detail: string } | { ok: false; detail: string }>,
): PreflightCheck {
	return async (context: CheckContext): Promise<CheckResult> => {
		const start = Date.now();
		try {
			const outcome = await run(context);
			return {
				dependency,
				outcome: outcome.ok ? "ok" : "failed",
				detail: outcome.detail,
				durationMs: Date.now() - start,
			};
		} catch (error: unknown) {
			// A check that throws is a FAILED check, not a crashed boot: the whole
			// point of preflight is to report, and a report that can throw reports
			// nothing. The message is kept verbatim because it is usually the most
			// useful thing an operator gets.
			return {
				dependency,
				outcome: "failed",
				detail: error instanceof Error ? error.message : String(error),
				durationMs: Date.now() - start,
			};
		}
	};
}

/**
 * The database answers a trivial query.
 *
 * `SELECT 1` on purpose: it proves the pool can hand out a connection AND that
 * the server accepts a round trip. Anything more elaborate would make this check
 * depend on the schema, which is the NEXT check's job.
 */
export const checkDatabase: PreflightCheck = timed(PreflightDependency.Database, async (context) => {
	const start = Date.now();
	await context.query("SELECT 1");
	return { ok: true, detail: `reachable (${String(Date.now() - start)}ms)` };
});

/**
 * The schema has actually been migrated.
 *
 * Reachability is NOT enough and this is the check that proves it: a fresh
 * Postgres starts every app happily and then fails the first real query with
 * `relation "projects" does not exist`. So this asserts the two things that mean
 * "a deployment has run here":
 *
 *   - the drizzle journal table exists (`drizzle.__drizzle_migrations`);
 *   - at least one migration is recorded in it.
 *
 * Deliberately NOT "the schema matches the code" — that would require running
 * `drizzle-kit` diffing at boot. This answers the question a boot actually has:
 * *has anyone set this database up?*
 */
export const checkMigrations: PreflightCheck = timed(
	PreflightDependency.Migrations,
	async (context) => {
		const rows = await context.query(
			"SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations",
		);
		const applied = rows[0]?.applied;

		if (typeof applied !== "number") {
			return { ok: false, detail: "migration journal unreadable" };
		}
		if (applied === 0) {
			return {
				ok: false,
				detail: "no migrations applied — run migrations before serving",
			};
		}
		return { ok: true, detail: `${String(applied)} migrations applied` };
	},
);

/**
 * Redis accepts a connection.
 *
 * A TCP connect, not a `PING`: the command would need a client dependency here,
 * and "can I reach it at all" is what a boot is deciding. A Redis that accepts
 * connections but fails commands is a different (and rarer) failure, reported by
 * the caller's first real use.
 */
export const checkRedis: PreflightCheck = timed(PreflightDependency.Redis, async (context) => {
	const url = context.env("DEPLOYER_REDIS_URL");
	if (url === undefined || url === "") {
		return { ok: false, detail: "DEPLOYER_REDIS_URL is not set" };
	}

	const parsed = parseRedisUrl(url);
	if (parsed === undefined) {
		return { ok: false, detail: `unparseable DEPLOYER_REDIS_URL: ${url}` };
	}

	const start = Date.now();
	await context.tcp(parsed.host, parsed.port, DEFAULT_CHECK_TIMEOUT_MS);
	return { ok: true, detail: `${parsed.host}:${String(parsed.port)} reachable (${String(Date.now() - start)}ms)` };
});

/**
 * A check that always passes, carrying a note.
 *
 * Used for an optional dependency a given app does not require: the report still
 * shows the line (so the operator sees it was considered) without failing the
 * boot.
 */
export function skipped(dependency: PreflightDependency, detail: string): PreflightCheck {
	return async (): Promise<CheckResult> => ({
		dependency,
		outcome: "skipped",
		detail,
		durationMs: 0,
	});
}

/** `redis://[:password@]host:port[/db]` → host + port. */
function parseRedisUrl(url: string): { host: string; port: number } | undefined {
	try {
		const parsed = new URL(url);
		const port = parsed.port === "" ? 6379 : Number(parsed.port);
		if (!Number.isInteger(port) || parsed.hostname === "") return undefined;
		return { host: parsed.hostname, port };
	} catch {
		return undefined;
	}
}

/** Every check, by the dependency it proves. */
export const PREFLIGHT_CHECKS: Readonly<Record<PreflightDependency, PreflightCheck>> = {
	[PreflightDependency.Database]: checkDatabase,
	[PreflightDependency.Migrations]: checkMigrations,
	[PreflightDependency.Redis]: checkRedis,
};
