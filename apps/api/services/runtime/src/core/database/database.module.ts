import { createGlobalModule } from '@deployer/nest-effect'
import { DatabaseModule } from '@deployer/shared/core/modules/database/database.module'
import { GlobalDatabaseService } from '@deployer/shared/core/modules/database/services/global-database.service'

import { RuntimeDatabasePort } from './runtime-db'

/**
 * The app's `RuntimeDatabasePort`, global.
 *
 * Repositories are constants that `yield* RuntimeDatabasePort` when a method runs, so the port must be visible to
 * every module's scoped request context — exactly what `@Global()` means. It was a `DeploymentDomainModule` provider
 * before the request context became per-module: a sibling module's providers are invisible, and the first docker
 * request would fail with `Service not found: runtime/RuntimeDatabasePort`.
 */
export const RuntimeDatabaseModule = createGlobalModule({
    imports: [DatabaseModule],
    providers: [
        { provide: RuntimeDatabasePort, useExisting: GlobalDatabaseService },
    ],
    exports: [RuntimeDatabasePort],
})
