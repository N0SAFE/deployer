import { Injectable, Logger } from '@nestjs/common';

import { makeDatabaseHandle, type DatabaseHandleShape } from "@deployer/database";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { AppError } from "@deployer/errors";
import * as globalSchema from '@deployer/nest-schema/global';

import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';

export type GlobalDatabase = NodePgDatabase<typeof globalSchema>;

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
>;

/**
 * Typed handle on the GLOBAL Postgres database.
 *
 * The connection is a SINGLE shared `pg.Pool` created by `GlobalDatabaseModule`
 * and injected as `GLOBAL_DATABASE_CONNECTION`; this service is a thin typed
 * wrapper over that Drizzle instance. It deliberately does NOT own the pool —
 * the pool's lifecycle belongs to `GlobalDatabaseLifecycleService`, so the
 * connection can never be duplicated (a second pool would double the connection
 * count and keep the event loop alive at shutdown).
 */
@Injectable()
export class GlobalDatabaseService {
    protected readonly logger = new Logger(GlobalDatabaseService.name);

    /** The Effect handle (`@deployer/database`) this service holds the connection in. */
    readonly handle: DatabaseHandleShape<GlobalDatabase>;

    constructor(db?: GlobalDatabase) {
        this.handle = makeDatabaseHandle<GlobalDatabase>(GlobalDatabaseService.name, db);
    }

    /** Initialize (or re-initialize) the database connection. */
    init(db: GlobalDatabase): void {
        this.handle.initNow(db);
    }

    /** Whether this service has been initialized with a database connection. */
    get isInitialized(): boolean {
        return this.handle.dbNow() !== undefined;
    }

    /** The underlying Drizzle database handle. Throws if not yet initialized. */
    get db(): GlobalDatabase {
        const db = this.handle.dbNow();
        if (db === undefined) {
            throw new AppError(`${GlobalDatabaseService.name} has not been initialized yet`, "DATABASE_NOT_INITIALIZED");
        }
        return db;
    }

    /** Runs `SELECT 1` and resolves to whether the database answered. */
    async probe(): Promise<boolean> {
        return await runPromiseUnwrapped(this.handle.healthy);
    }
}
