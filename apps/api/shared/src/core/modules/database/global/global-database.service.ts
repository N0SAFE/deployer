import { Context, type Effect } from 'effect'

import {
    makeDatabaseHandle,
    type DatabaseHandleShape,
} from '@deployer/database'
import * as globalSchema from '@deployer/nest-schema/global'

import { DatabaseNotInitialized } from '../database.errors'

import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgTransaction } from 'drizzle-orm/pg-core'

export type GlobalDatabase = NodePgDatabase<typeof globalSchema>

/**
 * The transaction handle `GlobalDatabaseService.transaction()` passes to its callback.
 *
 * Derived from the SAME `globalSchema` as `GlobalDatabase` above. A caller that
 * re-derived this against a narrower schema (an owner barrel, say) would get a
 * transaction type the pool does not produce, and the mismatch only appears when the
 * two are passed to each other — so it belongs next to the database type, defined once.
 */
export type GlobalTransaction = PgTransaction<
    NodePgQueryResultHKT,
    typeof globalSchema,
    ExtractTablesWithRelations<typeof globalSchema>
>

/**
 * Typed handle on the GLOBAL Postgres database.
 *
 * The connection is a SINGLE shared `pg.Pool` created by `GlobalDatabaseModule` and injected as
 * `GLOBAL_DATABASE_CONNECTION`; this service is a thin typed wrapper over that Drizzle instance. It deliberately does NOT
 * own the pool — the pool's lifecycle belongs to the module's pool lifecycle, so the connection can never be duplicated (a
 * second pool would double the connection count and keep the event loop alive at shutdown).
 */
export type GlobalDatabaseServiceShape = {
    /** The Effect handle (`@deployer/database`) this service holds the connection in. */
    readonly handle: DatabaseHandleShape<GlobalDatabase>
    /** Initialize (or re-initialize) the database connection. */
    readonly init: (db: GlobalDatabase) => void
    /** Whether this service has been initialized with a database connection. */
    readonly isInitialized: boolean
    /**
     * The underlying Drizzle database handle. A synchronous accessor (it is what `DatabasePort` hands every repository), so
     * reading it before initialisation throws a `DatabaseNotInitialized`.
     */
    readonly db: GlobalDatabase
    /** Runs `SELECT 1` and resolves to whether the database answered. */
    readonly probe: () => Effect.Effect<boolean>
}

const OWNER = 'GlobalDatabaseService'

export class GlobalDatabaseService extends Context.Service<
    GlobalDatabaseService,
    GlobalDatabaseServiceShape
>()('shared/GlobalDatabaseService') {
    /**
     * The connection is handed in by the module — it is the pool this process created — so it is a
     * constructor argument rather than something a method yields.
     */
    static readonly live = class GlobalDatabaseServiceImpl
        implements GlobalDatabaseServiceShape
    {
        private readonly connection = makeDatabaseHandle<GlobalDatabase>(OWNER)

        constructor(initial?: GlobalDatabase) {
            if (initial !== undefined) this.connection.initNow(initial)
        }

        get handle(): DatabaseHandleShape<GlobalDatabase> {
            return this.connection
        }

        init(db: GlobalDatabase): void {
            this.connection.initNow(db)
        }

        get isInitialized(): boolean {
            return this.connection.dbNow() !== undefined
        }

        get db(): GlobalDatabase {
            const db = this.connection.dbNow()
            if (db === undefined)
                throw new DatabaseNotInitialized({ owner: OWNER })
            return db
        }

        probe(): Effect.Effect<boolean> {
            return this.connection.healthy
        }
    }
}
