import { ORPCError, os } from "@orpc/server";
import type { Context } from "effect";

/** Anything a `Context.Service` key structurally is. */
export type ServiceKey = { readonly Identifier: unknown; readonly key: string };

/** The `Context` identifier a service key registers. */
export type IdentifierOf<Key> = Key extends Context.Service<infer Identifier, infer _Shape>
	? Identifier
	: never;

/** Brands a context with its services so callers can infer them. */
declare const Services: unique symbol;

function middlewareFor<Services>() {
	return os.$context().middleware(({ context, next }) => {
		const effectContext = (
			context as unknown as { "effect/context"?: Context.Context<Services> }
		)["effect/context"];

		if (effectContext === undefined) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message:
					"effect/context is not configured — did the app pass a context to `ORPCModule.forRootAsync`?",
			});
		}

		return next({ context: { "effect/context": effectContext } });
	});
}

/**
 * A module's view of the request's Effect context.
 *
 * Runtime is the app's context, unchanged; `Services` is type-level only, so a handler can only `yield*` what its
 * module provides or imports.
 */
export type EffectContext<Services> = {
	readonly [Services]?: Services;
} & ReturnType<typeof middlewareFor<Services>>;

/** Type-directed builder for the module wrapper, which derives its services. */
export function effectContextFor<Services>(): EffectContext<Services> {
	return middlewareFor<Services>();
}
