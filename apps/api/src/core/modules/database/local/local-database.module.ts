import { Global, Logger, Module } from "@nestjs/common";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as localSchema from "@/config/drizzle/local/schema";
import { LOCAL_DATABASE_CONNECTION } from "../database-connection";
import { LocalDatabaseService } from "./local-database.service";

const logger = new Logger("LocalDatabaseModule");

function runSqliteMigrations(sqlite: BunSqliteDatabase): void {
    const migrationsDir = fileURLToPath(
        new URL("../../../../config/drizzle/local/migrations", import.meta.url)
    );
    logger.log(`Checking migrations at: ${migrationsDir}`);
    if (!fs.existsSync(migrationsDir)) {
        logger.warn(`Local migrations directory not found at ${migrationsDir}, skipping`);
        return;
    }
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    logger.log(`Found ${files.length} migration files: ${files.join(", ")}`);
    for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        logger.log(`Running migration: ${file}`);
        const statements = sql
            .split("--> statement-breakpoint")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        for (const stmt of statements) {
            try {
                sqlite.run(stmt);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.log(`Migration ${file} statement result: ${msg}`);
                const isBenign =
                    msg.includes("already exists") ||
                    msg.includes("duplicate column") ||
                    msg.includes("no such table");
                if (!isBenign) {
                    logger.error(`Migration ${file} failed: ${msg}`);
                    throw err;
                }
            }
        }
        logger.log(`Applied local migration: ${file}`);
    }
}

@Global()
@Module({
    providers: [
        {
            provide: LOCAL_DATABASE_CONNECTION,
            useFactory: () => {
                logger.log("Initializing local SQLite database connection...");
                const dbPath = process.env.NODE_LOCAL_DB_PATH ?? "/app/data/local.db";
                logger.log(`Using local SQLite database path: ${dbPath}`);
                const dir = path.dirname(dbPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                const sqlite = new BunSqliteDatabase(dbPath);
                sqlite.run("PRAGMA journal_mode = WAL;");
                sqlite.run("PRAGMA busy_timeout = 5000;");
                runSqliteMigrations(sqlite);
                return drizzleSqlite(sqlite, { schema: localSchema });
            },
        },
        {
            provide: LocalDatabaseService,
            useFactory: (db: ReturnType<typeof drizzleSqlite<typeof localSchema>>) => {
                return new LocalDatabaseService(db);
            },
            inject: [LOCAL_DATABASE_CONNECTION],
        },
    ],
    exports: [LocalDatabaseService, LOCAL_DATABASE_CONNECTION],
})
export class LocalDatabaseModule {}
