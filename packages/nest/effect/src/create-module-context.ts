import { Global, Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";

import type { Ambient } from "@deployer/effect-core";

import { effectContextFor, type EffectContext, type IdentifierOf, type ServiceKey } from "./orpc-effect-context";
import {
	GlobalServicesOf,
	UnmetRequirementsOf,
	type AnyService,
	type Collaborators,
	type RequiredBy,
	type ServiceOf,
} from "./requirements";

/** The symbol a module's Effect context is stored under: what it can `yield*`. */
export const EffectContextOf = Symbol("effect/context");

/** The symbol a module's exports are stored under: what it makes visible to its importers. */
export const ExportsOf = Symbol("module/exports");

/** The symbol a module's whole subtree stores under: every service in its container. */
export const AllServicesOf = Symbol("module/all-services");

/** Services a provider list contributes: only `Context.Service` tokens count. */
type ProviderServices<P> = P extends readonly (infer E)[]
	? E extends { readonly provide: infer Token }
		? IdentifierOf<Token>
		: IdentifierOf<E>
	: never;

/**
 * What one `exports` entry hands upward.
 *
 * Nest's rules, in order: a `{ provide, useValue }` entry exports that token; a module entry exports **its** exports;
 * a bare `Context.Service` class exports itself. Anything else (a plain class, a helper) contributes nothing.
 */
type ExportedEntry<E> = E extends { readonly provide: infer Token }
	? IdentifierOf<Token>
	: E extends { readonly [ExportsOf]: infer X }
		? X
		: IdentifierOf<E>;

/** What a module exports to whoever imports it. */
type ExportedServices<M extends ModuleMetadata> = M["exports"] extends readonly (infer E)[]
	? ExportedEntry<E>
	: never;

/** What importing a module grants: exactly its exports, never its private providers. */
type ImportedServices<I> = I extends readonly (infer E)[]
	? E extends { readonly [ExportsOf]: infer X }
		? X
		: never
	: never;

/** Requirements a module could not satisfy where they were declared; they stay visible to the root. */
type ImportedUnmet<I> = I extends readonly (infer E)[]
	? E extends { readonly [UnmetRequirementsOf]: infer U }
		? U
		: never
	: never;

/** Every service in a module's subtree: what its container holds once the app is built. */
type ImportedAllServices<I> = I extends readonly (infer E)[]
	? E extends { readonly [AllServicesOf]: infer X }
		? X
		: never
	: never;

/** What the global modules of a subtree export: visible everywhere, imported or not. */
type ImportedGlobalServices<I> = I extends readonly (infer E)[]
	? E extends { readonly [GlobalServicesOf]: infer X }
		? X
		: never
	: never;

/** Services passed as explicit extra keys. */
type ExtraServices<S> = S extends readonly (infer E)[]
	? E extends ServiceKey
		? IdentifierOf<E>
		: E extends EffectContext<infer Context>
			? Context
			: never
	: never;

/** What the module provides itself. */
type OwnServices<M extends ModuleMetadata, S extends readonly unknown[]> =
	| ProviderServices<M["providers"]>
	| ExtraServices<S>;

/** This module's own contribution to the global set, if it is declared global. */
type OwnGlobalServices<M extends ModuleMetadata, O> = O extends { readonly global: true }
	? ExportedServices<M>
	: never;

/**
 * What a module's own controllers can `yield*`.
 *
 * Nest semantics: its own providers, plus the **exports** of the modules it imports. A sibling's providers, a parent's
 * providers and a non-exported provider of an import are all out of reach.
 */
export type VisibleServices<M extends ModuleMetadata, S extends readonly unknown[] = []> =
	| OwnServices<M, S>
	| ImportedServices<M["imports"]>;

/** Everything one controller's endpoints use, read off the methods' return types. */
type ControllerNeeds<I> = {
	[K in keyof I]: I[K] extends (...args: any[]) => infer R ? RequiredBy<R> : never;
}[keyof I];

/**
 * One controller's unmet services, paired with the controller that needs them.
 *
 * The pair is the point of the shape: a root error reads `Missing<[MeshRelayController, MeshRelay]>`, so the fix points
 * at the module that declares the controller — a parent cannot fix it, and the service name alone would send you to the
 * wrong file.
 */
type ControllerRequirement<C, Visible> = C extends Type<infer I>
	? [Exclude<ControllerNeeds<I>, Visible | Ambient>] extends [never]
		? never
		: [I, Exclude<ControllerNeeds<I>, Visible | Ambient>]
	: never;

/** Every controller of the module that cannot resolve what it uses. */
type LocalUnmet<M extends ModuleMetadata, Visible> = M["controllers"] extends readonly (infer C)[]
	? ControllerRequirement<C, Visible>
	: never;

/**
 * One provider whose shape needs a service this module cannot see, as the same `[entry, services]` pair controllers use.
 *
 * Pairing it with the entry (not just the missing tag) keeps the root error actionable and lets `ResolveGlobals` subtract
 * a globally-provided service exactly as it does for a controller. `useClass`/`useFactory` entries return a value whose
 * shape the type system cannot see, so they contribute nothing.
 */
type ProviderRequirementEntry<E, Visible> = E extends { readonly provide: infer Token }
	? Token extends AnyService
		? Exclude<NonNullable<Collaborators<Token>>, Visible | Record<string, never> | Ambient> extends infer Missing
			? [Missing] extends [never]
				? never
				: [Token, Missing]
			: never
		: never
	: E extends AnyService
		? Exclude<NonNullable<Collaborators<E>>, Visible | Record<string, never> | Ambient> extends infer Missing
			? [Missing] extends [never]
				? never
				: [E, Missing]
			: never
		: never;

/** Every provider of the module whose shape cannot resolve a collaborator it yields. */
type ProviderUnmet<M extends ModuleMetadata, Visible> = M["providers"] extends readonly (infer E)[]
	? ProviderRequirementEntry<E, Visible>
	: never;

/**
 * What a module still needs: each unmet controller paired with its services, plus what its imports could not resolve.
 *
 * Nothing is ever subtracted by an importer — Nest gives a module only its own providers and its imports' exports.
 */
export type RequirementsOf<M extends ModuleMetadata, S extends readonly unknown[] = []> =
	| LocalUnmet<M, VisibleServices<M, S>>
	// Provider shapes are part of the requirement set: a service that yields another service must be able to see it,
	// exactly like a controller. Plain Nest modules must be annotated with `declareModule` so their exports are visible.
	| ProviderUnmet<M, VisibleServices<M, S>>
	| ImportedUnmet<M["imports"]>;

/**
 * A module produced by `createModuleContext`: a Nest class that carries its metadata, its Effect context, its exports,
 * its whole subtree and its requirements **as types**. Nothing is stored at runtime.
 */
export type RequirementModule<
	M extends ModuleMetadata = ModuleMetadata,
	S extends readonly unknown[] = [],
	O = object,
> = Type & {
	readonly [EffectContextOf]: EffectContext<VisibleServices<M, S>>;
	readonly [ExportsOf]: ExportedServices<M>;
	readonly [UnmetRequirementsOf]: RequirementsOf<M, S>;
	readonly [AllServicesOf]: OwnServices<M, S> | ImportedAllServices<M["imports"]>;
	readonly [GlobalServicesOf]: OwnGlobalServices<M, O> | ImportedGlobalServices<M["imports"]>;
};

/** Any value Nest accepts in `imports`. */
export type AnyModule = Type<unknown> | DynamicModule;

/**
 * A foreign module's contribution, its exports and its subtree.
 *
 * No `requires`: a module's requirements come from its controllers, which a foreign module's types do not expose. What
 * it needs, it must import itself — that is Nest's rule and it is why the annotation only describes what crosses the
 * boundary.
 */
export type DeclaredModule<
	M extends AnyModule,
	P extends readonly AnyService[],
	X extends readonly AnyService[],
	G extends boolean = false,
> = M & {
	readonly [EffectContextOf]: EffectContext<ServiceOf<P[number]>>;
	readonly [ExportsOf]: ServiceOf<X[number]>;
	readonly [UnmetRequirementsOf]: never;
	readonly [AllServicesOf]: ServiceOf<P[number]>;
	readonly [GlobalServicesOf]: G extends true ? ServiceOf<X[number]> : never;
};

/** The provider tokens Nest recorded on a module, class or dynamic. */
function nestProviderTokens(module: AnyModule): Set<unknown> {
	const entries: readonly unknown[] =
		typeof module === "function"
			? ((Reflect.getMetadata("providers", module) as readonly unknown[] | undefined) ?? [])
			: ((module).providers ?? []);

	return new Set(
		entries.map((entry) =>
			typeof entry === "object" && entry !== null && "provide" in entry
				? (entry as { readonly provide: unknown }).provide
				: entry,
		),
	);
}

/**
 * Turns the one trust boundary into a fast failure.
 *
 * `declareModule` cannot see a foreign module's types, but Nest's metadata is on the class: every claimed `provides`
 * token must actually be there. A lie throws when the module file is imported, not on the first request that uses it.
 */
function assertClaims(module: AnyModule, claimed: readonly unknown[] | undefined): void {
	if (claimed === undefined || claimed.length === 0) return;

	const actual = nestProviderTokens(module);
	const missing = claimed.filter((token) => !actual.has(token));
	if (missing.length === 0) return;

	const name = typeof module === "function" ? module.name : "DynamicModule";
	throw new Error(
		`declareModule(${name}): claims to provide ${missing
			.map((token) => (typeof token === "function" ? token.name : String(token)))
			.join(", ")}, which Nest does not have in its providers.`,
	);
}

/**
 * Brings a module you do not own into the flow, without touching it.
 *
 * ```ts
 * @Module({ providers: [{ provide: MeshClock, useClass: MeshClock.live }], exports: [MeshClock] })
 * class PlatformModule {}
 *
 * export const Platform = declareModule(PlatformModule, { provides: [MeshClock], exports: [MeshClock] });
 * ```
 *
 * `provides` is what it puts in the Effect context, `exports` what it hands to its importers (defaults to `provides`,
 * which is what a module that exports its providers does). Claims are checked against Nest's metadata immediately.
 */
export function declareModule<
	M extends AnyModule,
	const P extends readonly AnyService[] = [],
	const X extends readonly AnyService[] = P,
	const G extends boolean = false,
>(
	module: M,
	declaration: { readonly provides?: P; readonly exports?: X; readonly global?: G } = {},
): DeclaredModule<M, P, X, G> {
	assertClaims(module, declaration.provides);

	// The runtime has to agree with the type: `@Global()` is idempotent and is what Nest reads.
	if (declaration.global === true) {
		if (typeof module === "function") {
			Global()(module);
		} else {
			// The assertion is required by declaration emit: a generic `M` is not narrowed by `typeof`.
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
			(module as DynamicModule).global = true;
		}
	}

	return module as unknown as DeclaredModule<M, P, X, G>;
}

/**
 * The base of a module that owns Effect services and declares requirements.
 *
 * Same metadata as `@Module`, plus four derived facts:
 *
 * - `[EffectContextOf]` — what the module's own controllers can `yield*` (its providers + its imports' exports);
 * - `[ExportsOf]` — what its importers get;
 * - `[UnmetRequirementsOf]` — what its controllers use that nothing it imports provides;
 * - `[AllServicesOf]` — its subtree, which is the container the runtime builds.
 */
export function createModuleContext<
	const M extends ModuleMetadata,
	const S extends readonly (ServiceKey | EffectContext<unknown>)[] = [],
>(metadata: M, ..._services: S): RequirementModule<M, S> {
	/** Nest reads the decorator; the symbols are type-only and are attached by the cast below. */
	class EffectContextModule {
		static readonly [EffectContextOf] = effectContextFor<VisibleServices<M, S>>();
	}

	Module(metadata)(EffectContextModule);

	return EffectContextModule as unknown as RequirementModule<M, S>;
}

/**
 * The same, marked global: its exports are visible to every module, imported or not.
 *
 * A wrapper rather than an option, so `createModuleContext` keeps its `(metadata, ...services)` shape and the call
 * sites that pass extra Effect keys do not move. It applies Nest's `@Global()` too — a type-only global compiles and
 * then fails at runtime, because `EffectRuntime` reads `Module.isGlobal` to scope a request context.
 */
export function createGlobalModule<
	const M extends ModuleMetadata,
	const S extends readonly (ServiceKey | EffectContext<unknown>)[] = [],
>(metadata: M, ..._services: S): RequirementModule<M, S, { readonly global: true }> {
	const module = createModuleContext(metadata, ..._services);
	Global()(module);

	return module;
}

/** The Effect context of a module: its providers plus its imports' exports. */
export type ModuleContext<M> = M extends { readonly [EffectContextOf]: infer Context } ? Context : never;

/** The services a module's own controllers can `yield*`. */
export type ModuleServices<M> = M extends { readonly [EffectContextOf]: EffectContext<infer S> } ? S : never;
