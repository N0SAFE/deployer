import { implement, ORPCError, os } from "@orpc/server";
import { Context as EffectContext } from "effect";


import type { InferSchemaInput, InferSchemaOutput } from "@orpc/contract";
import type {
	Context,
	DefaultInitialContext,
	ImplementedProcedure,
	MergedContext,
	Middleware,
	ORPCErrorConstructorMap,
	Procedure,
	ProcedureConfig,
	ProcedureContract,
	ProcedureHandlerOptions,
	ProcedureImplementer,
	RouterContract,
	RouterImplementer,
} from "@orpc/server";
import type { Effect } from "effect";


/**
 * Requirements — the type-level contract between an endpoint, its module, and the composition root.
 *
 * Requirements are not declared and no middleware keeps them in sync: `procedure(contract).effect(handler)` returns the
 * `R` of every effect the handler yields, in the procedure's type. A module subtracts what it provides from what its
 * controllers carry, keeps the rest as `UnmetRequirementsOf`, and `bootstrapApiServer` refuses to start while anything
 * is unmet.
 */

/** Anything a `Context.Service` key structurally is. */
export type AnyService = { readonly Identifier: unknown; readonly key: string };

/** The Effect identifier a service key registers in the request context. */
export type ServiceOf<K> = K extends EffectContext.Service<infer Identifier, unknown> ? Identifier : never;

/** What an individual shape member needs: an Effect, or a function returning one. */
type NeedsOf<V> = V extends Effect.Effect<any, any, infer R>
	? R
	: V extends (...args: any[]) => Effect.Effect<any, any, infer R>
		? R
		: never;

/** Every Effect service a shape's members still need — what a handler inherits by using the service. */
export type Collaborators<K> = K extends EffectContext.Service<any, infer Shape>
	? { [M in keyof Shape]: NeedsOf<Shape[M]> }[keyof Shape]
	: never;

/** The Effect context a module contributes when it declares `S`. */
export type ServedBy<S> = S extends readonly AnyService[]
	? ServiceOf<S[number]> | Collaborators<S[number]>
	: never;

/** The Effect `R` of everything a handler yields. */
export type ServicesOf<Y> = Y extends Effect.Effect<any, any, infer R> ? R : never;

/** Type-level marker: the services an endpoint's body yields. Present only in types, never at runtime. */
declare const Required: unique symbol;

/** What the marker contributes: the `R` the handler was inferred with. */
export type Marked<S> = { readonly [Required]: S };

type DeclaredIn<Ctx> = Ctx extends Marked<infer S> ? S : never;

/** The services an endpoint's procedure requires: what its handler yields, collaborators included. */
export type RequiredBy<P> = P extends Procedure<infer Initial, infer Injected, any, any, any>
	? DeclaredIn<Initial> | DeclaredIn<Injected>
	: never;

/** The generics `implement(contract)` is instantiated with. */
type Parts<C extends RouterContract> = ReturnType<typeof implement<C>> extends ProcedureImplementer<
	infer Initial,
	infer Injected,
	infer Input,
	infer Output,
	infer ErrorMap
>
	? { initial: Initial; injected: Injected; input: Input; output: Output; error: ErrorMap }
	: never;

/**
 * `implement()` with `.effect()` returning the requirements it inferred.
 *
 * Runtime is the library's, unchanged; only the types differ, and they mirror `implement`'s own generics one for one.
 * A router contract stays a router: each procedure key is a `RequirementProcedure`, nested routers recurse, and
 * `$context()` / `$config()` keep the same shape.
 */
export type RequirementImplementer<
	TContract extends RouterContract,
	TInitialContext extends Context,
> = {
	$context<T extends Context = DefaultInitialContext>(): RequirementImplementer<TContract, T & object>;
	$config(config: ProcedureConfig): RequirementImplementer<TContract, TInitialContext>;
} & RequirementRouterImplementer<TContract, TInitialContext>;

type RequirementRouterImplementer<TContract extends RouterContract, TInitialContext extends Context> =
	TContract extends ProcedureContract<infer _InputSchema, infer _OutputSchema, infer _ErrorMap>
		? RequirementProcedure<TContract, TInitialContext, object>
		: Omit<RouterImplementer<TContract, TInitialContext>, keyof TContract> & {
				[K in keyof TContract]: TContract[K] extends RouterContract
					? RequirementRouterImplementer<TContract[K], TInitialContext>
					: never;
			};

/**
 * One procedure of the implementer.
 *
 * The handler is typed with a plain generator rather than `HandlerGen`: `HandlerGen` constrains its yields by the
 * handler's own context, which is what forces `@orpc/effect` callers to pre-declare services. Here the context is
 * independent of the yields, so `TYield` is inferred from the body alone.
 */
export type RequirementProcedure<
	TContract extends RouterContract,
	TInitialContext extends Context,
	TInjectedContext extends Context,
> = Omit<ReturnType<typeof implement<TContract>>, "$context" | "$config" | "use" | "effect"> & {
	use<Out extends Context>(
		middleware: Middleware<MergedContext<TInitialContext, TInjectedContext>, Out, any, any, any>,
	): RequirementProcedure<TContract, TInitialContext, MergedContext<TInjectedContext, Out>>;

	effect<
		TYield extends Effect.Effect<any, any, any>,
		TReturn extends InferSchemaInput<Parts<TContract>["output"]>,
	>(
		handler: (
			options: ProcedureHandlerOptions<
				MergedContext<TInitialContext, TInjectedContext>,
				InferSchemaOutput<Parts<TContract>["input"]>,
				ORPCErrorConstructorMap<Parts<TContract>["error"]>
			>,
			input: InferSchemaOutput<Parts<TContract>["input"]>,
		) => Generator<TYield, TReturn, never>,
	): ImplementedProcedure<
		// The procedure keeps the context it was created with: folding the middleware's injected context into the
		// initial slot would make `@Implement` reject it (`ContractedRouter<T, DefaultInitialContext>`), because
		// `requireAuth()` narrows `auth` to the authenticated variant. The middleware still types the handler.
		TInitialContext,
		TInjectedContext & Marked<ServicesOf<TYield>>,
		Parts<TContract>["input"],
		Parts<TContract>["output"],
		Parts<TContract>["error"]
	>;
};

/** `implement(contract, config)`, with `.effect()` returning the requirements it inferred. */
export function procedure<
	TContract extends RouterContract,
	TInitialContext extends Context = DefaultInitialContext,
>(
	contract: TContract,
	config?: ProcedureConfig,
): RequirementImplementer<TContract, TInitialContext & object> {
	return wrap(implement(contract, config)) as unknown as RequirementImplementer<
		TContract,
		TInitialContext & object
	>;
}

/** Delegates everything to the library; only re-wraps values that are implementers, so `.effect` stays ours. */
function wrap(base: object): object {
	return new Proxy(base, {
		get(target, property) {
			if (property === "use") {
				return (...args: unknown[]) => wrap((target as { use: (...a: unknown[]) => object }).use(...args));
			}

			if (property === "effect") {
				return (handler: unknown) => (target as { effect: (h: unknown) => unknown }).effect(handler);
			}

			const value: unknown = Reflect.get(target, property);

			if (typeof value === "function") {
				const callable = value as (this: unknown, ...args: unknown[]) => unknown;
				// `$context()`, `$config()`, `router()`, `errors()`… all return another implementer: keep it wrapped.
				return (...args: unknown[]): unknown => {
					const result: unknown = callable.apply(target, args) as unknown;
					return isImplementer(result) ? wrap(result) : result;
				};
			}

			return isImplementer(value) ? wrap(value) : value;
		},
	});
}

function isImplementer(value: unknown): value is object {
	if (value === null || typeof value !== "object") {
		return false;
	}

	return "effect" in value || "use" in value || "router" in value;
}

const root = os.$context();

/**
 * The runtime guard, optional.
 *
 * `procedure(...).effect()` types the handler from its body, so nothing is declared. Apply this only when the request
 * context is not guaranteed to carry `effect/context`: it fails with a clear error instead of an untyped defect.
 */
export function requires<const S extends readonly AnyService[]>(..._services: S) {
	return root.middleware(({ context, next }) => {
		const effectContext = (
			context as { readonly "effect/context"?: EffectContext.Context<ServedBy<S>> }
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

/** A module's requirements, as the union of `[controller, services]` pairs it still needs. */
export type UnmetOf<M> = M extends { readonly [UnmetRequirementsOf]: infer U } ? U : never;

/** The exports of every global module in a subtree: visible everywhere, imported or not. */
export const GlobalServicesOf = Symbol("module/global-services");

/** What a subtree's global modules export. */
export type GlobalServices<M> = M extends { readonly [GlobalServicesOf]: infer X } ? X : never;

/** Removes globally-provided services from each `[controller, services]` pair. */
export type ResolveGlobals<U, G> = U extends [infer Controller, infer Services]
	? Exclude<Services, G> extends infer Rest
		? [Rest] extends [never]
			? never
			: [Controller, Rest]
		: never
	: never;

/** A module's requirements, as a readable error: the missing pairs are the type of this object. */
export type Missing<U> = { readonly "unmet effect requirements": U };

/** A module with nothing left to forward. `bootstrapApiServer` takes only this, so the check cannot be skipped. */
export type RequirementsMet<M> = [ResolveGlobals<UnmetOf<M>, GlobalServices<M>>] extends [never]
	? M
	: Missing<ResolveGlobals<UnmetOf<M>, GlobalServices<M>>>;

/**
 * The strict check a composition root runs before Nest builds anything.
 *
 * ```ts
 * const rootModule = assertRequirementsMet(AppModule); // fails to compile while a requirement is unmet
 * ```
 */
export function assertRequirementsMet<M>(module: M & RequirementsMet<M>): M {
	return module;
}

/** The symbol a module stores its unresolved requirements under. */
export const UnmetRequirementsOf = Symbol("module/unmet-requirements");
