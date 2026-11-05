import { Context, Effect, Option, Ref } from 'effect'

import { AccessPolicy } from './policy'

/**
 * Where a handler reports that it decided. Provided per request around an `accessDeferred` procedure only, so a normal
 * procedure pays nothing and `Resource.require(...)` finds it with `serviceOption`.
 */
export class DecisionLedger extends Context.Service<
    DecisionLedger,
    { readonly decided: () => Effect.Effect<void> }
>()('access/DecisionLedger') {}

/** An `accessDeferred` middleware ran: the handler promised to decide. */
function isDeferred(context: unknown): boolean {
    if (context === null || typeof context !== 'object') return false
    const access: unknown = Reflect.get(context, 'access')
    return (
        access !== null &&
        typeof access === 'object' &&
        Reflect.get(access, 'deferred') !== undefined
    )
}

/**
 * Hold a deferred procedure to its promise: if its handler finishes without a single `Resource.require(...)`, that is a
 * defect in enforce mode (the boundary hides it behind a correlation id) and a warning in shadow mode. Other procedures
 * are returned untouched.
 */
export function trackDecisions<A, E, R>(
    context: unknown,
    effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> {
    if (!isDeferred(context)) return effect
    return Effect.gen(function* () {
        const decisions = yield* Ref.make(0)
        const result = yield* effect.pipe(
            Effect.provideService(DecisionLedger, {
                decided: () => Ref.update(decisions, (n) => n + 1),
            })
        )
        if ((yield* Ref.get(decisions)) === 0) {
            const message =
                'access never decided: an accessDeferred procedure finished without a Resource.require(...)'
            const policy = yield* Effect.serviceOption(AccessPolicy)
            if (Option.isSome(policy) && policy.value.mode === 'enforce') {
                return yield* Effect.die(new Error(message))
            }
            yield* Effect.logWarning(message)
        }
        return result
    })
}
