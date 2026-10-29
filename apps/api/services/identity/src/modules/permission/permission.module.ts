import { createModuleContext } from '@deployer/nest-effect'
import { DatabaseModule } from '@deployer/shared/core/modules/database/database.module'
import { ConfigurationCoreModule } from '@deployer/shared/core/modules/configuration/configuration-core.module'

import { PermissionRepository } from './repositories/permission.repository'
import { PermissionService } from './services/permission.service'

/**
 * The permission domain.
 *
 * It has no controller: `PermissionService` and `PermissionRepository` are constants provided here;
 * the repository reads `DatabasePort` from the Effect context when a method runs.
 */
export class PermissionDomainModule extends createModuleContext({
    imports: [DatabaseModule, ConfigurationCoreModule],
    providers: [
        { provide: PermissionService, useValue: PermissionService.live },
        { provide: PermissionRepository, useValue: PermissionRepository.live },
    ],
}) {}
