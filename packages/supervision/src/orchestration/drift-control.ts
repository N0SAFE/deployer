import { Effect } from "effect";

import type { AnySupervisor } from "../supervisor/supervisor";

/**
 * How often supervisors that reported a failure are tried again.
 *
 * Boot convergence runs once, but the API starts before setup has provisioned the database, so
 * every supervisor that touches it can lose that race by seconds and then stay degraded forever:
 * readiness stayed red and setup never handed over. Retrying degraded supervisors is what makes a
 * five-second race survivable. Only `degraded` ones are retried: `pending` has its own recovery (its
 * blocker is re-evaluated on every call) and `converged` needs nothing.
 */
export const DEGRADED_RETRY_INTERVAL_MS = 15_000;

/**
 * How often every supervisor is converged again, including the ones reporting `converged`.
 *
 * `converged` is not "nothing to do": a resource removed behind the platform's back (a service
 * deleted by hand, one lost to an engine restart) leaves its supervisor reporting `converged`
 * forever, because its last convergence did succeed. `converge` is idempotent exactly so it can be
 * re-run. Slow on purpose: this is drift correction, not liveness.
 */
export const RECONCILE_SWEEP_INTERVAL_MS = 60_000;

/** Converges every supervisor in parallel; a failure in one never reaches the others. */
export const convergeAll = (supervisors: readonly AnySupervisor[]) =>
	Effect.forEach(
		supervisors,
		(supervisor) => supervisor.ensureDesiredState.pipe(Effect.map((state) => [supervisor.id, state] as const)),
		{ concurrency: "unbounded" },
	);

/** One pass over the degraded supervisors; the ids that recovered. */
export const retryDegraded = (supervisors: readonly AnySupervisor[]) =>
	Effect.gen(function* () {
		const states = yield* Effect.forEach(
			supervisors,
			(supervisor) => supervisor.getStateSnapshot.pipe(Effect.map((snapshot) => [supervisor, snapshot.state] as const)),
		);
		const degraded = states.filter(([, state]) => state === "degraded").map(([supervisor]) => supervisor);
		const retried = yield* convergeAll(degraded);
		const recovered = retried.filter(([, state]) => state === "converged").map(([id]) => id);
		for (const id of recovered) yield* Effect.logInfo(`✅ Supervisor "${id}" recovered on retry`);
		return recovered;
	});

/** Runs `pass` every `intervalMs` for as long as the fiber lives; a pass that fails is logged, not fatal. */
export const everyInterval = (label: string, intervalMs: number, pass: Effect.Effect<unknown, unknown>) =>
	Effect.sleep(intervalMs).pipe(
		Effect.flatMap(() => pass),
		Effect.catch((error) => Effect.logWarning(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)),
		Effect.forever,
	);
