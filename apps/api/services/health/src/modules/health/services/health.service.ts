import { Context, Effect } from "effect";

import type { HealthSnapshot } from "@deployer/shared/server";

import { HealthCheckFailed } from "../health.errors";

/**
 * The shared registry, as this service sees it: one pass, no failure.
 *
 * A port, not the registry class: this service may only run a pass, and the requirement gate reads what it yields.
 */
export type HealthRegistryShape = {
  readonly runOnce: () => Effect.Effect<HealthSnapshot>;
}

export class HealthRegistryRepository extends Context.Service<
  HealthRegistryRepository,
  HealthRegistryShape
>()("health/HealthRegistryRepository") {}

/**
 * Seconds since the process started, as a function.
 *
 * A dependency rather than a direct `process.uptime()` call: a test asserts an
 * exact value (42) instead of racing wall time, and the bug this replaces
 * (`process.uptime() / 1000` in the controller) is what the expectation catches.
 */
export class UptimeSource extends Context.Service<UptimeSource, () => number>()(
  "health/UptimeSource",
) {}

/** This service's own verdict: `ok` only when every indicator is up. */
export type HealthStatus = "ok" | "degraded";

/**
 * The domain report: the snapshot, already translated for consumers.
 *
 * `status`, `timestamp`, `service` and `uptime` are decided here, once, so the
 * controller has nothing left to compute; `info`/`error`/`details`/`indicators`
 * are the snapshot's own fields, passed through untouched.
 */
export type HealthReport = {
  readonly status: HealthStatus;
  readonly timestamp: Date;
  readonly service: string;
  /** Seconds since the process started — never milliseconds. */
  readonly uptime: number;
  readonly info: HealthSnapshot["info"];
  readonly error: HealthSnapshot["error"];
  readonly details: HealthSnapshot["details"];
  readonly indicators: HealthSnapshot["indicators"];
};

/** The one place the service's name is written. */
export const SERVICE_NAME = process.env.SERVICE_NAME ?? "svc-health";

export type HealthServiceShape = {
  readonly report: () => Effect.Effect<
    HealthReport,
    HealthCheckFailed,
    HealthRegistryRepository | UptimeSource
  >;
}

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation. No class,
 * no decorator, no factory: the service is a plain record whose dependencies (the registry, the clock)
 * are yielded inside `report()`, so it is a constant a Nest module provides as `{ provide:
 * HealthService, useClass: HealthService.live }`.
 */
export class HealthService extends Context.Service<HealthService, HealthServiceShape>()(
  "health/HealthService",
) {
  static readonly live = class HealthServiceImpl implements HealthServiceShape {
    report(): ReturnType<HealthServiceShape["report"]> {
      return Effect.gen(function* () {
        const registry = yield* HealthRegistryRepository;
        const uptime = yield* UptimeSource;

        const snapshot = yield* registry.runOnce().pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new HealthCheckFailed({
                message: "Health registry failed to produce a snapshot",
                cause,
              }),
            ),
          ),
        );

        return {
          status: snapshot.status === "up" ? "ok" : "degraded",
          timestamp: new Date(snapshot.checkedAt),
          service: SERVICE_NAME,
          // `process.uptime()` is already seconds, which is what the contract declares: no division.
          uptime: uptime(),
          info: snapshot.info,
          error: snapshot.error,
          details: snapshot.details,
          indicators: snapshot.indicators,
        };
      });
    }
  };
}
