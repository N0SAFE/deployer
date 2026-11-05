import { Cause, Effect, Exit } from 'effect'

/** Run an Effect and reject with the ORIGINAL failure, so `rejects` assertions read the real error. */
export async function run<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

/**
 * A service whose Effect methods have their context requirements provided, so a spec calls it as if
 * it had been built over fakes. The service itself stays the constant the module provides.
 */
export function provideTo<T extends object>(
    service: T,
    provide: (
        effect: Effect.Effect<unknown, unknown>
    ) => Effect.Effect<unknown, unknown>
): {
    [K in keyof T]: T[K] extends (
        ...args: infer A
    ) => Effect.Effect<infer X, infer E, infer _R>
        ? (...args: A) => Effect.Effect<X, E>
        : T[K]
} {
    const bound: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(service)) {
        bound[key] =
            typeof value === 'function'
                ? (...args: unknown[]) =>
                      provide(
                          (
                              value as (
                                  ...a: unknown[]
                              ) => Effect.Effect<unknown, unknown>
                          )(...args)
                      )
                : value
    }
    return bound as never
}
