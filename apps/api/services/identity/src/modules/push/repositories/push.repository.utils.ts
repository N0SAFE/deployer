import { Effect } from "effect";

import { PushRepositoryFailure } from "../push.failures";

/** One async database boundary; driver errors become `PushRepositoryFailure`. */
export function attempt<T>(operation: () => Promise<T>): Effect.Effect<T, PushRepositoryFailure> {
	return Effect.tryPromise({
		try: operation,
		catch: (cause) => new PushRepositoryFailure({ cause }),
	});
}
