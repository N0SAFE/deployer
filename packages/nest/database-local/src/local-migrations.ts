import { Logger } from "@nestjs/common";
import type { Database as BunSqliteDatabase } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "node:crypto";

const logger = new Logger("LocalDatabaseMigrations");

/**
 * Process-level guard: local schema migrations run ONCE per DB path per process.
 *
 * The API boots several NestJS contexts in the SAME process — the orchestrator
 * bootstrap, the Phase-0 SetupDevModule headless context, and the setup-wizard /
 * mesh-initializer / main-app sub-apps — and every context imports
 * LocalDatabaseModule. Without this guard each context re-opened SQLite and
 * re-scanned all migration files (5× the same "Checking migrations / Found N /
 * Skipping already-applied" log spam per boot). The first context migrates;
 * all others reuse the same connection state.
 */
const migratedConnections = new WeakSet<BunSqliteDatabase>();

export function ensureLocalSchemaMigrated(
    sqlite: BunSqliteDatabase,
    dbPath: string,
    migrationsDir: string | undefined,
): void {
    // Keyed on the CONNECTION, not the path. A path is not a unique identity:
    // `:memory:` is per-connection, so keying on it made the first migrated
    // in-memory database suppress migrations for every later one - a second
    // context then booted against an unmigrated schema. A WeakSet also cannot
    // retain entries for connections that are already gone.
    if (migratedConnections.has(sqlite)) {
        return;
    }
    try {
        runSqliteMigrations(sqlite, migrationsDir);
        migratedConnections.add(sqlite);
    } catch (error) {
        logger.error(`Local SQLite migrations failed for ${dbPath}`, error as Error);
        throw error;
    }
}

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
    // Idempotent on purpose. Two processes can boot against the same SQLite file
    // (two e2e suites sharing the default path), both pass `isMigrationApplied`,
    // and both try to record the same row. A plain INSERT makes the loser throw
    // `UNIQUE constraint failed: local_migrations.name` and abort boot, leaving the
    // schema unapplied — a race that looks like "no such table" further down.
    sqlite
        .query(
            `INSERT OR IGNORE INTO ${MIGRATION_STATE_TABLE} (name, hash, applied_at) VALUES (?, ?, ?)`,
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
 * ── WHY THIS ASKS FOR THE WHOLE SCHEMA, NOT ONE TABLE ───────────────────────
 * It used to check only that `node_config` existed. That is not evidence the
 * schema is complete: any consumer that creates one table, or a database left
 * half-migrated by an interrupted boot, passes the check and then has EVERY
 * migration recorded as applied WITHOUT being executed. The result is a database
 * that the runner will never migrate again and that fails on the first read of
 * any other table — reported as `no such table: <x>` from an unrelated module,
 * with no hint that the cause is a backfill several boots earlier.
 *
 * So the backfill now requires every table the migrations create to be present.
 * A genuinely legacy database has them all (the old runner applied every file);
 * anything less falls through to the normal runner, which applies what is
 * missing and is transactional.
 */
function backfillAppliedMigrationsIfSchemaExists(
    sqlite: BunSqliteDatabase,
    files: string[],
    migrationsDir: string,
): boolean {
    const appliedCount = sqlite
        .query(`SELECT COUNT(*) AS count FROM ${MIGRATION_STATE_TABLE}`)
        .get() as { count: number };
    if (appliedCount.count > 0) {
        return false;
    }

    const existing = new Set(
        (
            sqlite
                .query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
                .all() as { name: string }[]
        ).map((row) => row.name),
    );

    // Every table the migration set creates must already exist.
    const created = new Set<string>();
    for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)/gi)) {
            const [, table] = match
            if (table !== undefined) created.add(table)
        }
    }
    if (created.size === 0) {
        return false;
    }
    const missing = [...created].filter((table) => !existing.has(table));
    if (missing.length > 0) {
        // Not a legacy database — a partial one. Let the runner migrate it.
        logger.log(
            `Local schema is incomplete (${String(missing.length)} table(s) missing) — running migrations instead of backfilling`,
        );
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

function runSqliteMigrations(
    sqlite: BunSqliteDatabase,
    migrationsDir: string | undefined,
): void {
    // No directory is a SUPPORTED choice (the app owns its schema), not an
    // error - but it must be loud: without this line a schema that was never
    // migrated is indistinguishable from one that migrated cleanly.
    if (!migrationsDir) {
        logger.warn("local schema migrations are SKIPPED: no migrationsDir was provided");
        return;
    }
    logger.log(`Checking local migrations at: ${migrationsDir}`);
    if (!fs.existsSync(migrationsDir)) {
        logger.warn(`Local migrations directory not found at ${migrationsDir}, skipping`);
        return;
    }
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

    ensureMigrationStateTable(sqlite);

    // Legacy upgrade path: existing schema + empty state table → backfill.
    if (backfillAppliedMigrationsIfSchemaExists(sqlite, files, migrationsDir)) {
        return;
    }

    let applied = 0;
    let skipped = 0;
    for (const file of files) {
        if (isMigrationApplied(sqlite, file)) {
            skipped += 1;
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

        logger.log(`Running local migration: ${file}`);

        // A migration with no executable statements is a valid no-op marker
        // (e.g. a column that was already present in an earlier migration).
        // Record it as applied without executing anything.
        if (statements.length === 0) {
            recordMigrationApplied(sqlite, file, hash);
            applied += 1;
            continue;
        }

        // Execute the whole migration atomically. If ANY statement fails,
        // roll back and do NOT record the migration as applied — the schema
        // must never be left in a half-migrated state that is marked done.
        //
        // `BEGIN IMMEDIATE`, not a plain `BEGIN`: a deferred transaction takes its
        // write lock lazily, on the first write, and SQLite does NOT retry that
        // upgrade under `busy_timeout` — it returns `SQLITE_BUSY` immediately. Two
        // processes against the same file therefore failed with `database is
        // locked` instead of one waiting (two e2e specs share the local DB). An
        // immediate transaction takes the lock up front, where `busy_timeout` DOES
        // apply, so the second writer waits its turn.
        sqlite.run("BEGIN IMMEDIATE");
        try {
            for (const stmt of statements) {
                sqlite.run(stmt);
            }
            recordMigrationApplied(sqlite, file, hash);
            sqlite.run("COMMIT");
            applied += 1;
        } catch (err: unknown) {
            sqlite.run("ROLLBACK");
            const msg = err instanceof Error ? err.message : String(err);
            // A concurrent boot may have applied the same migration between our
            // `isMigrationApplied` check and this transaction, so the DDL conflicts
            // (`table … already exists`, `duplicate column name`) rather than our own
            // record insert. Re-check the state table: if the row is there now, the
            // other process won and this migration IS applied — skip instead of
            // failing a boot over a migration that succeeded.
            if (isMigrationApplied(sqlite, file)) {
                logger.log(`Local migration ${file} was applied concurrently — skipping`);
                skipped += 1;
                continue;
            }
            logger.error(`Migration ${file} FAILED — rolled back, NOT marked applied: ${msg}`);
            throw err;
        }
    }
    logger.log(
        `Local SQLite schema ready — ${String(applied)} applied, ${String(skipped)} already applied (${String(files.length)} total)`,
    );
}

