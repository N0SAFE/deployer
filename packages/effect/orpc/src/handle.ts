import { Correlation } from "@deployer/effect-core";
import { ORPCError } from "@orpc/client";
import { Cause, Effect } from "effect";

import { catchDomainErrors } from "./map-domain-error";

/** Observer for the full cause of a defect; the wire only ever sees the correlation id. */
export type DefectLogger = (cause: Cause.Cause<unknown>, correlationId: string) => void;

/**
 * The handler boundary: domain errors become oRPC errors, defects and unexpected failures become
 * `INTERNAL_SERVER_ERROR` carrying only the correlation id, and the full cause goes to `onDefect`.
 * Interruption is left alone so oRPC turns it into the abort.
 */
export const handle =
	(onDefect: DefectLogger) =>
	<A, E, R>(
		effect: Effect.Effect<A, E, R>,
	): Effect.Effect<A, ORPCError<string, unknown>, Exclude<R, Correlation> | Correlation> =>
		catchDomainErrors(effect).pipe(
			Effect.catchCause((cause) =>
				Cause.hasInterrupts(cause) && !Cause.hasFails(cause)
					? Effect.failCause(cause as Cause.Cause<never>)
					: Effect.gen(function* () {
							const failure = Cause.findErrorOption(cause);
							if (failure._tag === "Some" && failure.value instanceof ORPCError) {
								return yield* Effect.fail(failure.value);
							}
							const { id } = yield* Correlation;
							onDefect(cause, id);
							return yield* Effect.fail(
								new ORPCError("INTERNAL_SERVER_ERROR", { data: { correlationId: id } }),
							);
						}),
			),
		) as never;
