import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";

import { GLOBAL_DATABASE_POOL } from "../database-connection";

/**
 * GlobalDatabaseLifecycleService — owns the teardown of the SHARED global
 * Postgres pool.
 *
 * WHY a dedicated provider: the pool is built by a DI factory and injected by
 * token, so no single class "owns" it. Without an explicit owner nothing closed
 * it at shutdown, and a `pg.Pool` with `min: 2` / `allowExitOnIdle: false`
 * keeps live sockets (and therefore a live event loop) until the process is
 * force-killed — the app could not exit cleanly on SIGTERM.
 *
 * TIMING: `onApplicationShutdown` (not `onModuleDestroy`) is deliberate — Nest
 * runs it AFTER the DI container is disposed, so every repository/consumer that
 * might still issue a query has already been torn down and `pool.end()` can
 * wait for the checked-out clients to drain instead of racing them.
 *
 * The module is `@Global`, so this runs for the main app AND for every sub-app
 * context (setup-wizard, mesh-initializer), which each build their own pool —
 * including the empty-URL placeholder pool created before the database URL is
 * known. All of them are released here.
 */
@Injectable()
export class GlobalDatabaseLifecycleService implements OnApplicationShutdown {
    private readonly logger = new Logger(GlobalDatabaseLifecycleService.name);

    constructor(@Inject(GLOBAL_DATABASE_POOL) private readonly pool: Pool | undefined) {}

    async onApplicationShutdown(): Promise<void> {
        if (this.pool === undefined || this.pool === null) {
            return;
        }
        try {
            // `end()` drains in-flight queries and closes every idle client.
            await this.pool.end();
            this.logger.log("🔌 Global Postgres pool closed");
        } catch (error: unknown) {
            // Shutdown must never throw: a pool that refuses to close is
            // reported and the process still exits (main.ts bounds the wait).
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Global Postgres pool close failed: ${message}`);
        }
    }
}
