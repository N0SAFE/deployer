import { createModuleContext } from '@deployer/nest-effect'
import { DatabaseModule } from '@deployer/shared/core/modules/database/database.module'
import { ConfigurationCoreModule } from '@deployer/shared/core/modules/configuration/configuration-core.module'
import {
    PermissionRepository,
    PermissionRepositoryImpl,
} from './repositories/permission.repository'
import {
    PermissionService,
    PermissionServiceImpl,
} from './services/permission.service'

/**
 * The permission domain.
 *
 * `DatabasePort` is provided once by the root module; the repository and the
 * service are Effect tokens backed by normal NestJS providers.
 */
export class PermissionDomainModule extends createModuleContext({
    imports: [DatabaseModule, ConfigurationCoreModule],
    providers: [
        { provide: PermissionRepository, useClass: PermissionRepositoryImpl },
        { provide: PermissionService, useClass: PermissionServiceImpl },
    ],
    exports: [PermissionService, PermissionRepository],
}) {}
