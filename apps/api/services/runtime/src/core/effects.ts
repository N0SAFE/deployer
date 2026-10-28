import { Effect } from 'effect'

/**
 * Lift a Promise-returning call to a collaborator that is not on Effect yet.
 *
 * The failure is kept as thrown, and runtime's `serve` lets it through unchanged so the host's
 * interceptors translate it exactly as they always did; the domain's own refusals are `Runtime*`
 * errors, which `serve` maps by kind.
 */
export function attempt<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
    return Effect.tryPromise({ try: run, catch: (cause) => cause })
}
