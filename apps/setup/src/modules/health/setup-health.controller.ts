import { Controller, Get, HttpCode, Res } from "@nestjs/common";
import { HealthCheckService } from "@nestjs/terminus";
import type { Response } from "express";

import { SetupPhaseService } from "./setup-phase.service";
import { SetupReadinessIndicator } from "./setup-readiness.indicator";

/**
 * The setup app's health surface.
 *
 * Two endpoints with deliberately different audiences:
 *
 *  - `GET /setup/health` — the COMPOSE GATE. Binary, real status codes. 200 only
 *    once the handover is complete, so `api-dev`/`web-dev` gate on it and the
 *    dashboard can never start on a half-built platform.
 *  - `GET /setup/state` — the WIZARD's view. Always 200, carries the phase,
 *    whether the API is up/ready, and the detail string. Kept out of the health
 *    endpoint so the gate never has to interpret nuance.
 *
 * Neither is authenticated: the setup app is pre-auth by definition (there is no
 * user database yet). Neither exposes secrets — only phase names and booleans.
 */
@Controller("setup")
export class SetupHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: SetupReadinessIndicator,
    private readonly phases: SetupPhaseService,
  ) {}

  /**
   * The compose gate.
   *
   * Uses `@Res()` directly rather than throwing so the Terminus verdict is
   * translated explicitly: Terminus signals "down" by throwing
   * `ServiceUnavailableException`, and letting that propagate would make a
   * normal not-ready state look like a crash in the logs.
   */
  @Get("health")
  async healthCheck(@Res() res: Response): Promise<void> {
    try {
      const result = await this.health.check([() => Promise.resolve(this.indicator.check())]);
      res.status(200).json(result);
    } catch (error: unknown) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.();
      res.status(503).json(
        response ?? {
          status: "error",
          error: { setup: { status: "down", reason: "readiness probe failed" } },
        },
      );
    }
  }

  /**
   * The wizard's read model. Always 200 — "not ready yet" is data here, not an
   * error, which keeps the browser console clean while setup runs.
   */
  @Get("state")
  @HttpCode(200)
  state() {
    return this.phases.current();
  }
}
