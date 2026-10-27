import { Injectable } from "@nestjs/common";
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
 * Effect key AND NestJS token.
 *
 * A `Context.Service` tag is a pure key: it has a `never` constructor by design
 * and is never instantiated. The implementation below is the normal class Nest
 * constructs, registered under this token.
 */
export class HealthService extends Context.Service<HealthService, HealthServiceShape>()(
  "health/HealthService",
) {}

/**
 * The implementation. No constructor injection: the registry is an Effect
 * service (`HealthRegistryRepository`), yielded inside `check()`.
 */
@Injectable()
export class HealthServiceImpl implements HealthServiceShape {
  check(): Effect.Effect<HealthSnapshot, HealthCheckFailed, HealthRegistryRepository> {
    return Effect.gen(function* () {
      const registry = yield* HealthRegistryRepository;

      return yield* Effect.tryPromise({
        try: () => registry.runOnce(),
        catch: (cause) =>
          new HealthCheckFailed({
            message: "Health registry failed to produce a snapshot",
            cause,
          }),
      });
    });
  }
}
