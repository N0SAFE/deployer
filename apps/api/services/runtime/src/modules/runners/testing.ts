import { Cause, Effect, Exit } from "effect";

/** Run an Effect and reject with the ORIGINAL failure, so `rejects` assertions read the real error. */
export async function run<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect);
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
}
