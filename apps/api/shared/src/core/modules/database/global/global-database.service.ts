import { Context, type Effect } from 'effect'

import {
    makeDatabaseHandle,
    type DatabaseHandleShape,
} from '@deployer/database'
import * as globalSchema from '@deployer/nest-schema/global'

import { DatabaseNotInitialized } from '../database.errors'

import { defineRelations } from 'drizzle-orm'

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

/**
 * The relations config the driver builds from the global schema.
 *
 * It is passed to `drizzle()` so the handle carries every table and its relation names. Since
 * drizzle-orm 1.0 the DATABASE type is that relations config, and the config it produces does not
 * satisfy the driver's own `TablesRelationalConfig` constraint — so the handle is typed with the
 * driver's default (no relational-query generics). This codebase issues none: every read and write
 * goes through the query builder (`db.select`, `db.insert`, …), which is fully typed either way.
 */
export const globalRelations = defineRelations(globalSchema)

export type GlobalDatabase = NodePgDatabase

/**
 * The transaction handle `GlobalDatabaseService.transaction()` passes to its callback: the driver's
 * own transaction type for this handle.
 */
export type GlobalTransaction = Parameters<
    Parameters<GlobalDatabase['transaction']>[0]
>[0]

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
