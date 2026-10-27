import type { HealthSnapshot } from "@deployer/shared/server";
import { Context, Effect, Layer } from "effect";

import { HealthCheckFailed } from "../health.errors";

export type HealthRegistryShape = {
  readonly runOnce: () => Promise<HealthSnapshot>;
}

export class HealthRegistryRepository extends Context.Service<
  HealthRegistryRepository,
  HealthRegistryShape
>()("health/HealthRegistryRepository") {}

export type HealthServiceShape = {
  readonly check: () => Effect.Effect<HealthSnapshot, HealthCheckFailed, HealthRegistryRepository>;
}

/**
 * Tag and implementation together: the tag is the contract, `Live` the one
 * implementation. No class, no decorator: the service is a plain record built
 * by `makeHealthService`, so it needs no Nest to exist.
 */
export class HealthService extends Context.Service<HealthService, HealthServiceShape>()(
  "health/HealthService",
) {
  static readonly Live: Layer.Layer<HealthService> = Layer.succeed(HealthService, makeHealthService());
}

/** The registry is an Effect service, yielded inside `check()`. */
export function makeHealthService(): HealthServiceShape {
  return {
    check: Effect.fn("HealthService.check")(function* () {
      const registry = yield* HealthRegistryRepository;

      return yield* Effect.tryPromise({
        try: () => registry.runOnce(),
        catch: (cause) =>
          new HealthCheckFailed({
            message: "Health registry failed to produce a snapshot",
            cause,
          }),
      });
    }),
  };
}
