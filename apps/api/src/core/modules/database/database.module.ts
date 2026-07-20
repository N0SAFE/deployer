/**
 * DatabaseModule — Provides GLOBAL_DATABASE_POOL, GLOBAL_DATABASE_CONNECTION, GlobalDatabaseService,
 * LocalDatabaseService, and LOCAL_DATABASE_CONNECTION.
 *
 * @Global() so all modules can inject database services without explicit import.
 */

import { Global, Module } from '@nestjs/common'
import { GlobalDatabaseModule } from './global/global-database.module'
import { LocalDatabaseModule } from './local/local-database.module'

@Global()
@Module({
    imports: [LocalDatabaseModule, GlobalDatabaseModule],
    exports: [LocalDatabaseModule, GlobalDatabaseModule],
})
export class DatabaseModule {}
