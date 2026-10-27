import { ORPCError, os } from "@orpc/server";
import type { Context } from "effect";

/** Anything a `Context.Service` key structurally is. */
export type ServiceKey = { readonly Identifier: unknown; readonly key: string };

/** The `Context` identifier a service key registers. */
export type IdentifierOf<Key> = Key extends Context.Service<
	infer Identifier,
	infer _Shape
>
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
					"effect/context is not configured — did the app pass `extraContext` to `createOrpcModule()`?",
			});
		}

		return next({ context: { "effect/context": effectContext } });
	});
}

/**
 * A module's view of the request's Effect context.
 *
 * `createOrpcModule({ extraContext })` puts the `EffectRuntime`'s `Context`
 * under `effect/context` at request time. This middleware types the subset a
 * procedure may `yield*` inside `.effect()`, so a module declares the services
 * it provides instead of an app-wide registry:
 *
 * ```ts
 * implement(userContract.list).use(requireAuth()).use(UserDomainModule.context)
 *   .effect(function* () { const users = yield* UserService; ... });
 * ```
 *
 * The keys are type-level only — the runtime context is the app's, unchanged.
 */
export type EffectContext<Services> = {
	readonly [Services]?: Services;
} & ReturnType<typeof middlewareFor<Services>>;

/** Type-directed builder for the module wrapper, which derives its services. */
export function effectContextFor<Services>(): EffectContext<Services> {
	return middlewareFor<Services>();
}
