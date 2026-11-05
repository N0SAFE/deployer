import { Cause, Effect } from 'effect'

/**
 * Lift a Promise-returning call to a platform collaborator.
 *
 * The shared platform services are still Promise-based and refuse with their own error classes
 * (Nest exceptions, `AppError`, mesh errors). The failure is kept as thrown, and fleet's the `.effect()` boundary
 * lets it through unchanged so the host's interceptors translate it exactly as they always did;
 * the domain's own refusals are `Fleet*` errors, which the `.effect()` boundary maps by kind.
 */
export function attempt<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
    return Effect.tryPromise({ try: run, catch: (cause) => cause })
}

/** Lift a synchronous call that may throw; same failure contract as `attempt`. */
export function attemptSync<A>(run: () => A): Effect.Effect<A, unknown> {
    return Effect.try({ try: run, catch: (cause) => cause })
}

/** What `recover` hands its handler: the failure, or the defect, as thrown. */
export function describeFailure(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/**
 * Run a step that must not fail its caller. A failure or a defect goes to `onFailure` (with the
 * value as thrown), which answers instead; an interruption still interrupts.
 */
export function recover<A, E, R, B, R2 = never>(
    effect: Effect.Effect<A, E, R>,
    onFailure: (error: unknown) => Effect.Effect<B, never, R2>
): Effect.Effect<A | B, never, R | R2> {
    return Effect.catchCause(effect, (cause) =>
        Cause.hasInterrupts(cause)
            ? Effect.failCause(cause as Cause.Cause<never>)
            : onFailure(Cause.squash(cause))
    )
}
