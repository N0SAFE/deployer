import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { Cause, Effect } from "effect";

import { Actor } from "@deployer/effect-core";
import { handle, provideRequest, type RequestContextInput } from "@deployer/effect-orpc";
import { healthContract } from "@deployer/health-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth, requirePlatformRole } from "@deployer/shared/core/modules/auth/orpc/middlewares";



import { HealthService } from "../services/health.service";

/**
 * One pass through the Effect service, translated to the typed contract
 * boundary. `HealthCheckFailed` is the ONLY domain error: its kind
 * (`dependency_missing`) maps to the declared `FAILED_DEPENDENCY`, so the client sees it as a defined error.
 * A DOWN indicator is not an error — it is the report.
 */
function report(context: RequestContextInput) {
  return Effect.gen(function* () {
    const health = yield* HealthService;
    return yield* health.report();
  }).pipe(
    // `handle` reads the correlation id, so the request provider wraps it.
    handle((cause, correlationId) => {
      console.error(`[svc-health] defect ${correlationId}`, Cause.pretty(cause));
    }),
    // `check` is public: an anonymous caller acts as a named anonymous user.
    provideRequest(context, () => Effect.succeed(Actor.user("anonymous", "anonymous"))),
  );
}

/** The indicator detail names hosts and dependencies: operators and above, unlike the public liveness summary. */
const HEALTH_OPERATOR_ROLES = ["superAdmin", "admin", "operator"];

/**
 * The health service's oRPC surface.
 *
 * ── NO INJECTION, NO RUNTIME CALL ──────────────────────────────────────────
 * `.effect()` resolves `HealthService` from `effect/context`, which the shared
 * oRPC host fills from `EffectHost.contextFor()` — the context of THIS module.
 * This controller only maps the domain report to the shapes its contract declares.
 *
 * The requirements are not declared: `procedure(...).effect(...)` returns the `R`
 * of `report()`, so the module audit sees `HealthService | HealthRegistryRepository | UptimeSource`
 * without a single wiring line.
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
    return procedure(healthContract.check).effect(function* ({ context }) {
      const { status, timestamp, service, indicators } = yield* report(context);

      return { status, timestamp, service, indicators };
    });
  }

  /**
   * The detailed report — Terminus' own payload shape.
   *
   * `info`/`error`/`details` are passed through UNCHANGED, because that is what
   * a Terminus client and the Terminus UI already understand. `supervisors` stays
   * here: it is a BFF roll-up, not a fact this service owns (EFF-056).
   */
  @Implement(healthContract.detailed)
  detailed() {
    return procedure(healthContract.detailed)
      .use(requireAuth())
      .use(requirePlatformRole(HEALTH_OPERATOR_ROLES))
      .effect(function* ({ context }) {
        return { ...(yield* report(context)), supervisors: [] };
      });
  }
}
