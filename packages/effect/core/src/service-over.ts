import { Effect } from "effect";

import type { RequirementsOf } from "./bind-services";

/** `S` with `R` added to the requirements of every Effect-returning method. */
export type Over<S, R> = {
	readonly [K in keyof S]: S[K] extends (...args: infer A) => Effect.Effect<infer X, infer E, infer R2>
		? (...args: A) => Effect.Effect<X, E, R2 | R>
		: S[K];
};

/**
 * A service whose collaborators are yielded from the Effect context when a method runs, instead of
 * being handed in at construction.
 *
 * `make` is written the usual way, as closures over its collaborators; `serviceOver` resolves them
 * with `deps` on every call and forwards to `make`'s method. The result is a plain constant a Nest
 * module provides with `useValue`: no layer to assemble at the root, no factory to inject, and a test
 * substitutes a collaborator with `Effect.provideService`. Use it for stateless services, since `make`
 * runs again on each call.
 *
 * ```ts
 * export class UserService extends Context.Service<UserService, UserServiceShape>()("identity/UserService") {
 *   static readonly live = serviceOver(UserRepository, makeUserService);
 * }
 * // module: { provide: UserService, useValue: UserService.live }
 * ```
 */
export function serviceOver<S extends object, P, R>(
	deps: Effect.Effect<P, never, R>,
	make: (deps: P) => S,
): Over<S, R> {
	return new Proxy({} as S, {
		get(_target, key) {
			return (...args: unknown[]) =>
				Effect.flatMap(deps, (resolved) => {
					const method: unknown = Reflect.get(make(resolved), key);
					if (typeof method !== "function") {
						return Effect.die(new Error(`serviceOver: '${String(key)}' is not a method`));
					}
					return (method as (...a: unknown[]) => Effect.Effect<unknown, unknown, unknown>)(...args);
				});
		},
	}) as unknown as Over<S, R>;
}

/**
 * `service` with its Effect methods run through `provide`, so a spec calls a constant service as if it
 * were built over fakes: `provideTo(UserService.live, (e) => e.pipe(Effect.provideService(UserRepository, fake)))`.
 */
export function provideTo<S extends object, Out = never>(
	service: S,
	provide: (effect: Effect.Effect<unknown, unknown, RequirementsOf<S>>) => Effect.Effect<unknown, unknown, Out>,
): {
	readonly [K in keyof S]: S[K] extends (...args: infer A) => Effect.Effect<infer X, infer E, infer _R>
		? (...args: A) => Effect.Effect<X, E, Out>
		: S[K];
} {
	return new Proxy(service, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) =>
				provide((value as (...a: unknown[]) => Effect.Effect<unknown, unknown, RequirementsOf<S>>)(...args));
		},
	}) as never;
}
