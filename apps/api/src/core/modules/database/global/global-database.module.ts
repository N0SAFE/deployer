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
import { Client, Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as globalSchema from '@repo/nest-schema/global'
import { GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL } from "@repo/nest-database-core/database-connection"
import { GlobalDatabaseService } from './global-database.service'
import { GlobalDatabaseLifecycleService } from './global-database-lifecycle.service'
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository"
import { LocalDatabaseModule } from "@repo/nest-database-local/local-database.module"
import { NodeStateModule } from '../../node-state/node-state.module'
import { EnvModule } from "@/config/env/env.module"
import { EnvService } from "@/config/env/env.module"
import { resolveManagedGlobalDbUrl, splitManagedEnv } from "@repo/env"

const logger = new Logger('GlobalDatabaseModule')

/**
 * A `pg.Pool` whose connection string is resolved WHEN A CONNECTION IS MADE.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The API is started by compose BEFORE onboarding provisions anything, so
 * `node_config` has no URL at factory time. Building the pool from that empty
 * value is not a neutral placeholder: `pg` treats an empty `connectionString`
 * as ABSENT and falls back to the PG* environment / the `localhost:5432`
 * default, so every query then fails for the whole life of the process with
 *
 *   connect ECONNREFUSED 127.0.0.1:5432
 *
 * — which is what silently broke every global-database read and write after a
 * SUCCESSFUL onboarding: event-log persistence, mesh cluster sync, the outbound
 * dispatcher, and `/setup/done`. Readiness still said `database: up` because its
 * indicator is driven by the lifecycle probe, not by this pool, so the failure
 * stayed invisible until a page was rendered.
 *
 * ── WHY A `Client` SUBCLASS ─────────────────────────────────────────────────
 * There is no lazy hook on the connection string itself: `ConnectionParameters`
 * calls `parse(config.connectionString)` EAGERLY, and `pg-pool` copies the
 * options with `Object.assign({}, options)`, which INVOKES an accessor and
 * freezes its value. Both were measured, not assumed:
 *
 *   getter retained on pool.options: true
 *   value at construction        : postgresql://…@first-host:5432/firstdb
 *   after url change -> host     : first-host     <- frozen, not re-read
 *
 * `pg-pool` builds every connection through `new this.Client(this.options)`, and
 * `PoolConfig.Client` is a SUPPORTED option, so supplying a constructor that
 * resolves the URL itself is the seam that stays within the API. It runs once per
 * NEW client, so a connection opened AFTER the wizard persisted the URL uses it;
 * connections already open are reused as normal.
 *
 * Extending `Client` (rather than reimplementing) keeps `connection`,
 * `isConnected()` and the idle/release lifecycle `pg-pool` drives intact.
 */
function resolveUrlPool(resolve: () => string): Pool {
    class ResolvedClient extends Client {
        constructor() {
            super({ connectionString: resolve() })
        }
    }

    return new Pool({
        Client: ResolvedClient,
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
 *    deterministic from `MANAGED_GLOBAL_DB_*` env.
 * 2. Otherwise read the URL from SQLite node_config (managed/local or
 *    operator-configured URL persisted by an earlier boot).
 *
 * Both are read through the SAME resolver, on every connect, so the pool follows
 * the platform through onboarding instead of freezing whatever was true at boot.
 */
function buildSharedPool(nodeConfig: NodeConfigRepository, env: EnvService): Pool {
    let announced = false

    const resolveUrl = (): string => {
        const managed = splitManagedEnv(env).globalDb
        const url =
            managed.enabled === true
                ? resolveManagedGlobalDbUrl(managed)
                : (nodeConfig.find()?.databaseUrl?.trim() ?? '')

        if (!announced) {
            announced = true
            if (url.length === 0) {
                logger.warn(
                    '⚠️  No database URL yet — the pool will connect once onboarding provisions one.',
                )
            } else {
                logger.log(
                    managed.enabled === true
                        ? '📦 Compose-managed global DB (MANAGED_GLOBAL_DB_ENABLED=true) — pool URL from env'
                        : '📦 Creating shared database pool (single instance)',
                )
            }
        }

        return url
    }

    const pool = resolveUrlPool(resolveUrl)

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

