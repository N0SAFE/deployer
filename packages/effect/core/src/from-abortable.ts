import { Effect } from "effect";

/**
 * Lift a Promise-returning API into an Effect **that honours interruption**.
 *
 * The thunk receives the `AbortSignal` of the running fiber; pass it to the
 * underlying API (`fetch`, `fs`, `child_process`, a driver) so that cancelling
 * the fiber cancels the work instead of leaking it.
 *
 * This is the only sanctioned way to lift a Promise in L0-L3 code
 * (layers catalog rule 4): a bare `Effect.tryPromise({ try: () => ... })`
 * that ignores the signal makes cancellation a lie.
 *
 * The thunk must declare the `signal` parameter explicitly (`(signal) => ...`):
 * `Effect.tryPromise` decides whether to allocate an `AbortController` from the
 * function's declared arity.
 */
export const fromAbortable = <A, E>(
  attempt: (signal: AbortSignal) => PromiseLike<A>,
  mapError: (cause: unknown) => E,
): Effect.Effect<A, E> =>
  Effect.tryPromise({
    try: (signal) => attempt(signal),
    catch: mapError,
  });
