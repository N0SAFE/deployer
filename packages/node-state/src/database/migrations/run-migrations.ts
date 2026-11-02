import * as fs from "node:fs";
import * as path from "node:path";

import { Effect } from "effect";


import { LocalDatabaseError } from "../errors";

import {
	appliedMigrationCount,
	ensureMigrationStateTable,
	existingTables,
	hashMigration,
	isMigrationApplied,
	recordMigrationApplied,
} from "./state-table";

import type { Database } from "bun:sqlite";

const migrationError = (reason: unknown) =>
	new LocalDatabaseError({ operation: "migration", reason: reason instanceof Error ? reason.message : String(reason) });

/** Breaks a migration file into executable statements; comment-only ones become valid no-ops. */
const statementsOf = (sql: string): string[] =>
	sql
		.split("--> statement-breakpoint")
		.map((statement) => statement.trim())
		.map((statement) =>
			statement
				.split("\n")
				.filter((line) => !line.trim().startsWith("--"))
				.join("\n")
				.trim(),
		)
		.filter((statement) => statement.length > 0);

const readMigration = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), "utf8");

/**
 * One-time backfill for databases migrated by the OLD runner, which re-executed every file on every
 * boot, so such a database has the full schema but no `local_migrations` state.
 *
 * It asks for the WHOLE schema, not one table: a database left half-migrated by an interrupted boot
 * must not have every migration recorded as applied without being run, or the runner never migrates
 * it again and the first read of any other table fails with `no such table` from an unrelated module.
 * Anything less than every created table present falls through to the normal runner.
 */
const backfillLegacySchema = (sqlite: Database, files: string[], dir: string) =>
	Effect.gen(function* () {
		if (appliedMigrationCount(sqlite) > 0) return false;
		const existing = existingTables(sqlite);
		const created = new Set<string>();
		for (const file of files) {
			for (const match of readMigration(dir, file).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)/gi)) {
				const [, table] = match;
				if (table !== undefined) created.add(table);
			}
		}
		if (created.size === 0) return false;
		const missing = [...created].filter((table) => !existing.has(table));
		if (missing.length > 0) {
			yield* Effect.logInfo(
				`Local schema is incomplete (${String(missing.length)} table(s) missing) — running migrations instead of backfilling`,
			);
			return false;
		}
		yield* Effect.logInfo(
			`Existing schema detected with no migration state — backfilling ${String(files.length)} migrations as applied (legacy runner upgrade)`,
		);
		for (const file of files) recordMigrationApplied(sqlite, file, hashMigration(readMigration(dir, file)));
		return true;
	});

type Outcome = "applied" | "skipped";

/**
 * Applies one migration atomically: if any statement fails, it is rolled back and NOT recorded, so
 * the schema is never half-migrated and marked done.
 *
 * `BEGIN IMMEDIATE`, not `BEGIN`: a deferred transaction takes its write lock on the first write, and
 * SQLite does not retry that upgrade under `busy_timeout`, so two processes on the same file failed
 * with `database is locked` instead of one waiting. An immediate transaction takes the lock up front,
 * where `busy_timeout` applies.
 */
const applyMigration = (sqlite: Database, dir: string, file: string): Effect.Effect<Outcome, LocalDatabaseError> =>
	Effect.gen(function* () {
		const sql = readMigration(dir, file);
		const hash = hashMigration(sql);
		const statements = statementsOf(sql);
		yield* Effect.logInfo(`Running local migration: ${file}`);
		// A migration with no executable statements is a valid no-op marker; record it, run nothing.
		if (statements.length === 0) {
			recordMigrationApplied(sqlite, file, hash);
			return "applied" as const;
		}
		return yield* Effect.try({
			try: () => {
				sqlite.run("BEGIN IMMEDIATE");
				try {
					for (const statement of statements) sqlite.run(statement);
					recordMigrationApplied(sqlite, file, hash);
					sqlite.run("COMMIT");
					return "applied";
				} catch (error) {
					sqlite.run("ROLLBACK");
					// A concurrent boot may have applied the same migration between our check and this
					// transaction, so the DDL conflicts rather than our record insert. If the row is there
					// now, the other process won and this migration IS applied.
					if (isMigrationApplied(sqlite, file)) return "skipped";
					throw error;
				}
			},
			catch: migrationError,
		}).pipe(
			Effect.tap((outcome) => (outcome === "skipped" ? Effect.logInfo(`Local migration ${file} was applied concurrently — skipping`) : Effect.void)),
			Effect.tapError((error) => Effect.logError(`Migration ${file} FAILED — rolled back, NOT marked applied: ${error.reason}`)),
		);
	});

/** Brings the local schema up to date from the migration files in `migrationsDir`. */
export const runMigrations = (sqlite: Database, migrationsDir: string | undefined): Effect.Effect<void, LocalDatabaseError> =>
	Effect.gen(function* () {
		// No directory is a supported choice (the app owns its schema), but it must be loud: a schema that
		// was never migrated is otherwise indistinguishable from one that migrated cleanly.
		if (!migrationsDir) return yield* Effect.logWarning("local schema migrations are SKIPPED: no migrationsDir was provided");
		yield* Effect.logInfo(`Checking local migrations at: ${migrationsDir}`);
		if (!fs.existsSync(migrationsDir)) {
			return yield* Effect.logWarning(`Local migrations directory not found at ${migrationsDir}, skipping`);
		}
		const files = yield* Effect.try({
			try: () => fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort(),
			catch: migrationError,
		});
		yield* Effect.try({ try: () => { ensureMigrationStateTable(sqlite); }, catch: migrationError });
		if (yield* backfillLegacySchema(sqlite, files, migrationsDir).pipe(Effect.mapError(migrationError))) return;

		let applied = 0;
		let skipped = 0;
		for (const file of files) {
			const already = yield* Effect.try({ try: () => isMigrationApplied(sqlite, file), catch: migrationError });
			if (already) {
				skipped += 1;
				continue;
			}
			const outcome = yield* applyMigration(sqlite, migrationsDir, file);
			if (outcome === "applied") applied += 1;
			else skipped += 1;
		}
		yield* Effect.logInfo(
			`Local SQLite schema ready — ${String(applied)} applied, ${String(skipped)} already applied (${String(files.length)} total)`,
		);
	});
