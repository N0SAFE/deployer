import "reflect-metadata";

import {
	Module,
	type DynamicModule,
	type ModuleMetadata,
	type Provider,
	type Type,
} from "@nestjs/common";
import { Context, Layer } from "effect";

// ─────────────────────────────────────────────────────────────────────────────
// 1. What a service key is
// ─────────────────────────────────────────────────────────────────────────────

/** Anything a `Context.Service` key structurally is. */
export type ServiceKey = { readonly Identifier: unknown; readonly key: string };

/** The `Context` identifier a service key registers. */
export type IdentifierOf<Key> =
	Key extends Context.Service<infer Identifier, infer _Shape> ? Identifier : never;

// ─────────────────────────────────────────────────────────────────────────────
// 2. What a module publishes: a request context and a tree node
// ─────────────────────────────────────────────────────────────────────────────

/** Request-time context: exactly the services a handler may `yield*`. */
declare const Services: unique symbol;
export type EffectContext<S> = { readonly [Services]?: S };

/** Type-only marker; the real middleware comes from `@deployer/nest-effect`. */
export function effectContextFor<S>(): EffectContext<S> {
	return {};
}

/** Type-level halves of the node: what importers get, what this module still needs. */
declare const Provided: unique symbol;
declare const Required: unique symbol;

/** What one node of the module tree says about the Effect world. */
export interface ModuleGraph {
	/** The name used in the printed tree. */
	readonly name: string;
	/** `Context.Service` tokens this module registers for its importers. */
	readonly provides: readonly string[];
	/** Keys passed as extras: request-scoped, visible here, not importable, not a requirement. */
	readonly ambient: readonly string[];
	/** Layers this module owns; the runtime collects them, nobody lists them again. */
	readonly layers: readonly AnyLayer[];
	/** Imported nodes, embedded at creation time. */
	readonly imports: readonly ModuleGraph[];
	/** A Nest module imported without `effectModule`: no types, tokens only. */
	readonly opaque: boolean;
}

/**
 * A node that also carries its two type-level sets.
 *
 * `EffectGraph<P, R> extends ModuleGraph`, so an import list recovers both
 * halves structurally. The phantom members are optional and never emitted.
 */
export interface EffectGraph<P = never, R = never> extends ModuleGraph {
	readonly [Provided]?: P;
	readonly [Required]?: R;
}

/** A module value that carries its graph node. */
export type EffectGraphNode<P, R> = { readonly [EffectGraphOf]: EffectGraph<P, R> };

/** Symbols are registered globally so the ESM and CJS builds agree. */
export const EffectContextOf = Symbol.for("@deployer/nest-effect/EffectContextOf");
export const EffectGraphOf = Symbol.for("@deployer/nest-effect/EffectGraphOf");
export const EFFECT_MODULE_LAYERS = Symbol.for("@deployer/nest-effect/ModuleLayers");

// ─────────────────────────────────────────────────────────────────────────────
// 3. Type-level resolution, one module at a time
// ─────────────────────────────────────────────────────────────────────────────

/** Any layer, variance erased for constraints. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLayer = Layer.Layer<any, any, any>;

/** `ROut` of `Layer<ROut, E, RIn>`. */
export type LayerProvided<L> = L extends Layer.Layer<infer A, any, any> ? A : never;

/** `RIn` of `Layer<ROut, E, RIn>`. */
export type LayerRequired<L> = L extends Layer.Layer<any, any, infer R> ? R : never;

/**
 * What may follow the metadata.
 *
 * A layer is a service this module owns: it contributes `ROut` and requires
 * `RIn`. A bare key is ambient — a request-scoped service such as an actor or a
 * correlation id. It is visible in this module and in no one else's, and it
 * never satisfies a layer requirement: that is what importing the providing
 * module is for.
 */
export type ModuleExtra = ServiceKey | EffectContext<unknown> | AnyLayer;

/** Services a provider list contributes: only `Context.Service` tokens count. */
type ProviderProvided<P> =
	P extends readonly (infer E)[]
		? E extends { readonly provide: infer Token }
			? IdentifierOf<Token>
			: IdentifierOf<E>
		: never;

/** Services an import list contributes: the wrapped nodes' `provides`. */
type ImportProvided<I> = I extends readonly (infer E)[] ? GraphProvided<GraphOf<E>> : never;

/** Layers and keys among the extras. */
type LayerExtra<S> = S extends readonly (infer E)[] ? (E extends AnyLayer ? E : never) : never;
type KeyExtra<S> = S extends readonly (infer E)[] ? (E extends ServiceKey ? E : never) : never;

/** What this module registers. Importers inherit exactly this. */
export type NodeProvides<M, S extends readonly ModuleExtra[]> =
	| ProviderProvided<M extends { providers?: infer P } ? P : never>
	| ImportProvided<M extends { imports?: infer I } ? I : never>
	| LayerProvided<LayerExtra<S>>;

/** Ambient services: visible to this module's handlers, promised by nobody. */
export type NodeAmbient<S extends readonly ModuleExtra[]> =
	| IdentifierOf<KeyExtra<S>>
	| (S extends readonly (infer E)[]
			? E extends EffectContext<infer C>
				? C
				: never
			: never);

/** Everything a handler in this module may `yield*`. */
export type NodeContext<M, S extends readonly ModuleExtra[]> = NodeProvides<M, S> | NodeAmbient<S>;

/** What this module's own layers need, and what no import can rescue. */
export type NodeRequirements<S extends readonly ModuleExtra[]> = LayerRequired<LayerExtra<S>>;

/** The requirements this module does not provide itself. */
export type MissingServices<M, S extends readonly ModuleExtra[]> = Exclude<
	NodeRequirements<S>,
	NodeProvides<M, S>
>;

/** A class built by `createModuleContext`, or the `module` of a `DynamicModule`. */
type GraphOf<E> =
	E extends EffectGraphNode<infer P, infer R>
		? EffectGraph<P, R>
		: E extends { readonly module: infer M }
			? M extends EffectGraphNode<infer P, infer R>
				? EffectGraph<P, R>
				: never
			: never;

export type GraphProvided<G> = G extends EffectGraph<infer P, infer _R> ? P : never;

export type GraphRequired<G> = G extends EffectGraph<infer _P, infer R> ? R : never;

// What a built module exposes to its own handlers and to its importers.
export type ContextOf<Module> =
	Module extends { readonly [EffectContextOf]: EffectContext<infer S> } ? S : never;
export type ProvidesOf<Module> = Module extends EffectGraphNode<infer P, infer _R> ? P : never;
export type RequirementsOf<Module> = Module extends EffectGraphNode<infer _P, infer R> ? R : never;
export type MissingOf<Module> = Exclude<RequirementsOf<Module>, ProvidesOf<Module>>;

/**
 * The compile-time check, expressed as a phantom required property.
 *
 * When nothing is missing the intersection collapses to `M`. When something is,
 * the metadata argument must carry `__missingEffectProviders`, which no caller
 * writes — so TypeScript reports the argument as missing that property and
 * prints the missing service types in the message.
 */
type MissingCheck<M, S extends readonly ModuleExtra[]> = [MissingServices<M, S>] extends [never]
	? unknown
	: { readonly __missingEffectProviders: MissingServices<M, S> };

// ─────────────────────────────────────────────────────────────────────────────
// 4. The module class
// ─────────────────────────────────────────────────────────────────────────────

export interface EffectModuleClass<P, R, A = never> extends EffectGraphNode<P, R> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new (...args: any[]): any;
	readonly [EffectContextOf]: EffectContext<P | A>;
}

/**
 * Builds a Nest module that closes itself.
 *
 * ```ts
 * export class HealthDomainModule extends createModuleContext(
 *   { name: "HealthDomainModule", imports: [HealthRegistryModule] },
 *   HealthLive, // Layer<HealthService, never, HealthRegistry>
 * ) {}
 * ```
 *
 * `HealthLive` contributes `HealthService` and requires `HealthRegistry`; the
 * import supplies it, so the module closes. Drop the import and the call stops
 * compiling, naming `HealthRegistry`. No app-wide list, no runtime node, no
 * ancestor to ask: the module either has what its layers need or it is wrong.
 */
export function createModuleContext<
	const M extends ModuleMetadata & { readonly name?: string },
	const S extends readonly ModuleExtra[] = [],
>(
	metadata: M & MissingCheck<M, S>,
	...extras: S
): EffectModuleClass<NodeProvides<M, S>, NodeRequirements<S>, NodeAmbient<S>> {
	// `name` is ours; Nest rejects unknown keys, so it never reaches `@Module`.
	const { name: moduleName, ...nest } = metadata;
	const layers = extras.filter(isLayer);

	const node: ModuleGraph = {
		name: moduleName ?? "EffectContextModule",
		provides: providerKeys(nest.providers),
		ambient: extras.filter(isServiceKey).map((key) => String(key.key)),
		layers,
		imports: (nest.imports ?? []).map(importGraph),
		opaque: false,
	};

	class EffectContextModule {
		static readonly [EffectContextOf] =
			effectContextFor<NodeProvides<M, S> | NodeAmbient<S>>();
		static readonly [EffectGraphOf]: EffectGraph<NodeProvides<M, S>, NodeRequirements<S>> = node;
	}

	// The runtime reads these from the container; the module is the only place
	// that lists them. No `forRoot({ layers })` exists to keep in sync.
	const providers: Provider[] =
		layers.length === 0
			? (nest.providers ?? [])
			: [...(nest.providers ?? []), { provide: EFFECT_MODULE_LAYERS, useValue: layers }];

	Module({ ...nest, providers } as ModuleMetadata)(EffectContextModule);

	return EffectContextModule as unknown as EffectModuleClass<
		NodeProvides<M, S>,
		NodeRequirements<S>,
		NodeAmbient<S>
	>;
}

/**
 * Gives a Nest module you do not own a typed Effect surface.
 *
 * ```ts
 * imports: [effectModule(HealthModule.forRoot({ indicators: "platform" }), [HealthRegistry])]
 * ```
 *
 * The claim is checked immediately against the module's own `providers`:
 * a tag it does not register throws here, not on the first request. Declare
 * only what that module registers directly; a re-exported provider is declared
 * where it is registered.
 */
export function effectModule<
	const M extends Type<unknown> | ModuleMetadata | DynamicModule,
	const T extends readonly ServiceKey[],
>(
	moduleRef: M,
	tags: T,
): M & EffectGraphNode<IdentifierOf<T[number]>, never> {
	const actual = providerKeys(
		isDynamicModule(moduleRef) ? moduleRef.providers : metadataProviders(moduleRef),
	);
	const declared = tags.map((tag) => String(tag.key));
	const missing = declared.filter((key) => !actual.includes(key));

	if (missing.length > 0) {
		throw new Error(
			`effectModule(${nameOf(moduleRef)}): declares ${missing.join(", ")} but the module registers ${actual.join(", ") || "nothing"}`,
		);
	}

	const node: ModuleGraph = {
		name: nameOf(moduleRef),
		provides: declared,
		ambient: [],
		layers: [],
		imports: [],
		opaque: false,
	};

	if (isDynamicModule(moduleRef)) {
		return { ...moduleRef, [EffectGraphOf]: node } as M & EffectGraphNode<IdentifierOf<T[number]>, never>;
	}

	Object.defineProperty(moduleRef, EffectGraphOf, { value: node, configurable: true });
	return moduleRef as M & EffectGraphNode<IdentifierOf<T[number]>, never>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Runtime graph: what is registered where
// ─────────────────────────────────────────────────────────────────────────────

/** Keys of the `Context.Service` providers in a provider list. */
function providerKeys(providers: readonly Provider[] | undefined): string[] {
	const keys: string[] = [];
	for (const provider of providers ?? []) {
		const token = providerToken(provider);
		if (Context.isKey(token)) keys.push(String(token.key));
	}
	return dedupe(keys);
}

function providerToken(provider: Provider): unknown {
	return typeof provider === "object" && provider !== null && "provide" in provider
		? (provider as { readonly provide: unknown }).provide
		: provider;
}

function isServiceKey(value: unknown): value is ServiceKey {
	return Context.isKey(value);
}

function isLayer(value: unknown): value is AnyLayer {
	return Layer.isLayer(value);
}

function isDynamicModule(value: unknown): value is DynamicModule {
	return typeof value === "object" && value !== null && "module" in value;
}

function metadataProviders(value: unknown): Provider[] | undefined {
	return typeof value === "function"
		? (Reflect.getMetadata("providers", value) as Provider[] | undefined)
		: undefined;
}

function nameOf(value: unknown): string {
	if (typeof value === "function") return (value as { readonly name: string }).name;
	if (isDynamicModule(value)) {
		const inner = value.module as { readonly name?: string };
		return `${inner.name ?? "anonymous"}.forRoot()`;
	}
	return "anonymous";
}

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function graphOf(value: unknown): EffectGraph<unknown, unknown> | undefined {
	if ((typeof value !== "object" && typeof value !== "function") || value === null) return undefined;
	const own = (value as Record<symbol, unknown>)[EffectGraphOf];
	if (own !== undefined) return own as EffectGraph<unknown, unknown>;
	const inner = (value as { readonly module?: unknown }).module;
	if (inner !== undefined) {
		return (inner as Record<symbol, unknown>)[EffectGraphOf] as EffectGraph<unknown, unknown> | undefined;
	}
	return undefined;
}

/** Converts one entry of `imports` into a node. */
function importGraph(entry: unknown): ModuleGraph {
	const graph = graphOf(entry);
	if (graph !== undefined) {
		const dynamicProviders = isDynamicModule(entry) ? providerKeys(entry.providers) : [];
		return dynamicProviders.length === 0
			? graph
			: { ...graph, provides: dedupe([...graph.provides, ...dynamicProviders]) };
	}

	return {
		name: nameOf(entry),
		provides: providerKeys(isDynamicModule(entry) ? entry.providers : metadataProviders(entry)),
		ambient: [],
		layers: [],
		imports: [],
		opaque: true,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Reading the tree
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleGraphRow {
	/** `/Root/Child/Grandchild` */
	readonly path: string;
	readonly name: string;
	readonly provides: readonly string[];
	readonly ambient: readonly string[];
	readonly layers: number;
	readonly opaque: boolean;
}

/** Depth-first flattening: one row per point of the tree. */
export function describeEffectModuleTree(root: EffectGraphNode<unknown, unknown>): readonly ModuleGraphRow[] {
	const rows: ModuleGraphRow[] = [];

	const walk = (node: ModuleGraph, parent: string): void => {
		const path = `${parent}/${node.name}`;
		rows.push({
			path,
			name: node.name,
			provides: node.provides,
			ambient: node.ambient,
			layers: node.layers.length,
			opaque: node.opaque,
		});
		for (const child of node.imports) walk(child, path);
	};

	walk(root[EffectGraphOf], "");
	return rows;
}

/** The tree as text: tokens found here, ambient keys, owned layers, `??` opaque. */
export function effectModuleTreeText(root: EffectGraphNode<unknown, unknown>): string {
	const lines: string[] = [];

	const walk = (node: ModuleGraph, depth: number): void => {
		const indent = "  ".repeat(depth);
		lines.push(`${indent}${node.opaque ? "?? " : ""}${node.name}`);
		if (node.provides.length > 0) lines.push(`${indent}   provides: ${node.provides.join(", ")}`);
		if (node.layers.length > 0) lines.push(`${indent}   layers:   ${node.layers.length}`);
		if (node.ambient.length > 0) lines.push(`${indent}   ambient:  ${node.ambient.join(", ")}`);
		for (const child of node.imports) walk(child, depth + 1);
	};

	walk(root[EffectGraphOf], 0);
	return lines.join("\n");
}

/**
 * The layers the runtime has to build, in tree order (dependencies first).
 *
 * In the package this is what `EffectRuntime` collects from the
 * `EFFECT_MODULE_LAYERS` providers `createModuleContext` registers — the same
 * information, read from the container instead of from the tree.
 */
export function moduleLayers(root: EffectGraphNode<unknown, unknown>): readonly AnyLayer[] {
	const layers: AnyLayer[] = [];

	const walk = (node: ModuleGraph): void => {
		for (const child of node.imports) walk(child);
		layers.push(...node.layers);
	};

	walk(root[EffectGraphOf]);
	return layers;
}
