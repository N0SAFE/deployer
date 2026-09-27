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
 */
@Module({
  imports: [TerminusModule],
  controllers: [SetupHealthController],
  providers: [SetupPhaseService, SetupReadinessIndicator],
  exports: [SetupPhaseService],
})
export class SetupHealthModule {}
