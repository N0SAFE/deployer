import { Module } from "@nestjs/common";

import { EnvModule } from "@/config/env/env.module";
import { SetupClusterModule } from "@/modules/cluster/cluster.module";
import { SetupHealthModule } from "@/modules/health/setup-health.module";
import { WizardModule } from "@/modules/wizard/wizard.module";
import { ApiReadinessWatcherService } from "./services/api-readiness-watcher.service";
import { ApiServiceProvisioner } from "./services/api-service-provisioner.service";
import { HandoverOrchestratorService } from "./services/handover-orchestrator.service";
import { IngressHandoverService } from "./services/ingress-handover.service";
import { SetupExitService } from "./services/setup-exit.service";

/**
 * The handover half of setup: hand the entry port to the full API, then exit.
 *
 * ── WHAT IT OWNS ─────────────────────────────────────────────────────────────
 * Exactly the two things that must happen AFTER the API is green and BEFORE
 * this process exits:
 *
 *   `IngressHandoverService`      rewrites `dynamic-api.yml` and
 *                                 `dynamic-setup.yml` — the only two ingress
 *                                 files setup is allowed to write.
 *   `ApiServiceProvisioner`       resolves the API: an existing compose service
 *                                 in dev, a newly scheduled swarm service in prod.
 *   `ApiReadinessWatcherService`  polls `/health/ready` — the gate.
 *   `HandoverOrchestratorService` sequences the three, in the order plan §9.3
 *                                 requires, as a retry-safe RxJS pipeline.
 *   `SetupExitService`            decides WHEN this app may stop (on `ready`
 *                                 only — never on `failed`, so onboarding stays
 *                                 retryable). `main.ts` owns the mechanism.
 *
 * ── WHY IT IMPORTS `SetupHealthModule`, NOT `SetupClusterModule` ─────────────
 * The handover is TRIGGERED BY the gate opening — a phase EDGE on
 * `SetupPhaseService`, published by `SetupGateService` in `WizardModule`. The
 * cluster module is not a dependency: it only advances the phase to
 * `collecting`, which is what makes the wizard available to open the gate in the
 * first place.
 *
 * (An earlier version subscribed to `ClusterOrchestratorService.stream$` instead,
 * which scheduled the API before the operator had supplied a database.)
 *
 * ── WHY IT IMPORTS `WizardModule` RATHER THAN REDECLARING AN HTTP CLIENT ─────
 * `WizardUpstreamService` already owns "where the API answers and how to reach
 * it" — including trailing-slash normalization and the 503-when-unreachable
 * translation. `ApiReadinessWatcherService` needs exactly that, so it consumes
 * the existing service instead of a second fetch wrapper that would drift.
 *
 * ── WHY `DockerModule` IS NOT IMPORTED HERE ────────────────────────────────
 * It is `@Global()`, registered by `SetupClusterModule` with this app's engine
 * configuration. Importing it again would register a second wiring of the same
 * client.
 */
@Module({
  imports: [EnvModule, SetupHealthModule, WizardModule],
  providers: [
    IngressHandoverService,
    ApiServiceProvisioner,
    ApiReadinessWatcherService,
    HandoverOrchestratorService,
    SetupExitService,
  ],
  exports: [HandoverOrchestratorService, IngressHandoverService, SetupExitService],
})
export class HandoverModule {}
