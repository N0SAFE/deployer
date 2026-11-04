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

import { createGlobalModule } from "@deployer/nest-effect"

import { AppLifecycleModule } from '../lifecycle'

import { GlobalDatabaseModule } from './global/global-database.module'
import { LocalDatabaseModule } from "./local/local-database.module";
import { BootstrapAdvisoryLockService } from './services/bootstrap-advisory-lock.service'
import { DatabaseFailureTracker } from './services/database-failure-tracker.service'
import { DatabaseProbeService } from './services/database-probe.service'
import { GlobalDatabaseService } from './services/global-database.service'
import { DatabaseStartupGuard } from './services/database-startup-guard.service'
import { DatabasePort } from './storage'

export const DatabaseModule = createGlobalModule({
    imports: [
        // The SHARED wrapper, not `@deployer/nest-database-local`'s class: that one is
        // a bare `@Module({})` and registers nothing, so importing it left the local
        // SQLite connection uncreated and `LocalDatabaseLifecycleService.onModuleInit`
        // (which applies the migrations) never ran — every read then failed with
        // `no such table: node_config`. The shared wrapper is what calls
        // `forRootAsync` with the path and the migrations directory.
        LocalDatabaseModule,
        GlobalDatabaseModule,
        // `forRoot()` IS REQUIRED — the class is `@Module({})`, so importing it
        // bare registers no providers and `DatabaseStartupGuard` (which injects
        // the `AppLifecycle` tag) cannot resolve.
        AppLifecycleModule.forRoot(),
    ],
    providers: [
        // The Effect view of the global database, for services that query it as a port.
        { provide: DatabasePort, useExisting: GlobalDatabaseService },
        DatabaseProbeService,
        DatabaseStartupGuard,
        DatabaseFailureTracker,
        // Guards the boot sequence (migrations + admin) across replicas; see the
        // class docs. Lives next to the pool it borrows a connection from.
        BootstrapAdvisoryLockService,
    ],
    exports: [
        DatabasePort,
        LocalDatabaseModule,
        GlobalDatabaseModule,
        DatabaseProbeService,
        DatabaseStartupGuard,
        DatabaseFailureTracker,
        BootstrapAdvisoryLockService,
    ],
})
