import { createHash } from "node:crypto";

import type { Database } from "bun:sqlite";

export const MIGRATION_STATE_TABLE = "local_migrations";

export const ensureMigrationStateTable = (sqlite: Database): void => {
	sqlite.run(`
		CREATE TABLE IF NOT EXISTS ${MIGRATION_STATE_TABLE} (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			hash TEXT NOT NULL,
			applied_at TEXT NOT NULL
		)
	`);
};

export const isMigrationApplied = (sqlite: Database, name: string): boolean =>
	sqlite.query(`SELECT 1 FROM ${MIGRATION_STATE_TABLE} WHERE name = ?`).get(name) !== null;

/**
 * Idempotent on purpose. Two processes can boot against the same SQLite file (two e2e suites sharing
 * the default path), both pass `isMigrationApplied`, and both try to record the same row. A plain
 * INSERT makes the loser throw `UNIQUE constraint failed` and abort boot with the schema unapplied,
 * which then looks like "no such table" further down.
 */
export const recordMigrationApplied = (sqlite: Database, name: string, hash: string): void => {
	sqlite
		.query(`INSERT OR IGNORE INTO ${MIGRATION_STATE_TABLE} (name, hash, applied_at) VALUES (?, ?, ?)`)
		.run(name, hash, new Date().toISOString());
};

export const hashMigration = (content: string): string => createHash("sha256").update(content).digest("hex");

export const appliedMigrationCount = (sqlite: Database): number =>
	(sqlite.query(`SELECT COUNT(*) AS count FROM ${MIGRATION_STATE_TABLE}`).get() as { count: number }).count;

export const existingTables = (sqlite: Database): Set<string> =>
	new Set((sqlite.query(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((row) => row.name));
