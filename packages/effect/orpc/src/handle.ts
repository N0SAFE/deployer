import { ORPCError } from "@orpc/client";
import { Cause, Effect } from "effect";

import { Correlation } from "@deployer/effect-core";
import type { DomainError } from "@deployer/effect-core";

import { catchDomainErrors } from "./map-domain-error";

/** Observer for the full cause of a defect; the wire only ever sees the correlation id. */
export type DefectLogger = (cause: Cause.Cause<unknown>, correlationId: string) => void;

/**
 * The handler boundary: domain errors become oRPC errors, defects and unexpected failures become
 * `INTERNAL_SERVER_ERROR` carrying only the correlation id, and the full cause goes to `onDefect`.
 * Interruption is left alone so oRPC turns it into the abort.
 */
export type HandleOptions = {
	/**
	 * Let a typed failure that is not a domain error propagate unchanged instead of answering it as
	 * `INTERNAL_SERVER_ERROR`. For services still calling Promise-based collaborators that refuse with
	 * their own error classes (Nest exceptions, platform errors): the host's interceptors translate
	 * those. Defects are still hidden behind the correlation id.
	 */
	readonly passThroughFailures?: boolean;
	/**
	 * Where a domain error's server-side `cause` is reported. The wire never carries it; without this
	 * a failing dependency (`HealthCheckFailed` with a registry error) leaves no trace at all.
	 * Defaults to one `console.error` line with the tag and the correlation id.
	 */
	readonly onDomainCause?: (cause: unknown, tag: string, correlationId: string) => void;
};

const reportDomainCause = (error: DomainError, correlationId: string, options: HandleOptions): void => {
	const cause = (error as { readonly cause?: unknown }).cause;
	if (cause === undefined) return;

	const report =
		options.onDomainCause ??
		((value: unknown, tag: string, id: string) => {
			console.error(`[domain] ${tag} failed (correlation ${id})`, value);
		});

	report(cause, error._tag, correlationId);
};

export const handle =
	(onDefect: DefectLogger, options: HandleOptions = {}) =>
	<A, E, R>(
		effect: Effect.Effect<A, E, R>,
	): Effect.Effect<A, ORPCError<string, unknown>, Exclude<R, Correlation> | Correlation> =>
		Effect.gen(function* () {
			const { id } = yield* Correlation;
			return yield* catchDomainErrors(effect, (error) => { reportDomainCause(error, id, options); });
		}).pipe(
			Effect.catchCause((cause) =>
				Cause.hasInterrupts(cause) && !Cause.hasFails(cause)
					? Effect.failCause(cause as Cause.Cause<never>)
					: Effect.gen(function* () {
							const failure = Cause.findErrorOption(cause);
							if (failure._tag === "Some" && failure.value instanceof ORPCError) {
								return yield* Effect.fail(failure.value);
							}
							if (options.passThroughFailures === true && failure._tag === "Some") {
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
