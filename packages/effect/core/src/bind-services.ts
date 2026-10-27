import { Effect, Layer, type Context } from "effect";

/**
 * A class-style implementation whose methods return Effects, with `Deps` taken out of every
 * method's requirements `R`.
 */
export type Bound<T, Deps> = {
	readonly [K in keyof T]: T[K] extends (...args: infer P) => Effect.Effect<infer A, infer E, infer R>
		? (...args: P) => Effect.Effect<A, E, Exclude<R, Deps>>
		: T[K];
};

/**
 * Resolve an implementation's dependencies once, at layer build.
 *
 * Existing services were written as classes whose methods `yield*` their collaborators, so every
 * method carried them in `R`. `bindServices(impl, context)` provides `context` to every Effect a
 * method returns, so a Layer can hand out the service with those requirements already discharged,
 * without rewriting the method bodies. Methods that do not return an Effect are passed through.
 *
 * It is a bridge, not a destination: a service moved onto `makeX(deps)` closures no longer needs it.
 */
export function bindServices<T extends object, Deps>(impl: T, context: Context.Context<Deps>): Bound<T, Deps> {
	return new Proxy(impl, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key, target);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) => {
				const result: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
				return Effect.isEffect(result) ? Effect.provideContext(result, context) : result;
			};
		},
	}) as unknown as Bound<T, Deps>;
}

/** Everything the methods of `T` leave open in `R`. */
export type RequirementsOf<T> = {
	[K in keyof T]: T[K] extends (...args: never[]) => Effect.Effect<unknown, unknown, infer R> ? R : never;
}[keyof T];

/** `T` as `bindServices` hands it out: every requirement discharged. */
export type Discharged<T> = Bound<T, RequirementsOf<T>>;

/**
 * The Layer for a class-style service: the requirements its methods name are resolved when the
 * layer is built, and the service is handed out with none left.
 *
 * ```ts
 * export class WebhookService extends Context.Service<WebhookService, Discharged<WebhookServiceImpl>>()("x") {
 *   static readonly Live = layerOfClass(WebhookService, () => new WebhookServiceImpl());
 * }
 * ```
 */
export function layerOfClass<Id, Impl extends object>(
	tag: Context.Service<Id, Discharged<Impl>>,
	make: () => Impl,
): Layer.Layer<Id, never, RequirementsOf<Impl>> {
	return Layer.effect(
		tag,
		Effect.gen(function* () {
			const context = yield* Effect.context<RequirementsOf<Impl>>();
			return bindServices(make(), context);
		}),
	);
}
