/**
 * DatabaseModule — Provides GLOBAL_DATABASE_POOL, GLOBAL_DATABASE_CONNECTION, GlobalDatabaseService,
 * LocalDatabaseService, LOCAL_DATABASE_CONNECTION, DatabaseProbeService, DatabaseStartupGuard,
 * and DatabaseFailureTracker.
 *
 * @Global() so all modules can inject database services without explicit import.
 *
 * The three database services below are the new architecture's foundation:
 * - DatabaseProbeService: Reusable DB connectivity probing with categorized error messages
 * - DatabaseStartupGuard: Verifies DB is reachable at startup, fails with diagnostic if not
 * - DatabaseFailureTracker: Observer that counts failures and transitions lifecycle to degraded
 */

import { Global, Module } from '@nestjs/common'
import { AppLifecycleModule } from '@deployer/nest-lifecycle'
import { GlobalDatabaseModule } from '@/core/modules/database/global/global-database.module'
import { LocalDatabaseModule } from "@deployer/nest-database-local/local-database.module"
import { DatabaseProbeService } from '@/core/modules/database/services/database-probe.service'
import { DatabaseStartupGuard } from '@/core/modules/database/services/database-startup-guard.service'
import { DatabaseFailureTracker } from '@/core/modules/database/services/database-failure-tracker.service'

@Global()
@Module({
    imports: [
        LocalDatabaseModule,
        GlobalDatabaseModule,
        // `forRoot()` IS REQUIRED — the class is `@Module({})`, so importing it
        // bare registers no providers and `DatabaseStartupGuard` (which injects
        // `AppLifecycleService`) cannot resolve.
        AppLifecycleModule.forRoot(),
    ],
    providers: [
        DatabaseProbeService,
        DatabaseStartupGuard,
        DatabaseFailureTracker,
    ],
    exports: [
        LocalDatabaseModule,
        GlobalDatabaseModule,
        DatabaseProbeService,
        DatabaseStartupGuard,
        DatabaseFailureTracker,
    ],
})
export class DatabaseModule {}
