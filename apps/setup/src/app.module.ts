import { Module } from "@nestjs/common";

import { EnvModule } from "./config/env/env.module";
import { SetupHealthModule } from "./modules/health/setup-health.module";
import { SetupClusterModule } from "./modules/cluster/cluster.module";
import { WizardModule } from "./modules/wizard/wizard.module";

/**
 * Root module of the setup app.
 *
 * Deliberately tiny: this process exists to get the platform onto a cluster and
 * then get out of the way. It has NO product features, NO auth, and NO global
 * database — all of which live in `apps/api`, which is only started once this
 * app has finished.
 *
 * Modules are added here as the phases land:
 *   - cluster/   swarm init/join + node policy  (landed)
 *   - wizard/    the onboarding page + stream piping  (landed)
 *   - handover/  API swarm service creation + ingress retarget, then exit
 *
 * ORDER MATTERS. `EnvModule` is first so a malformed environment fails
 * immediately with a readable message, before any module attempts to read a
 * value. `SetupClusterModule` follows because it derives its configuration from
 * the validated env and starts work on `onApplicationBootstrap`.
 */
@Module({
  imports: [EnvModule, SetupHealthModule, SetupClusterModule, WizardModule],
})
export class SetupAppModule {}
