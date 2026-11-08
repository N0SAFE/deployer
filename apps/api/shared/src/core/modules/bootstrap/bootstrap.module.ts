import { AppLifecycle, type AppLifecycleShape } from '@deployer/lifecycle'
import {
    createGlobalModule,
    effectHostProvider,
    serviceLifecycle,
} from '@deployer/nest-effect'
import {
    NodeConfigRepository,
    type NodeConfigRepositoryShape,
} from '@deployer/node-state'
import {
    SupervisorOrchestrator,
    type SupervisorOrchestratorShape,
} from '@deployer/supervision'

import { EnvModule } from '../../../config/env/env.module'
import {
    GLOBAL_DATABASE_CONNECTION,
    GLOBAL_DATABASE_POOL,
} from '../database/database-connection'
import { DatabaseModule } from '../database/database.module'
import { GlobalDatabaseModule } from '../database/global/global-database.module'
import {
    BootstrapAdvisoryLockService,
    type BootstrapAdvisoryLockServiceShape,
} from '../database/services/bootstrap-advisory-lock.service'
import {
    DatabaseStartupGuard,
    type DatabaseStartupGuardShape,
} from '../database/services/database-startup-guard.service'
import { SupervisorsModule } from '../supervision/index'
import { SupervisorsPlatformModule } from '../supervisors/platform/platform-supervisors.module'

import {
    BootstrapOrchestratorService,
} from './bootstrap-orchestrator.service'

import type { GlobalDatabase } from '../database/global/global-database.service'
import type { Pool } from 'pg'

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
export const BootstrapModule = createGlobalModule({
    imports: [
        EnvModule,
        GlobalDatabaseModule,
        // Provides `DatabaseStartupGuard` and the global database tokens the service
        // injects.
        DatabaseModule,
        // Registers the swarm overlay wiring supervisor.
        SupervisorsPlatformModule,
        // Provides the `SupervisorOrchestrator`, which the boot pipeline uses to
        // CONVERGE THE GLOBAL POSTGRES SUPERVISOR before waiting for the database.
        // On a swarm-managed profile that supervisor is what creates the Postgres
        // service, so waiting without converging first waits for something nothing
        // has made.
        SupervisorsModule.forRoot(),
    ],
    providers: [
        effectHostProvider(),
        {
            provide: BootstrapOrchestratorService,
            useFactory: (
                pool: Pool,
                db: GlobalDatabase,
                nodeConfigRepository: NodeConfigRepositoryShape,
                lifecycle: AppLifecycleShape,
                startupGuard: DatabaseStartupGuardShape,
                bootstrapLock: BootstrapAdvisoryLockServiceShape,
                orchestrator: SupervisorOrchestratorShape
            ) =>
                new BootstrapOrchestratorService.live({
                    pool,
                    db,
                    nodeConfigRepository,
                    lifecycle,
                    startupGuard,
                    bootstrapLock,
                    orchestrator,
                }),
            inject: [
                GLOBAL_DATABASE_POOL,
                GLOBAL_DATABASE_CONNECTION,
                NodeConfigRepository,
                AppLifecycle,
                DatabaseStartupGuard,
                BootstrapAdvisoryLockService,
                SupervisorOrchestrator,
            ],
        },
        serviceLifecycle(BootstrapOrchestratorService),
    ],
    exports: [BootstrapOrchestratorService],
})
