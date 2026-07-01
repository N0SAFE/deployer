import { Global, Logger, Module } from "@nestjs/common";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as localSchema from "@/config/drizzle/local/schema";
import { LOCAL_DATABASE_CONNECTION } from "../database-connection";
import { LocalDatabaseService } from "./local-database.service";

const logger = new Logger("LocalModule");

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
        // Drizzle Kit separates statements with `--> statement-breakpoint`.
        // `bun:sqlite`'s `run()` only executes a single statement at a time
        // and `exec()` is deprecated, so we split the file and run each
        // statement in turn. Without this, only the first `CREATE TABLE`
        // in each migration file is applied and subsequent tables silently
        // never exist. This is what caused "no such table: node_mesh_config"
        // on fresh mesh nodes.
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
                    msg.includes("no such table"); // a follow-up DDL may target a table created earlier in this same file
                if (!isBenign) {
                    logger.error(`Migration ${file} failed: ${msg}`);
                    throw err;
                }
            }
        }
        logger.log(`Applied local migration: ${file}`);
    }
}

@Module({
    providers: [
        {
            provide: LOCAL_DATABASE_CONNECTION,
            useFactory: () => {
                logger.log("Initializing local SQLite database connection...");
                const dbPath = process.env.NODE_LOCAL_DB_PATH ?? "/app/data/local.db";
                logger.log(`Using local SQLite database path: ${dbPath}`);
                const dir = path.dirname(dbPath);
                logger.log(`Ensuring local data directory exists at path: ${dir}`);
                if (!fs.existsSync(dir)) {
                    logger.log("creating local data directory for SQLite database at path: " + dir);
                    fs.mkdirSync(dir, { recursive: true });
                    logger.log(`Created local data directory: ${dir}`);
                }

                logger.log(`Opening local SQLite database: ${dbPath}`);
                const sqlite = new BunSqliteDatabase(dbPath);
                sqlite.run("PRAGMA journal_mode = WAL");

                runSqliteMigrations(sqlite);

                return drizzleSqlite(sqlite, { schema: localSchema });
            },
        },
        {
            provide: LocalDatabaseService,
            useFactory: (localDbConnection: ReturnType<typeof drizzleSqlite<typeof localSchema>>) => {
                return new LocalDatabaseService(localDbConnection);
            },
            inject: [LOCAL_DATABASE_CONNECTION],
        },
    ],
    exports: [LocalDatabaseService, LOCAL_DATABASE_CONNECTION],
})
export class LocalModule {}