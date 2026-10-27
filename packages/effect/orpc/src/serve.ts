import { Actor } from "@deployer/effect-core";
import { standardErrorActions } from "@deployer/orpc-utils";
import { Cause, Effect } from "effect";

import { handle, type DefectLogger } from "./handle";
import { provideRequest, type RequestContextInput } from "./request-context";

export type ServeOptions = {
	/** Prefixes the defect log line, e.g. `svc-identity`. */
	readonly service: string;
	/** Where defects are written. Defaults to `console.error`. */
	readonly onDefect?: DefectLogger;
};

/**
 * The request boundary of one service.
 *
 * `serve(context)(effect)` provides `CurrentActor` and `Correlation`, maps domain errors by kind and
 * hides defects behind the correlation id. A caller with no actor is refused as unauthorized
 * (`requireAuth()` already guarantees one, so this is the belt to its braces). `serveAnonymous`
 * is for a public procedure: an anonymous caller acts as the `anonymous` user.
 */
export function createServe(options: ServeOptions) {
	const onDefect: DefectLogger =
		options.onDefect ??
		((cause, correlationId) => {
			console.error(`[${options.service}] defect ${correlationId}`, Cause.pretty(cause));
		});

	const serve =
		(context: RequestContextInput) =>
		<A, E, R>(effect: Effect.Effect<A, E, R>) =>
			effect.pipe(
				handle(onDefect),
				provideRequest(context, () => Effect.fail(standardErrorActions.UNAUTHORIZED("authentication required"))),
			);

	const serveAnonymous =
		(context: RequestContextInput) =>
		<A, E, R>(effect: Effect.Effect<A, E, R>) =>
			effect.pipe(
				handle(onDefect),
				provideRequest(context, () => Effect.succeed(Actor.user("anonymous", "anonymous"))),
			);

	return { serve, serveAnonymous } as const;
}
