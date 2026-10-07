import { Module } from "@nestjs/common";

import { EnvModule } from "./config/env/env.module";
import { SetupClusterModule } from "./modules/cluster/cluster.module";
import { HandoverModule } from "./modules/handover/handover.module";
import { SetupHealthModule } from "./modules/health/setup-health.module";
import { SetupIngressModule } from "./modules/ingress/setup-ingress.module";
import { SetupProgressModule } from "./modules/progress/progress.module";
import { WizardModule } from "./modules/wizard/wizard.module";

/**
 * Root module of the setup app.
 *
 * Deliberately tiny: this process exists to get the platform onto a cluster and
 * then get out of the way. It has NO product features, NO auth, and NO global
 * database — all of which live in `apps/api`, which is only started once this
 * app has finished.
 *
 * Modules:
 *   - ingress/   the bootstrap Traefik that makes this app reachable  (landed)
 *   - cluster/   swarm init/join + node policy  (landed)
 *   - wizard/    the onboarding page + stream piping  (landed)
 *   - handover/  API resolution + ingress retarget + exit gating  (landed)
 *
 * ORDER MATTERS. `EnvModule` is first so a malformed environment fails
 * immediately with a readable message, before any module attempts to read a
 * value. `SetupIngressModule` follows because this app is reachable ONLY through
 * the ingress it starts — every module below it is served through that ingress.
 * `SetupClusterModule` next because it derives its configuration from the
 * validated env and starts work on `onApplicationBootstrap`.
 */
@Module({
  imports: [
    EnvModule,
    SetupIngressModule,
    SetupHealthModule,
    SetupClusterModule,
    SetupProgressModule,
    WizardModule,
    HandoverModule,
  ],
})
export class SetupAppModule {}
