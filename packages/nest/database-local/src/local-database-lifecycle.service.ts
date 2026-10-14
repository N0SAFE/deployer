import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import type { Database as BunSqliteDatabase } from "bun:sqlite";

import { LOCAL_DATABASE_CLIENT } from "@deployer/nest-database-core/database-connection";

import { LOCAL_DATABASE_OPTIONS_TOKEN, type LocalDatabaseModuleOptions } from "./local-database.options";
import { ensureLocalSchemaMigrated } from "./local-migrations";

/**
 * LocalDatabaseLifecycleService — closes this context's local SQLite handle.
 *
 * WHY per-context: the API runs SEVERAL NestJS contexts in one process (the
 * orchestrator, the Phase-0 dev bootstrap, and the setup-wizard /
 * mesh-initializer / main-app sub-apps). Each context opens its OWN
 * `bun:sqlite` handle in the `LOCAL_DATABASE_CLIENT` factory (only the
 * migration SCAN is deduplicated process-wide), so each context must close the
 * handle it opened. Sharing one handle would be wrong: sub-apps are closed
 * during boot, and closing a shared handle would break the still-running app.
 *
 * The RAW handle is injected (`LOCAL_DATABASE_CLIENT`) rather than reached
 * through the Drizzle wrapper, which exposes no typed accessor for it.
 *
 * TIMING: `onApplicationShutdown` runs after the DI container is disposed, so
 * no repository can still be using the handle when it is closed. This matters
 * for the sub-apps that call `app.close()` mid-boot.
 */
@Injectable()
export class LocalDatabaseLifecycleService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(LocalDatabaseLifecycleService.name);

    constructor(
        @Inject(LOCAL_DATABASE_CLIENT) private readonly client: BunSqliteDatabase | undefined,
        @Inject(LOCAL_DATABASE_OPTIONS_TOKEN) private readonly options: LocalDatabaseModuleOptions,
    ) {}

    /**
     * Shape the connection: PRAGMAs, then the schema migrations (once per
     * connection). Done here rather than in the provider factory so that a test
     * overriding `LOCAL_DATABASE_CLIENT` with an in-memory handle gets the same
     * schema without the real file ever being touched.
     */
    onModuleInit(): void {
        if (this.client === undefined || this.client === null) {
            return;
        }
        this.client.run("PRAGMA journal_mode = WAL;");
        // 15s, not 5s: the local DB is a single file that several Nest contexts in
        // one process (and, under test, several runtimes) open. A migration that
        // waits behind another writer must outlast the other one's whole run, or
        // the loser fails with `database is locked` instead of simply being second.
        this.client.run("PRAGMA busy_timeout = 15000;");
        ensureLocalSchemaMigrated(this.client, this.options.databasePath, this.options.migrationsDir);
    }

    onApplicationShutdown(): void {
        if (this.client === undefined || this.client === null) {
            return;
        }
        try {
            // `bun:sqlite` Database.close() checkpoints/flushes WAL and releases
            // the file descriptor (the `-wal`/`-shm` sidecars are removed).
            this.client.close();
            this.logger.log("🔌 Local SQLite connection closed");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Local SQLite close failed: ${message}`);
        }
    }
}
