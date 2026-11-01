import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { InjectionToken } from "@nestjs/common";
import { ModulesContainer } from "@nestjs/core";
import type { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper";
import type { Module as NestModuleRef } from "@nestjs/core/injector/module";
import { Context } from "effect";

/** A token as a human reads it: the class name, the string, or the Effect key. */
function tokenName(token: unknown): string {
	if (typeof token === "function") return token.name;
	if (typeof token === "string") return token;
	if (typeof token === "object" && token !== null && "key" in token) {
		return String((token as { readonly key: unknown }).key);
	}

	return String(token);
}

/**
 * The Effect context of a request, per module.
 *
 * It answers the same question the types answer — *what may this controller `yield*`?* — from the graph Nest already
 * built: the module's own providers, the providers its imports **export**, and the exports of every global module.
 *
 * This is deliberately stricter than the one careless alternative (`every provider in the container`): a controller
 * whose module never imported a service cannot reach it, which is the rule `UnmetOf` already enforces at compile time.
 */
@Injectable()
export class EffectRuntime implements OnApplicationShutdown {
	private readonly scopes = new Map<unknown, { context: Context.Context<unknown>; tokens: Set<InjectionToken> }>();

	constructor(private readonly modules: ModulesContainer) {}

	/** The context of the module that owns `controller`. */
	contextFor(controller: unknown): Context.Context<unknown> {
		const owner = this.ownerOf(controller);
		return owner === undefined ? (Context.empty() as Context.Context<unknown>) : this.contextOf(owner);
	}

	/**
	 * What each controller can reach today that its module cannot: the migration report.
	 *
	 * Before scoping, every provider was in one context. This lists, per controller, the services that are registered in
	 * the container but outside the controller's module scope — the ones that will start failing when the runtime is
	 * flipped, and that the type audit already reports as `Missing`.
	 */
	scopeReport(): Array<{ controller: string; outOfScope: string[] }> {
		const all = new Set<InjectionToken>();
		for (const module of this.modules.values()) {
			for (const token of module.providers.keys()) {
				if (Context.isKey(token)) all.add(token);
			}
		}

		const report: Array<{ controller: string; outOfScope: string[] }> = [];

		for (const module of this.modules.values()) {
			const visible = this.scopeOf(module).tokens;

			const outOfScope = [...all]
				.filter((token) => !visible.has(token))
				.map(tokenName)
				.sort();

			if (outOfScope.length === 0) continue;

			for (const wrapper of module.controllers.values()) {
				report.push({
					controller: typeof wrapper.metatype === "function" ? wrapper.metatype.name : String(wrapper.metatype),
					outOfScope,
				});
			}
		}

		return report;
	}

	/** Drops the cached contexts; the container they were derived from is either gone or being rebuilt. */
	onApplicationShutdown(): void {
		this.scopes.clear();
	}

	private ownerOf(controller: unknown): NestModuleRef | undefined {
		for (const module of this.modules.values()) {
			for (const wrapper of module.controllers.values()) {
				if (wrapper.metatype === controller) {
					return module;
				}
			}
		}

		return undefined;
	}

	private contextOf(module: NestModuleRef): Context.Context<unknown> {
		return this.scopeOf(module).context;
	}

	private scopeOf(module: NestModuleRef): { context: Context.Context<unknown>; tokens: Set<InjectionToken> } {
		const cached = this.scopes.get(module.metatype);
		if (cached !== undefined) {
			return cached;
		}

		const scope = this.build(module);
		this.scopes.set(module.metatype, scope);
		return scope;
	}

	private build(module: NestModuleRef): { context: Context.Context<unknown>; tokens: Set<InjectionToken> } {
		const tokens = new Set<InjectionToken>();
		let context = Context.empty() as Context.Context<unknown>;

		const add = (wrapper: InstanceWrapper<unknown>): void => {
			if (wrapper.instance === undefined) return;
			if (!Context.isKey(wrapper.token)) return;
			if (tokens.has(wrapper.token)) return;

			tokens.add(wrapper.token);
			context = Context.add(context, wrapper.token as never, wrapper.instance as never);
		};

		for (const wrapper of module.providers.values()) add(wrapper);
		for (const imported of module.imports) for (const wrapper of this.exportedBy(imported)) add(wrapper);
		for (const candidate of this.modules.values()) {
			if (candidate.isGlobal) for (const wrapper of this.exportedBy(candidate)) add(wrapper);
		}

		return { context, tokens };
	}

	/**
	 * The provider instances a module hands upward: its `exports`, plus the exports of the modules it re-exports.
	 *
	 * Nest stores `exports` as tokens, so a token that is not one of the module's own providers is a re-exported module
	 * or a token this module does not own; the former is resolved, the latter ignored rather than guessed.
	 */
	private exportedBy(module: NestModuleRef, seen = new Set<NestModuleRef>()): InstanceWrapper<unknown>[] {
		if (seen.has(module)) return [];
		seen.add(module);

		const exported: InstanceWrapper<unknown>[] = [];

		for (const token of module.exports) {
			const own = module.providers.get(token);
			if (own !== undefined) {
				exported.push(own);
				continue;
			}

			if (typeof token === "function") {
				const reExported = (this.modules as unknown as Map<unknown, NestModuleRef>).get(token);
				if (reExported !== undefined) exported.push(...this.exportedBy(reExported, seen));
			}
		}

		return exported;
	}
}
