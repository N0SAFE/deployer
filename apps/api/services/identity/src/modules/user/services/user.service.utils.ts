import { Effect } from "effect";

import { UserRepositoryFailure, UserServiceFailure } from "../user.failures";

/** Lift a synchronous rule into the Effect error channel. */
export function rule<T>(operation: () => T): Effect.Effect<T, UserServiceFailure> {
  return Effect.try({
    try: operation,
    catch: (cause) => new UserServiceFailure({ cause }),
  });
}

/** Collapse repository failures into the service's single error channel. */
export function mapErrors<A, R>(
  effect: Effect.Effect<A, UserServiceFailure | UserRepositoryFailure, R>,
): Effect.Effect<A, UserServiceFailure, R> {
  return effect.pipe(
    Effect.mapError((error) =>
      error instanceof UserServiceFailure
        ? error
        : new UserServiceFailure({ cause: error.cause }),
    ),
  );
}
