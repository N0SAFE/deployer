import { Module } from "@nestjs/common";

import { SetupHealthModule } from "./modules/health/setup-health.module";

/**
 * Root module of the setup app.
 *
 * Deliberately tiny: this process exists to get the platform onto a cluster and
 * then get out of the way. It has NO product features, NO auth, and NO global
 * database — all of which live in `apps/api`, which is only started once this
 * app has finished.
 *
 * Modules are added here as the phases land:
 *   - wizard/    session state, step orchestration, stream piping
 *   - cluster/   swarm init/join + WireGuard
 *   - handover/  API swarm service creation + ingress retarget, then exit
 */
@Module({
  imports: [SetupHealthModule],
})
export class SetupAppModule {}
