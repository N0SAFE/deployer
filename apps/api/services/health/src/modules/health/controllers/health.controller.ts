import { Controller } from "@nestjs/common";
import { standardErrorActions } from "@deployer/orpc-utils";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { EffectContextOf } from "@deployer/nest-effect";

import { HealthDomainModule } from "../health.module";
import { Effect } from "effect";

import { healthContract } from "@deployer/health-contracts";

import { HealthService } from "../services/health.service";

/**
 * One pass through the Effect service, translated to the typed contract
 * boundary. `HealthCheckFailed` is the ONLY domain error: it becomes the
 * declared `FAILED_DEPENDENCY`, so the client sees it as a defined error.
 * A DOWN indicator is not an error — it is the report.
 */
function snapshot() {
  return Effect.gen(function* () {
    const health = yield* HealthService;
    return yield* health.check();
  }).pipe(
    Effect.catchTag("HealthCheckFailed", (error) =>
      Effect.fail(standardErrorActions.FAILED_DEPENDENCY(error.message)),
    ),
  );
}

/**
 * The health service's oRPC surface.
 *
 * ── NO INJECTION, NO RUNTIME CALL ──────────────────────────────────────────
 * `.effect()` resolves `HealthService` from `effect/context`, which the shared
 * oRPC host fills from the app's `EffectRuntime`. This controller only maps
 * snapshots to the shapes its contract declares.
 */
@Controller()
export class HealthController {
  /**
   * Liveness + the indicator summary.
   *
   * Runs a real pass so the answer is a fact, not a cached opinion.
   */
  @Implement(healthContract.check)
  check() {
    return implement(healthContract.check).use(HealthDomainModule[EffectContextOf]).effect(function* () {
      const result = yield* snapshot();

      return {
        status: result.status === "up" ? "ok" : "degraded",
        timestamp: new Date(result.checkedAt),
        service: "svc-health",
        indicators: result.indicators,
      };
    });
  }

  /**
   * The detailed report — Terminus' own payload shape.
   *
   * `info`/`error`/`details` are passed through UNCHANGED, because that is what
   * a Terminus client and the Terminus UI already understand.
   */
  @Implement(healthContract.detailed)
  detailed() {
    return implement(healthContract.detailed).use(HealthDomainModule[EffectContextOf]).effect(function* () {
      const result = yield* snapshot();

      return {
        status: result.status === "up" ? "ok" : "degraded",
        timestamp: new Date(result.checkedAt),
        service: "svc-health",
        uptime: process.uptime() / 1000,
        info: result.info,
        error: result.error,
        details: result.details,
        indicators: result.indicators,
        supervisors: [],
      };
    });
  }
}
