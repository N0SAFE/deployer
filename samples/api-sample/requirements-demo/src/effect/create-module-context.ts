import { Global, Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";

import { effectContextFor, type EffectContext, type IdentifierOf, type ServiceKey } from "./orpc-effect-context";
import {
	GlobalServicesOf,
	RequiredBy,
	UnmetRequirementsOf,
	type AnyService,
	type ServiceOf,
} from "./requirements";

/** The symbol a module's Effect context is stored under: what it can `yield*`. */
export const EffectContextOf = Symbol("effect/context");

/** The symbol a module's exports are stored under: what it makes visible to its importers. */
export const ExportsOf = Symbol("module/exports");

/** The symbol a module's whole subtree stores under: every service in its container. */
export const AllServicesOf = Symbol("module/all-services");

/**
 * The metadata shape the factory accepts: `ModuleMetadata` with readonly lists.
 *
 * `const M` infers an inline `imports: [...]` literal as a readonly tuple, and a readonly tuple is not assignable to
 * `ModuleMetadata`'s mutable arrays. Declaring the lists readonly lets the literal keep the shape it was inferred with.
 */
export type MetadataInput = Omit<ModuleMetadata, "imports" | "controllers" | "providers" | "exports"> & {
	readonly imports?: readonly (Type<unknown> | DynamicModule)[];
	readonly controllers?: readonly Type<unknown>[];
	readonly providers?: readonly unknown[];
	readonly exports?: readonly unknown[];
};

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
type ExportedServices<M extends MetadataInput> = M["exports"] extends readonly (infer E)[] ? ExportedEntry<E> : never;

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

/** This module's own contribution to the global set, if it is declared global. */
type OwnGlobalServices<M extends MetadataInput, O> = O extends { readonly global: true }
	? ExportedServices<M>
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
type OwnServices<M extends MetadataInput, S extends readonly unknown[]> =
	| ProviderServices<M["providers"]>
	| ExtraServices<S>;

/**
 * What a module's own controllers, and the controllers of its imports, can `yield*`.
 *
 * Nest semantics: its own providers, plus the **exports** of the modules it imports. A sibling's providers, a parent's
 * providers and a non-exported provider of an import are all out of reach.
 */
export type VisibleServices<M extends MetadataInput, S extends readonly unknown[] = []> =
	| OwnServices<M, S>
	| ImportedServices<M["imports"]>;

/** Everything one controller's endpoints use, read off the methods' return types. */
type ControllerNeeds<I> = {
	[K in keyof I]: I[K] extends (...args: any[]) => infer R ? RequiredBy<R> : never;
}[keyof I];

/**
 * One controller's unmet services, paired with the controller that needs them.
 *
 * The pair is the whole point of the shape: a root error reads `Missing<[MeshRelayController, MeshRelay]>`, so the fix
 * points at the module that declares the controller — a parent cannot fix it, and the service name alone would send you
 * looking in the wrong file.
 */
type ControllerRequirement<C, Visible> = C extends Type<infer I>
	? [Exclude<ControllerNeeds<I>, Visible>] extends [never]
		? never
		: [I, Exclude<ControllerNeeds<I>, Visible>]
	: never;

/** Every controller of the module that cannot resolve what it uses. */
type LocalUnmet<M extends MetadataInput, Visible> = M["controllers"] extends readonly (infer C)[]
	? ControllerRequirement<C, Visible>
	: never;

/** What an import makes visible. */
export type ExportedBy<M> = M extends { readonly [ExportsOf]: infer X } ? X : never;

/** Every service in a module's subtree. */
export type AllServicesOfModule<M> = M extends { readonly [AllServicesOf]: infer X } ? X : never;

/**
 * What a module still needs: each unmet controller paired with its services, plus what its imports could not resolve.
 *
 * Nothing is ever subtracted by an importer — Nest gives a module only its own providers and its imports' exports.
 */
export type RequirementsOf<M extends MetadataInput, S extends readonly unknown[] = []> =
	| LocalUnmet<M, VisibleServices<M, S>>
	| ImportedUnmet<M["imports"]>;

/**
 * A module produced by `createModuleContext`: a Nest class that carries its metadata, its Effect context, its exports,
 * its whole subtree and its requirements **as types**. Nothing is stored at runtime.
 */
export type RequirementModule<
	M extends MetadataInput = MetadataInput,
	S extends readonly unknown[] = [],
	O = Record<never, never>,
> = Type<unknown> & {
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

/**
 * Brings a module you do not own into the flow, without touching it.
 *
 * ```ts
 * @Module({ providers: [{ provide: MeshClock, useValue: MeshClock.live }], exports: [MeshClock] })
 * class PlatformModule {}
 *
 * export const Platform = declareModule(PlatformModule, { provides: [MeshClock], exports: [MeshClock] });
 * ```
 *
 * `provides` is what it puts in the Effect context, `exports` what it hands to its importers (defaults to `provides`,
 * which is what a module that exports its providers does).
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
	// A claim is checked against what Nest actually has, once, at module definition time.
	assertClaims(module, declaration.provides);

	// The runtime has to agree with the type: `@Global()` is idempotent and is what Nest reads.
	if (declaration.global === true) {
		if (typeof module === "function") {
			Global()(module as Type<unknown>);
		} else {
			(module as DynamicModule).global = true;
		}
	}

	return module as unknown as DeclaredModule<M, P, X, G>;
}

/** The provider tokens Nest recorded on a module, class or dynamic. */
function nestProviderTokens(module: AnyModule): Set<unknown> {
	const entries: readonly unknown[] =
		typeof module === "function"
			? ((Reflect.getMetadata("providers", module) as readonly unknown[] | undefined) ?? [])
			: ((module as DynamicModule).providers ?? []);

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
 * token must actually be there. A lie now throws when the module file is imported, not on the first request that uses it.
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
	const M extends MetadataInput,
	const O extends { readonly global?: boolean } = Record<never, never>,
	const S extends readonly (ServiceKey | EffectContext<unknown>)[] = [],
>(metadata: M, _options?: O, ..._services: S): RequirementModule<M, S, O> {
	/** Nest reads the decorator; the symbols are type-only and are attached by the cast below. */
	class EffectContextModule {
		static readonly [EffectContextOf] = effectContextFor<VisibleServices<M, S>>();
	}

	Module(metadata as ModuleMetadata)(EffectContextModule);

	return EffectContextModule as unknown as RequirementModule<M, S, O>;
}

/** The Effect context of a module: its providers plus its imports' exports. */
export type ModuleContext<M> = M extends { readonly [EffectContextOf]: infer Context } ? Context : never;

/** The services a module's own controllers can `yield*`. */
export type ModuleServices<M> = M extends { readonly [EffectContextOf]: EffectContext<infer S> } ? S : never;
