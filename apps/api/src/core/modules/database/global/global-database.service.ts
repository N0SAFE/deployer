import { Injectable } from '@nestjs/common';
import { BaseDatabaseService } from "@repo/nest-database-core/base-database.service";
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as globalSchema from '@repo/nest-schema/global';

export type GlobalDatabase = NodePgDatabase<typeof globalSchema>;

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
