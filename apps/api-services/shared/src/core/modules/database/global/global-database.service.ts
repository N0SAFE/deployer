import { Injectable } from '@nestjs/common';
import { BaseDatabaseService } from "@deployer/nest-database-core/base-database.service";
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import * as globalSchema from '@deployer/nest-schema/global';

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
export class GlobalDatabaseService extends BaseDatabaseService<GlobalDatabase> {}
