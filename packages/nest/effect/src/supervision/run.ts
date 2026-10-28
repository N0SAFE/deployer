import { Cause, Effect, Exit } from "effect";

/** Runs an Effect for a Promise caller, rejecting with the original failure rather than a wrapper. */
export async function runUnwrapped<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

/**
 * Lifts a Promise-returning call into an Effect that fails with whatever it threw. The Nest
 * subclasses' `reconcile`/`probe` take no signal, so interrupting this stops waiting for them but
 * cannot cancel them; the Effect-native supervisors will.
 */
export const attempt = <A>(run: () => Promise<A>): Effect.Effect<A, unknown> =>
	Effect.tryPromise({ try: run, catch: (cause) => cause });
