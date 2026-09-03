import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { HealthService } from '../services/health.service';
import { healthContract } from '@repo/api-contracts';
import { requireAuth } from '@/core/modules/auth/orpc/middlewares';
import { rateLimit } from '@/modules/platform/orpc/middlewares';

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

  @Implement(healthContract.detailed)
  detailed() {
    return implement(healthContract.detailed).use(requireAuth()).handler(async () => {
      return await this.healthService.getDetailedHealth();
    });
  }
}
