import { Effect } from 'effect'

/**
 * Lift a Promise-returning call to a collaborator that is not on Effect yet.
 *
 * The failure is kept as thrown, and runtime's the `.effect()` boundary lets it through unchanged so the host's
 * interceptors translate it exactly as they always did; the domain's own refusals are `Runtime*`
 * errors, which the `.effect()` boundary maps by kind.
 */
export function attempt<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
    return Effect.tryPromise({ try: run, catch: (cause) => cause })
}

/** What `lift` makes of one method: a Promise or a plain return becomes an Effect, an Observable stays as it is. */
export type Lifted<T, Streams extends keyof T = never> = {
    readonly [K in keyof T]: K extends Streams
        ? T[K]
        : T[K] extends (...args: infer A) => infer R
          ? (...args: A) => Effect.Effect<Awaited<R>, unknown>
          : T[K];
};

/**
 * Lift a record of Promise-bodied (or throwing) methods to Effect-returning ones; the failure stays as thrown, which is
 * how the `Runtime*` refusals reach the `.effect()` boundary. `streams` names the methods that return an RxJS Observable synchronously:
 * streaming is RxJS's surface, so those pass through untouched.
 */
export function lift<T extends { readonly [K in keyof T]: (...args: never[]) => unknown }, S extends keyof T = never>(
    impl: T,
    streams: readonly S[] = [],
): Lifted<T, S> {
    const out: Record<string, unknown> = {};
    for (const [name, fn] of Object.entries(impl) as [string, (...args: unknown[]) => unknown][]) {
        out[name] = (streams as readonly string[]).includes(name)
            ? fn
            : (...args: unknown[]) => attempt(() => new Promise<unknown>((resolve) => { resolve(fn(...args)); }));
    }
    return out as Lifted<T, S>;
}
