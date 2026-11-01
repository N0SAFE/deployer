import { Context, Effect, Layer } from "effect";

export type Snapshot = { readonly status: "up" | "down"; readonly checkedAt: string };

/** The shared registry, provided by Nest and exposed to Effect as a port. */
export class HealthRegistry extends Context.Service<
	HealthRegistry,
	{ readonly runOnce: () => Effect.Effect<Snapshot> }
>()("health/HealthRegistry") {}

/** The use case a handler yields. */
export class HealthService extends Context.Service<
	HealthService,
	{ readonly check: () => Effect.Effect<Snapshot> }
>()("health/HealthService") {}

/**
 * The service is a layer, so its requirement is part of its type:
 * `Layer<HealthService, never, HealthRegistry>`.
 *
 * That single fact is what the module check reads: the module must provide
 * `HealthRegistry` (or import the module that does), or it does not compile.
 */
export const HealthLive = Layer.effect(
	HealthService,
	Effect.gen(function* () {
		const registry = yield* HealthRegistry;
		return { check: () => registry.runOnce() };
	}),
);
