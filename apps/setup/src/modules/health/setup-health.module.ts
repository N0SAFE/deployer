import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";

import { SetupHealthController } from "./setup-health.controller";
import { SetupPhaseService } from "./setup-phase.service";
import { SetupReadinessIndicator } from "./setup-readiness.indicator";

/**
 * Health and lifecycle-phase ownership for the setup app.
 *
 * `SetupPhaseService` is EXPORTED because the cluster, collect and handover
 * modules all advance the phase — it is the single source of truth the compose
 * gate reads, so it must have exactly one instance per process.
 *
 * ── WHY TERMINUS'S OWN LOGGER IS DISABLED ───────────────────────────────────
 * `HealthCheckService.check()` logs `"Health Check has failed!"` at ERROR *and
 * then* throws — before this module's controller can decide how to present the
 * result. For the API that is fine (a failing indicator means something is
 * broken), but for this app it is wrong by construction: the gate is DESIGNED to
 * report 503 for the whole of onboarding, and compose probes it every 10s.
 *
 * Leaving it on produced an ERROR every 10 seconds describing the correct,
 * expected state — which buries the real failures it is supposed to surface.
 *
 * `logger: false` is Terminus's supported way to turn that off. The controller
 * still emits ONE line per transition (see `SetupPhaseService.publish`), so the
 * phase changes remain visible without the per-probe repetition.
 */
@Module({
  imports: [TerminusModule.forRoot({ logger: false })],
  controllers: [SetupHealthController],
  providers: [SetupPhaseService, SetupReadinessIndicator],
  exports: [SetupPhaseService],
})
export class SetupHealthModule {}
