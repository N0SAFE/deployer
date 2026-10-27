import { Effect } from "effect";

import { PushRepositoryFailure, PushServiceFailure } from "../push.failures";

/** Lift a synchronous rule into the Effect error channel. */
export function rule<T>(operation: () => T): Effect.Effect<T, PushServiceFailure> {
	return Effect.try({
		try: operation,
		catch: (cause) => new PushServiceFailure({ cause }),
	});
}

/** Collapse repository failures into the service's single error channel. */
export function mapErrors<A, R>(
	effect: Effect.Effect<A, PushServiceFailure | PushRepositoryFailure, R>,
): Effect.Effect<A, PushServiceFailure, R> {
	return effect.pipe(
		Effect.mapError((error) =>
			error instanceof PushServiceFailure ? error : new PushServiceFailure({ cause: error.cause }),
		),
	);
}
