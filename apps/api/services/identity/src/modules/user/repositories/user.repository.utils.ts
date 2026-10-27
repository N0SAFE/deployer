import { Effect } from "effect";

import { UserRepositoryFailure } from "../user.failures";

/** One async database boundary; driver errors become `UserRepositoryFailure`. */
export function attempt<T>(operation: () => Promise<T>): Effect.Effect<T, UserRepositoryFailure> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) => new UserRepositoryFailure({ cause }),
  });
}
