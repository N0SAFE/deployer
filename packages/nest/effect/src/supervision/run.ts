import { Effect } from "effect";

/**
 * Lifts a Promise-returning call into an Effect that fails with whatever it threw. The Nest
 * subclasses' `reconcile`/`probe` take no signal, so interrupting this stops waiting for them but
 * cannot cancel them; the Effect-native supervisors will.
 */
export const attempt = <A>(run: () => Promise<A>): Effect.Effect<A, unknown> =>
	Effect.tryPromise({ try: run, catch: (cause) => cause });
