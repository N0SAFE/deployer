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
 *
 * Every method on the instance is wrapped, **including inherited ones**: `Object.entries` only walks
 * own enumerable properties, so a `live` class — whose operations are on the prototype — came back
 * empty and every call failed with `is not a function`.
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
    // `Reflect.ownKeys` walks the prototype chain, unlike `Object.entries`.
    for (
        let current: object | null = service;
        current !== null && current !== Object.prototype;
        current = Object.getPrototypeOf(current) as object | null
    ) {
        for (const key of Object.getOwnPropertyNames(current)) {
            if (key === 'constructor' || key in bound) continue
            const value: unknown = Reflect.get(service, key)
            if (typeof value !== 'function') continue
            bound[key] = (...args: unknown[]) =>
                provide(
                    (
                        value as (
                            ...a: unknown[]
                        ) => Effect.Effect<unknown, unknown>
                    ).apply(service, args)
                )
        }
    }
    for (const key of Object.keys(service)) {
        if (key in bound) continue
        const value: unknown = Reflect.get(service, key)
        bound[key] = value
    }
    return bound as never
}
