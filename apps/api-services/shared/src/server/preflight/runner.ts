import { PREFLIGHT_CHECKS } from "./checks";
import type {
	CheckContext,
	CheckResult,
	PreflightCheck,
	PreflightDependency,
	PreflightReport,
} from "./types";

/**
 * How a failed run should behave.
 *
 * The two callers want opposite things from the same checks, which is exactly
 * why the policy is an argument rather than baked in:
 *
 *   - BOOT waits: a dependency that is still starting (a swarm task being
 *     scheduled, a Postgres container initialising) is the normal case, and
 *     giving up immediately would turn a slow start into a failed one.
 *   - The CLI reports: an operator asking "is this node ready?" wants an answer
 *     NOW, not after a minute of retrying.
 */
export interface PreflightPolicy {
	/** Total time to keep retrying the whole suite before giving up. */
	readonly waitMs: number;
	/** Pause between attempts. */
	readonly retryEveryMs: number;
}

/** Never wait: run once and report. */
export const REPORT_ONLY: PreflightPolicy = { waitMs: 0, retryEveryMs: 0 };

/** Boot default: generous enough to cover a swarm task being placed. */
export const WAIT_FOR_DEPENDENCIES: PreflightPolicy = { waitMs: 60_000, retryEveryMs: 2_000 };

/**
 * Run every check, optionally retrying the whole suite until it passes.
 *
 * The suite is retried as a UNIT rather than per-check: dependencies start
 * together (a service's Postgres and Redis come up in the same scheduling
 * window), so re-checking only what failed buys nothing and makes the report
 * inconsistent between attempts.
 */
export async function runPreflight(options: {
	readonly context: CheckContext;
	readonly dependencies: readonly PreflightDependency[];
	readonly policy: PreflightPolicy;
	/** Resolve a dependency to its check. Defaults to the standard set. */
	readonly checks?: Readonly<Record<PreflightDependency, PreflightCheck>>;
}): Promise<PreflightReport> {
	const checks = options.checks ?? PREFLIGHT_CHECKS;
	const start = Date.now();
	const deadline = start + options.policy.waitMs;
	let results = await attempt(options.context, options.dependencies, checks);
	let attemptNumber = 1;

	while (!results.every(isPassing) && Date.now() < deadline) {
		options.context.log(
			`preflight attempt ${String(attemptNumber)} not ready — retrying in ${String(options.policy.retryEveryMs)}ms`,
		);
		await sleep(options.policy.retryEveryMs);
		results = await attempt(options.context, options.dependencies, checks);
		attemptNumber += 1;
	}

	return {
		ready: results.every(isPassing),
		results,
		durationMs: Date.now() - start,
	};
}

async function attempt(
	context: CheckContext,
	dependencies: readonly PreflightDependency[],
	checks: Readonly<Record<PreflightDependency, PreflightCheck>>,
): Promise<CheckResult[]> {
	// Sequential, not `Promise.all`: the report reads as a checklist, and a
	// database that is down should be reported BEFORE the schema check that
	// depends on it rather than racing it. The cost is negligible against a
	// connect timeout.
	const results: CheckResult[] = [];
	for (const dependency of dependencies) {
		results.push(await checks[dependency](context));
	}
	return results;
}

/** A skipped check is not a failure — it is a dependency the app does not need. */
function isPassing(result: CheckResult): boolean {
	return result.outcome !== "failed";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
