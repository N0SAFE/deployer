import { Cause, Effect, Exit } from "effect";

/**
 * Runs a synchronous Effect at a boundary that can only call plain functions (a drizzle column
 * codec, a config loader) and throws the ORIGINAL failure, not a fiber wrapper, so callers can
 * match on its `_tag`. It cannot run an Effect that is actually asynchronous.
 */
export const runSyncUnwrapped = <A, E>(effect: Effect.Effect<A, E>): A => {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};

/**
 * Runs an Effect for a Promise caller, rejecting with the original failure rather than a fiber wrapper.
 * An aborted `signal` interrupts the Effect.
 */
export const runPromiseUnwrapped = async <A, E>(
  effect: Effect.Effect<A, E>,
  options?: { readonly signal?: AbortSignal | undefined },
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect, options?.signal === undefined ? undefined : { signal: options.signal });
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};
