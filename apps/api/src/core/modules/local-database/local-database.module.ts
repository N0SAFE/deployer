import { Global, Logger, Module } from "@nestjs/common";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import * as localSchema from "@/config/drizzle/local-schema";
import { LOCAL_DATABASE_CONNECTION } from "./local-database.token";
import { LocalDatabaseService } from "./local-database.service";

const logger = new Logger("LocalDatabaseModule");

@Global()
@Module({
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
                const sqlite = new Database(dbPath);
                // Enable WAL mode for better concurrent read performance
                sqlite.run("PRAGMA journal_mode = WAL");
                return drizzle(sqlite, { schema: localSchema });
            },
        },
        LocalDatabaseService,
    ],
    exports: [LOCAL_DATABASE_CONNECTION, LocalDatabaseService],
})
export class LocalDatabaseModule {}
