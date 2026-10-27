import { Controller } from '@nestjs/common';
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { HealthService } from '../services/health.service';
import { healthContract } from "@deployer/health-contracts";
import { AllowAnonymous } from '@/core/modules/auth/decorators/decorators';
import { requireAuth } from '@/core/modules/auth/orpc/middlewares';
import { rateLimit } from '@/core/modules/rate-limit/rate-limit.middleware';

/**
 * The liveness surface.
 *
 * ── WHY `@AllowAnonymous()` IS REQUIRED HERE ────────────────────────────────
 * The global `APP_GUARD` AuthGuard runs at the NEST layer, before any oRPC
 * middleware, so `.use(rateLimit(...))` on `check()` does not make the route
 * public — without this decorator every probe returns 401. The guard reads the
 * `PUBLIC` metadata this decorator sets (`getAllAndOverride("PUBLIC", ...)`), and
 * a readiness probe that requires a session is a readiness probe that always
 * fails: Compose healthchecks and the ingress have no cookie to present.
 *
 * It is applied at the CONTROLLER level rather than per route because `detailed()`
 * carries its own `requireAuth()`; the guard is the coarser of the two gates, and
 * letting it through is what lets the finer one decide. Leaving it off `detailed`
 * as well would have made the "detailed requires auth" e2e pass for the wrong
 * reason (a 401 from the guard rather than from `requireAuth`).
 */
@AllowAnonymous()
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Implement the entire health contract
   * This endpoint is public (no auth required)
   */
  @Implement(healthContract.check)
  check() {
    return implement(healthContract.check)
      // W-P3: public probe endpoint — generous ceiling for compose
      // healthchecks, fail-closed 429 on abuse (shared TOO_MANY_REQUESTS).
      .use(rateLimit({ windowMs: 60_000, max: 300, message: "Too many health probes" }))
      .handler(() => {
        return this.healthService.getHealth();
      });
  }

  /**
   * The detailed report.
   *
   * ── WHY THIS IS A PASS-THROUGH ──────────────────────────────────────────────
   * `getDetailedHealth()` already returns the CONTRACT's shape: Terminus' own
   * `info`/`error`/`details` records, the flattened `indicators` list, and the
   * supervisor snapshots. The service built them from the readiness probe, so there
   * is nothing left for the controller to derive.
   *
   * It used to re-derive `indicators` from a `health.database` field plus one
   * synthetic entry per supervisor — a second implementation of the same list, which
   * stopped compiling the moment the service gained the contract's own fields (a
   * report has `details`, not `database`). Re-deriving here would also let the two
   * disagree about which checks exist, which is exactly what
   * `READINESS_INDICATOR_NAMES` in the service exists to prevent.
   */
  @Implement(healthContract.detailed)
  detailed() {
    return implement(healthContract.detailed).use(requireAuth()).handler(async () => {
      return this.healthService.getDetailedHealth();
    });
  }
}
