import { createModuleContext } from '@deployer/nest-effect'
import { DatabaseModule } from '@deployer/shared/core/modules/database/database.module'
import { ConfigurationCoreModule } from '@deployer/shared/core/modules/configuration/configuration-core.module'

/**
 * The permission domain.
 *
 * It has no controller: `PermissionService` and `PermissionRepository` are Layers (see
 * `permission.layers.ts`) that the app's Effect runtime builds over `DatabasePort`.
 */
export class PermissionDomainModule extends createModuleContext({
    imports: [DatabaseModule, ConfigurationCoreModule],
}) {}
