import { Global, Logger, Module } from "@nestjs/common";
import { drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { Database as BunSqliteDatabase } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "url";
import * as localSchema from "@/config/drizzle/local/schema";
import { LOCAL_DATABASE_CONNECTION } from "../database-connection";
import { LocalDatabaseService } from "./local-database.service";

const logger = new Logger("LocalDatabaseModule");

/**
 * Migration state table — tracks which migrations have been applied.
 *
 * Previously the runner re-executed ALL migration files on every boot and
 * treated "already exists" / "duplicate column" errors as benign, logging
 * them and marking the migration as applied anyway. That conflated
 * "migration already applied" with "SQL statement failed", which can leave
 * the schema partially updated while the migration is recorded as done.
 *
 * Now:
 *  - applied migrations are skipped entirely (no re-execution),
 *  - each migration runs inside a transaction,
 *  - a migration is recorded ONLY after every statement succeeds,
 *  - any statement error aborts the migration and is NOT recorded.
 */
const MIGRATION_STATE_TABLE = "local_migrations";

function ensureMigrationStateTable(sqlite: BunSqliteDatabase): void {
    sqlite.run(`
        CREATE TABLE IF NOT EXISTS ${MIGRATION_STATE_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            hash TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
    `);
}

function isMigrationApplied(sqlite: BunSqliteDatabase, name: string): boolean {
    const row = sqlite
        .query(`SELECT 1 FROM ${MIGRATION_STATE_TABLE} WHERE name = ?`)
        .get(name);
    return row !== null;
}

function recordMigrationApplied(sqlite: BunSqliteDatabase, name: string, hash: string): void {
    sqlite
        .query(
            `INSERT INTO ${MIGRATION_STATE_TABLE} (name, hash, applied_at) VALUES (?, ?, ?)`,
        )
        .run(name, hash, new Date().toISOString());
}

function hashFile(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

/**
 * One-time backfill for databases migrated by the OLD runner.
 *
 * The previous runner re-executed every migration file on every boot and
 * tolerated "already exists" / "duplicate column" errors, so an existing
 * database already has the full schema but no `local_migrations` state.
 *
 * On first boot with the new runner, if the state table is empty but the
 * schema already exists (e.g. `node_config` is present), record every
 * migration file as applied WITHOUT re-executing — otherwise the new
 * transactional runner would fail on `CREATE TABLE node_config` (already
 * exists) and crash the app.
 */
function backfillAppliedMigrationsIfSchemaExists(
    sqlite: BunSqliteDatabase,
    files: string[],
    migrationsDir: string,
): boolean {
    const hasSchema = sqlite
        .query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'node_config'`)
        .get() !== null;
    if (!hasSchema) {
        return false;
    }

    const appliedCount = sqlite
        .query(`SELECT COUNT(*) AS count FROM ${MIGRATION_STATE_TABLE}`)
        .get() as { count: number };
    if (appliedCount.count > 0) {
        return false;
    }

    logger.log(
        `Existing schema detected with no migration state — backfilling ${files.length} migrations as applied (legacy runner upgrade)`,
    );
    for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        recordMigrationApplied(sqlite, file, hashFile(sql));
    }
    return true;
}

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

    ensureMigrationStateTable(sqlite);

    // Legacy upgrade path: existing schema + empty state table → backfill.
    if (backfillAppliedMigrationsIfSchemaExists(sqlite, files, migrationsDir)) {
        return;
    }

    for (const file of files) {
        if (isMigrationApplied(sqlite, file)) {
            logger.log(`Skipping already-applied migration: ${file}`);
            continue;
        }

        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        const hash = hashFile(sql);
        const statements = sql
            .split("--> statement-breakpoint")
            .map((s) => s.trim())
            // Strip SQL comment lines (-- ...) so comment-only migrations
            // become valid no-ops instead of "empty query" errors.
            .map((s) => s.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
            .filter((s) => s.length > 0);

        logger.log(`Running migration: ${file}`);

        // A migration with no executable statements is a valid no-op marker
        // (e.g. a column that was already present in an earlier migration).
        // Record it as applied without executing anything.
        if (statements.length === 0) {
            recordMigrationApplied(sqlite, file, hash);
            logger.log(`Applied local migration (no-op): ${file}`);
            continue;
        }

        // Execute the whole migration atomically. If ANY statement fails,
        // roll back and do NOT record the migration as applied — the schema
        // must never be left in a half-migrated state that is marked done.
        sqlite.run("BEGIN");
        try {
            for (const stmt of statements) {
                sqlite.run(stmt);
            }
            recordMigrationApplied(sqlite, file, hash);
            sqlite.run("COMMIT");
            logger.log(`Applied local migration: ${file}`);
        } catch (err: unknown) {
            sqlite.run("ROLLBACK");
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`Migration ${file} FAILED — rolled back, NOT marked applied: ${msg}`);
            throw err;
        }
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
