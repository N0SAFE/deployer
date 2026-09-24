import { Injectable, Logger } from "@nestjs/common";
import { HealthCheckService } from "@nestjs/terminus";

import type { IReadinessProbe, ReadinessResult } from "@/core/orchestrator/readiness.port";
import { ReadinessIndicators } from "../indicators/readiness.indicators";

// Re-exported so existing importers of this module keep working; the contract
// itself lives in core, because CORE is the consumer (SC7: core must not
// import a product module, so the interface sits on core's side of the seam).
export type { ReadinessResult } from "@/core/orchestrator/readiness.port";

/**
 * Readiness probe for the platform.
 *
 * Wraps the Terminus `HealthCheckService` so callers (the Express route in
 * `main.ts`) get a plain `{ statusCode, body }` instead of an exception to
 * catch. Terminus itself decides the verdict: it returns `200` when every
 * indicator is up and throws `ServiceUnavailableException` (503) when any is
 * down, carrying the per-indicator payload.
 *
 * WHY a wrapper rather than returning `health.check()` straight from a
 * controller: the readiness route is registered on the Express gateway BEFORE
 * Nest boots (so the probe answers during startup, exactly like `/health`),
 * which means it cannot be a Nest controller route. This service is the seam
 * that keeps the Terminus wiring in the DI container while the route stays an
 * express handler.
 */
@Injectable()
export class ReadinessService implements IReadinessProbe {
  private readonly logger = new Logger(ReadinessService.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: ReadinessIndicators,
  ) {}

  /**
   * Run every readiness indicator. NEVER throws — a failing dependency is a
   * `503` result, because "a dependency is down" is a legitimate answer to a
   * readiness question, not an error in the probe itself.
   */
  async probe(): Promise<ReadinessResult> {
    const checkedAt = new Date().toISOString();

    try {
      const result = await this.health.check([
        () => this.indicators.database(),
        () => this.indicators.swarm(),
        () => this.indicators.services(),
        () => this.indicators.mesh(),
      ]);
      return { statusCode: 200, body: { status: "ok", info: result.info, checkedAt } };
    } catch (error: unknown) {
      // Terminus signals "down" by throwing ServiceUnavailableException whose
      // response IS the health payload (info + error). Anything else is a bug
      // in an indicator, so it is logged and reported as a down database-less
      // payload rather than being swallowed.
      const response = (error as { getResponse?: () => unknown }).getResponse?.();
      if (response !== undefined && typeof response === "object" && response !== null) {
        const payload = response as { info?: Record<string, unknown>; error?: Record<string, unknown> };
        return {
          statusCode: 503,
          body: { status: "error", info: payload.info ?? {}, error: payload.error ?? {}, checkedAt },
        };
      }

      this.logger.error(
        `Readiness probe failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        statusCode: 503,
        body: {
          status: "error",
          error: { probe: { reason: error instanceof Error ? error.message : "unknown probe failure" } },
          checkedAt,
        },
      };
    }
  }
}
