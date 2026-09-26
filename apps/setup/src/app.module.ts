import { Module } from "@nestjs/common";

import { EnvModule } from "./config/env/env.module";
import { SetupClusterModule } from "./modules/cluster/cluster.module";
import { HandoverModule } from "./modules/handover/handover.module";
import { SetupHealthModule } from "./modules/health/setup-health.module";
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
 *   - cluster/   swarm init/join + node policy  (landed)
 *   - wizard/    the onboarding page + stream piping  (landed)
 *   - handover/  API resolution + ingress retarget + exit gating  (landed)
 *
 * ORDER MATTERS. `EnvModule` is first so a malformed environment fails
 * immediately with a readable message, before any module attempts to read a
 * value. `SetupClusterModule` follows because it derives its configuration from
 * the validated env and starts work on `onApplicationBootstrap`.
 */
@Module({
  imports: [EnvModule, SetupHealthModule, SetupClusterModule, WizardModule, HandoverModule],
})
export class SetupAppModule {}
