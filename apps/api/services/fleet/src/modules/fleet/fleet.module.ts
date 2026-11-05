import { createModuleContext } from '@deployer/nest-effect'
import { ConfigurationCoreModule } from '@deployer/shared/core/modules/configuration/configuration-core.module'
import { GlobalDatabaseModule } from '@deployer/shared/core/modules/database/global/global-database.module'
import { GlobalDatabaseService } from '@deployer/shared/core/modules/database/services/global-database.service'

import { FleetController } from './controllers/fleet.controller'
import {
    FleetDatabasePort,
    FleetRepository,
} from './repositories/fleet.repository'
import { FleetService } from './services/fleet.service'

/**
 * Cluster fleet: servers, allocations and admission requests.
 *
 * `FleetService` and `FleetRepository` are Layers (see `fleet.layers.ts`) built by the app's Effect
 * runtime over the shared global database, which this module exposes as `FleetDatabasePort`.
 *
 * The rollout, DAG, readiness-gate, rollback, containment, cross-project-gate and drift services
 * are plain pure classes with no consumer in this app yet, so nothing registers them.
 */
export class FleetModule extends createModuleContext({
    imports: [ConfigurationCoreModule, GlobalDatabaseModule],
    controllers: [FleetController],
    providers: [
        { provide: FleetDatabasePort, useExisting: GlobalDatabaseService },
        { provide: FleetRepository, useValue: FleetRepository.live },
        { provide: FleetService, useValue: FleetService.live },
    ],
}) {}
