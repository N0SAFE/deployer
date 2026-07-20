/**
 * GlobalDatabaseModule — Provides GLOBAL_DATABASE_POOL, GLOBAL_DATABASE_CONNECTION, and GlobalDatabaseService.
 *
 * @Global() so database services are available to all modules.
 *
 * DATABASE_URL is NEVER read from the environment at runtime. The database URL
 * is resolved by the Phase 0 setup sub-app (SetupDevService), which reads
 * SETUP_DATABASE_URL from the environment or writes a local-only config.
 * The resolved URL is persisted to the local SQLite node_config table.
 *
 * The factories below inject NodeConfigRepository (provided directly within this
 * module) to read the URL from SQLite. LocalDatabaseModule is imported so that
 * NodeConfigRepository's dependency on LocalDatabaseService is available.
 *
 * If no URL is set, the module THROWS — the app must not start without a database.
 * The setup wizard runs in a separate sub-app (SetupSubAppModule) that does NOT
 * import this module.
 */

import { Global, Logger, Module } from '@nestjs/common'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as globalSchema from '@/config/drizzle/global/schema'
import { GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL } from '../database-connection'
import { GlobalDatabaseService } from './global-database.service'
import { NodeConfigRepository } from '../../setup/repositories/node-config.repository'
import { LocalDatabaseModule } from '../local/local-database.module'

const logger = new Logger('GlobalDatabaseModule')

function requireDatabaseUrl(nodeConfig: NodeConfigRepository): string {
    const config = nodeConfig.find()
    const url = config?.databaseUrl?.trim()
    if (!url) {
        const msg = 'No database URL in node_config — cannot start. Run the setup wizard first.'
        logger.error(msg)
        throw new Error(msg)
    }
    return url
}

const useFactoryPool = (nodeConfig: NodeConfigRepository) => {
    const databaseUrl = requireDatabaseUrl(nodeConfig)
    logger.log('📦 Creating database pool from node_config')
    return new Pool({ connectionString: databaseUrl })
}

const useFactoryDrizzle = (nodeConfig: NodeConfigRepository) => {
    const databaseUrl = requireDatabaseUrl(nodeConfig)
    const pool = new Pool({ connectionString: databaseUrl })
    return drizzle(pool, { schema: globalSchema })
}

const useFactoryService = (nodeConfig: NodeConfigRepository) => {
    const databaseUrl = requireDatabaseUrl(nodeConfig)
    const pool = new Pool({ connectionString: databaseUrl })
    const db = drizzle(pool, { schema: globalSchema })
    return new GlobalDatabaseService(db)
}

@Global()
@Module({
    imports: [LocalDatabaseModule],
    providers: [
        NodeConfigRepository,
        { provide: GLOBAL_DATABASE_POOL, useFactory: useFactoryPool, inject: [NodeConfigRepository] },
        { provide: GLOBAL_DATABASE_CONNECTION, useFactory: useFactoryDrizzle, inject: [NodeConfigRepository] },
        { provide: GlobalDatabaseService, useFactory: useFactoryService, inject: [NodeConfigRepository] },
    ],
    exports: [GlobalDatabaseService, GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL, NodeConfigRepository],
})
export class GlobalDatabaseModule {}

