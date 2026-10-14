import { Global, Module } from '@nestjs/common'
import { BootstrapOrchestratorService } from './bootstrap-orchestrator.service'
import { EnvModule } from "@/config/env/env.module"
import { GlobalDatabaseModule } from '../database/global/global-database.module'
import { DatabaseModule } from '../database/database.module'
import { SupervisorsPlatformModule } from '../supervisors/platform/platform-supervisors.module'
import { SupervisorsModule } from '@repo/nest-supervisor-core/supervisors.module'

/**
 * BootstrapModule — the global boot coordinator.
 *
 * IT NO LONGER PROVIDES THE SUB-APP BRIDGES. It used to register
 * `SetupWizardBridge` and `MeshInitializerBridge`, which `SubAppRunner` forwarded
 * into the sub-app Nest contexts so one context could hand a result to another.
 * The sub-app pipeline is gone — there is ONE application graph now, so there
 * are no contexts to hand anything between.
 *
 * Those imports were already DEAD here: both bridges were imported and
 * re-provided, but `BootstrapOrchestratorService` never injected either.
 *
 * WHAT IT IMPORTS NOW, AND WHY
 * `BootstrapOrchestratorService` performs the provisioning sequence that used to
 * live in the deleted `OrchestratorService` (swarm overlay → DB probe →
 * migrations → default admin). Those steps are declared here because a module
 * cannot inject what it does not import, and the earlier version of this file
 * worked only because `DatabaseModule` happened to be `@Global()`.
 *
 * Being explicit is the point: the dependencies are visible at the module that
 * needs them instead of arriving through an ambient registration elsewhere.
 */
@Global()
@Module({
  imports: [
    EnvModule,
    GlobalDatabaseModule,
    // Provides `DatabaseStartupGuard` and the global database tokens the service
    // injects.
    DatabaseModule,
    // Provides `SwarmAppWiringSupervisorService` (swarm overlay wiring).
    SupervisorsPlatformModule,
    // Provides `SupervisorOrchestratorService`, which the boot pipeline uses to
    // CONVERGE THE GLOBAL POSTGRES SUPERVISOR before waiting for the database.
    // On a swarm-managed profile that supervisor is what creates the Postgres
    // service, so waiting without converging first waits for something nothing
    // has made.
    SupervisorsModule.forRoot(),
  ],
  providers: [BootstrapOrchestratorService],
  exports: [BootstrapOrchestratorService],
})
export class BootstrapModule {}
