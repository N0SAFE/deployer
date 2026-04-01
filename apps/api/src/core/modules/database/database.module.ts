import { Module, Global, Injectable, Logger, Optional } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import {
    GLOBAL_DATABASE_CONNECTION,
    GLOBAL_DATABASE_POOL,
    LOCAL_DATABASE_CONNECTION,
} from "./database-connection";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import * as schema from "../../../config/drizzle/global/schema";
import * as localSchema from "@/config/drizzle/local/schema";
import { EnvService } from "../../../config/env/env.service";
import { EnvModule } from "../../../config/env/env.module";
import { LocalDatabaseService } from "./services/local-database.service";
import { GlobalDatabaseService } from "./services/global-database.service";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

const logger = new Logger("DatabaseModule");

@Injectable()
class DatabasePoolLifecycleService implements OnModuleDestroy {
    constructor(@Optional() private readonly pool: Pool | null) {}

    async onModuleDestroy(): Promise<void> {
        if (!this.pool) {
            return;
        }

        await this.pool.end();
    }
}

@Global()
@Module({
    imports: [EnvModule],
    providers: [
        {
            provide: LOCAL_DATABASE_CONNECTION,
            useFactory: () => {
                const dbPath = process.env.NODE_LOCAL_DB_PATH ?? "/app/data/local.db";
                const dir = path.dirname(dbPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                    logger.log(`Created local data directory: ${dir}`);
                }

                logger.log(`Opening local SQLite database: ${dbPath}`);
                const sqlite = new BunSqliteDatabase(dbPath);
                sqlite.run("PRAGMA journal_mode = WAL");

                return drizzleSqlite(sqlite, { schema: localSchema });
            },
        },
        LocalDatabaseService,
        {
            provide: GLOBAL_DATABASE_POOL,
            useFactory: (envService: EnvService, localDatabaseService: LocalDatabaseService) => {
                // Env var takes priority (useful for compose overrides, CI, tests)
                const urlFromEnv = envService.get("DATABASE_URL");
                let urlFromConfig: string | undefined;

                if (!urlFromEnv) {
                    try {
                        urlFromConfig = localDatabaseService.db
                            .select({ databaseUrl: localSchema.nodeConfig.databaseUrl })
                            .from(localSchema.nodeConfig)
                            .limit(1)
                            .all()[0]?.databaseUrl ?? undefined;
                    } catch (error: unknown) {
                        const message = error instanceof Error ? error.message : String(error);
                        if (!message.includes("no such table: node_config")) {
                            throw error;
                        }
                    }
                }

                const connectionString = urlFromEnv ?? urlFromConfig;

                if (!connectionString) {
                    logger.warn(
                        "No DATABASE_URL configured — starting in setup mode. " +
                        "Connect to a Postgres database through the setup wizard.",
                    );
                    return null;
                }

                logger.log(`Connecting to Postgres (source: ${urlFromEnv ? "env" : "local config"})`);
                return new Pool({ connectionString });
            },
            inject: [EnvService, LocalDatabaseService],
        },
        {
            provide: GLOBAL_DATABASE_CONNECTION,
            useFactory: (pool: Pool | null) => {
                if (!pool) {
                    return null;
                }
                return drizzle(pool, { schema });
            },
            inject: [GLOBAL_DATABASE_POOL],
        },
        GlobalDatabaseService,
        DatabasePoolLifecycleService,
    ],
    exports: [
        GlobalDatabaseService,
        LocalDatabaseService,
        GLOBAL_DATABASE_CONNECTION,
        GLOBAL_DATABASE_POOL,
        LOCAL_DATABASE_CONNECTION,
    ],
})
export class DatabaseModule {}
