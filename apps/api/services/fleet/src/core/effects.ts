import { Effect } from 'effect'

/**
 * Lift a Promise-returning call to a platform collaborator.
 *
 * The shared platform services are still Promise-based and refuse with their own error classes
 * (Nest exceptions, `AppError`, mesh errors). The failure is kept as thrown, and fleet's `serve`
 * lets it through unchanged so the host's interceptors translate it exactly as they always did;
 * the domain's own refusals are `Fleet*` errors, which `serve` maps by kind.
 */
export function attempt<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
    return Effect.tryPromise({ try: run, catch: (cause) => cause })
}

/** Lift a synchronous call that may throw; same failure contract as `attempt`. */
export function attemptSync<A>(run: () => A): Effect.Effect<A, unknown> {
    return Effect.try({ try: run, catch: (cause) => cause })
}
