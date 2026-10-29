import type { HealthSnapshot } from "@deployer/shared/server";
import { Context, Effect } from "effect";

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
 * Tag and implementation together: the tag is the contract, `live` the one implementation. No class,
 * no decorator, no factory: the service is a plain record whose dependency (the registry) is yielded
 * inside `check()`, so it is a constant a Nest module provides as `{ provide: HealthService, useValue:
 * HealthService.live }`.
 */
export class HealthService extends Context.Service<HealthService, HealthServiceShape>()(
  "health/HealthService",
) {
  static readonly live: HealthServiceShape = {
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
