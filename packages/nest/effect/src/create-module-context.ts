import { Module, type ModuleMetadata } from "@nestjs/common";

import {
	effectContextFor,
	type EffectContext,
	type IdentifierOf,
	type ServiceKey,
} from "./orpc-effect-context";

/** The symbol a module's Effect context is stored under. */
export const EffectContextOf = Symbol("effect/context");

/** Services a provider list contributes: only `Context.Service` tokens count. */
type ProviderServices<P> = P extends readonly (infer E)[]
	? E extends { readonly provide: infer Token }
		? IdentifierOf<Token>
		: IdentifierOf<E>
	: never;

/** Services an import list contributes: the wrapped modules' contexts. */
type ImportServices<I> = I extends readonly (infer E)[]
	? E extends Record<typeof EffectContextOf, EffectContext<infer S>>
		? S
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

/**
 * The base class of a module that owns Effect services.
 *
 * ```ts
 * export class UserDomainModule extends createModuleContext({
 *   controllers: [UserController],
 *   providers: [{ provide: UserService, useClass: UserServiceImpl }],
 * }) {}
 *
 * implement(userContract.list).use(UserDomainModule[EffectContextOf])
 *   .effect(function* () { const users = yield* UserService; ... });
 * ```
 *
 * The context is the union of what the module PROVIDES (its `Context.Service`
 * providers plus the explicit `services`), what its imported wrapped modules
 * provide, and nothing else. There is no app-wide service registry: a handler
 * can only `yield*` what its own module declared.
 *
 * The context is exposed under a symbol so the base class's public surface stays
 * empty and cannot be shadowed by a module's own members.
 */
export function createModuleContext<
	const M extends ModuleMetadata,
	const S extends readonly (ServiceKey | EffectContext<unknown>)[] = [],
>(metadata: M, ..._services: S) {
	type Services =
		| ProviderServices<M["providers"]>
		| ImportServices<M["imports"]>
		| ExtraServices<S>;

	/** Nest reads `@Module` metadata; the symbol carries the Effect context. */
	class EffectContextModule {
		static readonly [EffectContextOf] = effectContextFor<Services>();
	}

	Module(metadata)(EffectContextModule);

	return EffectContextModule;
}

/** The Effect context of a module built with `createModuleContext`. */
export type ModuleContext<M> = M extends Record<
	typeof EffectContextOf,
	EffectContext<infer S>
>
	? EffectContext<S>
	: never;
