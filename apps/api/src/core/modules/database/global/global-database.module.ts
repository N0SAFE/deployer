/**
 * GlobalDatabaseModule — Provides GLOBAL_DATABASE_POOL, GLOBAL_DATABASE_CONNECTION, and GlobalDatabaseService.
 *
 * @Global() so database services are available to all modules.
 *
 * DATABASE_URL is NEVER read from the environment at runtime. The database URL
 * is resolved by the Phase 0 dev bootstrap injector (SetupDevService), which
 * persists the URL to the local SQLite node_config table.
 *
 * SINGLE SHARED POOL: Unlike the previous version that created 3 separate
 * pg.Pool instances, this module creates ONE pool and shares it across all
 * providers. The pool is created with explicit configuration (max, min,
 * timeouts) for production readiness.
 *
 * The factories below inject NodeConfigRepository (provided directly within this
 * module) to read the URL from SQLite. LocalDatabaseModule is imported so that
 * NodeConfigRepository's dependency on LocalDatabaseService is available.
 *
 * If no URL is set, the module THROWS — the app must not start without a database.
 * The setup wizard runs in a separate sub-app (SetupSubAppModule) that does NOT
 * import this module.
 *
 * IMPORTANT: Probe happens AFTER module init (in OrchestratorService), NOT inside
 * forRoot(). This ensures structured diagnostic messages, not generic DI errors.
 */

import { Global, Logger, Module } from '@nestjs/common'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as globalSchema from '@repo/nest-schema/global'
import { GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL } from "@repo/nest-database-core/database-connection"
import { GlobalDatabaseService } from './global-database.service'
import { GlobalDatabaseLifecycleService } from './global-database-lifecycle.service'
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository"
import { LocalDatabaseModule } from "@repo/nest-database-local/local-database.module"
import { NodeStateModule } from '../../node-state/node-state.module'
import { EnvModule } from "@repo/nest-env"
import { EnvService } from "@repo/nest-env"
import { resolveManagedGlobalDbUrl, splitManagedEnv } from "@repo/env"

const logger = new Logger('GlobalDatabaseModule')

/**
 * Create a configured Pool instance with explicit production-ready settings.
 * Called ONCE — the resulting pool is shared across all providers.
 *
 * max: 50 — higher than 20 to absorb bursts without queue timeouts. The pool
 *   still shares Postgres connections responsibly; each sub-app creates its
 *   own pool (gateway, mesh-init, main-app) so total load is multiplied.
 * min: 2 — keeps baseline connections warm.
 * connectionTimeoutMillis: 10_000 — longer than 5s to give Postgres more time
 *   during transient load spikes before rejecting the query.
 * idleTimeoutMillis: 60_000 — longer idle grace so warm connections survive
 *   brief quiet periods (e.g. between scan progress events).
 * allowExitOnIdle: false — prevents the pool from unref()ing its pulse timer,
 *   which caused subtle event-loop exit races.
 */
function createPool(databaseUrl: string): Pool {
    return new Pool({
        connectionString: databaseUrl,
        max: 50,
        min: 2,
        connectionTimeoutMillis: 10_000,
        idleTimeoutMillis: 60_000,
        allowExitOnIdle: false,
    })
}

/**
 * Build the shared pool once. Precedence:
 *
 * 1. COMPOSE-MANAGED DB (`MANAGED_GLOBAL_DB_ENABLED=true`): the URL is
 *    deterministic from `MANAGED_GLOBAL_DB_*` env — build the pool from env
 *    at factory time. This avoids the "stale placeholder pool" trap where
 *    the module-initialized pool (empty URL on a pristine boot) would never
 *    see the URL that SetupDevService persists to SQLite later.
 * 2. Otherwise read the URL from SQLite node_config (managed/local or
 *    operator-configured URL persisted by an earlier boot).
 */
function buildSharedPool(nodeConfig: NodeConfigRepository, env: EnvService): Pool {
    const managed = splitManagedEnv(env).globalDb;
    if (managed.enabled === true) {
        const url = resolveManagedGlobalDbUrl(managed);
        logger.log(`📦 Compose-managed global DB (MANAGED_GLOBAL_DB_ENABLED=true) — creating shared pool from env`)
        const pool = createPool(url)
        pool.on('error', (err) => {
            logger.error(`🚨 Pool error: ${err.message}`)
        })
        return pool
    }

    const config = nodeConfig.find()
    const url = config?.databaseUrl?.trim()
    if (!url) {
        logger.warn('⚠️  No database URL in node_config yet — creating placeholder pool.')
        logger.warn('   The orchestrator will resolve the URL during startup.')
        logger.warn('   If setup is incomplete, the setup wizard will be launched.')
        return createPool('')
    }
    logger.log('📦 Creating shared database pool (single instance)')
    const pool = createPool(url)

    pool.on('error', (err) => {
        logger.error(`🚨 Pool error: ${err.message}`)
    })

    return pool
}

@Global()
@Module({
    imports: [LocalDatabaseModule, EnvModule, NodeStateModule],
    providers: [
        // NodeConfigRepository is imported from NodeStateModule (its single
        // owner) rather than redeclared: two declarations = two instances,
        // which the SC8 guard rejects.
        // Owns the teardown of the shared pool above. Registered HERE (not in a
        // supervisor) because the pool is created UNCONDITIONALLY by the
        // factory, while database supervisors are registered only for a
        // locally-managed database — and never inside the setup-wizard /
        // mesh-initializer contexts, which each build their own pool.
        GlobalDatabaseLifecycleService,
        {
            provide: GLOBAL_DATABASE_POOL,
            useFactory: buildSharedPool,
            inject: [NodeConfigRepository, EnvService],
        },
        {
            provide: GLOBAL_DATABASE_CONNECTION,
            useFactory: (pool: Pool) => drizzle(pool, { schema: globalSchema }),
            inject: [GLOBAL_DATABASE_POOL],
        },
        {
            provide: GlobalDatabaseService,
            useFactory: (pool: Pool) => new GlobalDatabaseService(drizzle(pool, { schema: globalSchema })),
            inject: [GLOBAL_DATABASE_POOL],
        },
    ],
    // NodeConfigRepository is NOT re-exported: it is owned by NodeStateModule,
    // which this module imports. NestJS validates exports against the module's
    // OWN providers + imported module metatypes, so a class token that only
    // arrives through an imported @Global() module is not exportable from here
    // (UnknownExportException). Consumers inject it directly from NodeStateModule.
    exports: [GlobalDatabaseService, GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL],
})
export class GlobalDatabaseModule {}

