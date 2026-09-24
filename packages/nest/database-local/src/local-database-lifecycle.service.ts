import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type { Database as BunSqliteDatabase } from "bun:sqlite";

import { LOCAL_DATABASE_CLIENT } from "@repo/nest-database-core/database-connection";

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
export class LocalDatabaseLifecycleService implements OnApplicationShutdown {
    private readonly logger = new Logger(LocalDatabaseLifecycleService.name);

    constructor(@Inject(LOCAL_DATABASE_CLIENT) private readonly client: BunSqliteDatabase | undefined) {}

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
