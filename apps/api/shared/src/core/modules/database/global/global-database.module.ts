/**
 * GlobalDatabaseModule — Provides GLOBAL_DATABASE_POOL, GLOBAL_DATABASE_CONNECTION, and GlobalDatabaseService.
 *
 * @Global() so database services are available to all modules.
 *
 * DATABASE_URL is NEVER read from the environment at runtime. The database URL
 * is resolved by the Phase 0 dev bootstrap injector (SetupDevService), which
 * persists the URL to the node config (the node's agent, or the local SQLite
 * `node_config` table when no agent answers).
 *
 * SINGLE SHARED POOL: Unlike the previous version that created 3 separate
 * pg.Pool instances, this module creates ONE pool and shares it across all
 * providers. The pool is created with explicit configuration (max, min,
 * timeouts) for production readiness.
 *
 * The pool factory injects `NodeConfigSnapshot` (owned by NodeStateModule) for
 * the URL: the repository read is async now, while the pool's per-connect
 * resolver is synchronous. LocalDatabaseModule is imported so the repositories'
 * dependency on LocalDatabaseService is available.
 *
 * If no URL is set, the module THROWS — the app must not start without a database.
 * The setup wizard runs in a separate sub-app (SetupSubAppModule) that does NOT
 * import this module.
 *
 * IMPORTANT: Probe happens AFTER module init (in OrchestratorService), NOT inside
 * forRoot(). This ensures structured diagnostic messages, not generic DI errors.
 */

import { Logger } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client, Pool } from 'pg'

import { resolveManagedGlobalDbUrl, splitManagedEnv } from "@deployer/env"
import { createGlobalModule } from "@deployer/nest-effect"
import * as globalSchema from '@deployer/nest-schema/global'

import { EnvModule } from "../../../../config/env/env.module"
import { EnvService } from "../../../../config/env/env.module"
import { NodeConfigSnapshot, type NodeConfigSnapshotShape } from '../../node-state/node-config.snapshot'
import { NodeStateModule } from '../../node-state/node-state.module'
import { GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL } from "../database-connection"
import { LocalDatabaseModule } from "../local/local-database.module"

import { GlobalDatabaseLifecycleService } from './global-database-lifecycle.service'
import { GlobalDatabaseService } from './global-database.service'


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
function resolveUrlPool(resolve: () => string, sizing: PoolSizing): Pool {
    class ResolvedClient extends Client {
        constructor() {
            super({ connectionString: resolve() })
        }
    }

    return new Pool({
        Client: ResolvedClient,
        max: sizing.max,
        min: sizing.min,
        connectionTimeoutMillis: sizing.connectionTimeoutMillis,
        idleTimeoutMillis: sizing.idleTimeoutMillis,
        allowExitOnIdle: false,
    })
}

/**
 * Per-process pool sizing. `max` is the only value that multiplies across the
 * fleet (every process opens its own pool), so it is the one that has to be
 * budgeted against Postgres' `max_connections`. See GLOBAL_DB_POOL_* in
 * `@deployer/env` for the formula.
 */
type PoolSizing = {
    max: number
    min: number
    connectionTimeoutMillis: number
    idleTimeoutMillis: number
}

function readPoolSizing(env: EnvService): PoolSizing {
    const sizing: PoolSizing = {
        max: env.get('GLOBAL_DB_POOL_MAX'),
        min: env.get('GLOBAL_DB_POOL_MIN'),
        connectionTimeoutMillis: env.get('GLOBAL_DB_POOL_CONNECTION_TIMEOUT_MS'),
        idleTimeoutMillis: env.get('GLOBAL_DB_POOL_IDLE_TIMEOUT_MS'),
    }
    if (sizing.min > sizing.max) {
        // A floor above the ceiling is a config error that pg would otherwise
        // surface as a silent inability to reach `min` — clamp instead of
        // connecting a fleet that can never satisfy its own minimum.
        logger.warn(
            'GLOBAL_DB_POOL_MIN (' +
                String(sizing.min) +
                ') > GLOBAL_DB_POOL_MAX (' +
                String(sizing.max) +
                '); clamping min to max',
        )
        sizing.min = sizing.max
    }
    return sizing
}

/**
 * Build the shared pool once. Precedence:
 *
 * 1. COMPOSE-MANAGED DB (`MANAGED_GLOBAL_DB_ENABLED=true`): the URL is
 *    deterministic from `MANAGED_GLOBAL_DB_*` env.
 * 2. Otherwise read the URL from the node config SNAPSHOT (`NodeConfigSnapshot`), which mirrors
 *    `node_config` (managed/local or operator-configured URL persisted by an earlier boot). The
 *    snapshot is read synchronously because `pg` resolves the connection string inside its own
 *    synchronous `Client` constructor; the cache is refreshed on a timer elsewhere.
 *
 * Both are read through the SAME resolver, on every connect, so the pool follows
 * the platform through onboarding instead of freezing whatever was true at boot.
 */
function buildSharedPool(snapshot: Pick<NodeConfigSnapshotShape, "current">, env: EnvService): Pool {
    let announced = false

    const resolveUrl = (): string => {
        const managed = splitManagedEnv(env).globalDb
        const url =
            managed.enabled
                ? resolveManagedGlobalDbUrl(managed)
                : (snapshot.current()?.databaseUrl?.trim() ?? '')

        if (!announced) {
            announced = true
            if (url.length === 0) {
                logger.warn(
                    '⚠️  No database URL yet — the pool will connect once onboarding provisions one.',
                )
            } else {
                logger.log(
                    managed.enabled
                        ? '📦 Compose-managed global DB (MANAGED_GLOBAL_DB_ENABLED=true) — pool URL from env'
                        : '📦 Creating shared database pool (single instance)',
                )
            }
        }

        return url
    }

    const pool = resolveUrlPool(resolveUrl, readPoolSizing(env))

    pool.on('error', (err) => {
        logger.error(`🚨 Pool error: ${err.message}`)
    })

    return pool
}

export const GlobalDatabaseModule = createGlobalModule({
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
            inject: [NodeConfigSnapshot, EnvService],
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
});

