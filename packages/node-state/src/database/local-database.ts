import * as localSchema from "@deployer/nest-schema/local";
import { Database } from "bun:sqlite";
import { Context, Effect, Layer, type Scope } from "effect";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

import { LocalDatabaseError } from "./errors";
import { runMigrations } from "./migrations/run-migrations";
import type { LocalDatabaseOptions } from "./options";

/** The typed Drizzle handle on the local SQLite database. */
export type LocalDb = BunSQLiteDatabase<typeof localSchema>;

export type LocalDatabaseShape = {
	/** The Drizzle handle, for hosts that must hand a raw connection to code outside Effect. */
	readonly db: LocalDb;
	/** The raw `bun:sqlite` handle underneath, so it can be closed without reaching into Drizzle. */
	readonly client: Database;
	/**
	 * Runs a synchronous query against the database. bun:sqlite is synchronous, so the Effect is too
	 * and `Effect.runSync` is valid for callers that must stay synchronous. A thrown query becomes a
	 * `LocalDatabaseError` naming the `operation`.
	 */
	readonly use: <A>(operation: string, run: (db: LocalDb) => A) => Effect.Effect<A, LocalDatabaseError>;
};

const failed = (operation: string) => (cause: unknown) =>
	new LocalDatabaseError({ operation, reason: cause instanceof Error ? cause.message : String(cause) });

export const makeLocalDatabaseFrom = (client: Database): LocalDatabaseShape => {
	const db = drizzle(client, { schema: localSchema });
	return {
		db,
		client,
		use: (operation, run) => Effect.try({ try: () => run(db), catch: failed(operation) }),
	};
};

/**
 * Opens the file (creating its directory) and shapes the connection; it is closed when the scope
 * ends. Pass `client` to use a handle you opened yourself (an in-memory one under test). The schema is
 * NOT migrated here: see `migrateLocalDatabase`, and `makeLocalDatabase` for both together.
 *
 * `bun:sqlite`'s `close()` checkpoints the WAL and releases the file, so no repository can still be
 * using the handle when it runs: the scope ends after everything that depends on this layer.
 */
export const openLocalDatabase = (
	options: LocalDatabaseOptions & { readonly client?: Database },
): Effect.Effect<LocalDatabaseShape, LocalDatabaseError, Scope.Scope> =>
	Effect.gen(function* () {
		const client = yield* Effect.acquireRelease(
			Effect.try({
				try: () => {
					if (options.client !== undefined) return options.client;
					ensureDirectory(options.databasePath);
					return new Database(options.databasePath);
				},
				catch: failed("open"),
			}),
			(handle) =>
				Effect.try(() => { handle.close(); }).pipe(
					Effect.matchEffect({
						onSuccess: () => Effect.logInfo("🔌 Local SQLite connection closed"),
						onFailure: (error) => Effect.logWarning(`Local SQLite close failed: ${error.message}`),
					}),
				),
		);
		yield* Effect.logInfo(`Using local SQLite database path: ${options.databasePath}`);
		yield* Effect.try({
			try: () => {
				client.run("PRAGMA journal_mode = WAL;");
				// 15s, not 5s: the file is opened by several contexts in one process (and several runtimes
				// under test). A migration waiting behind another writer must outlast that writer's whole
				// run, or the loser fails with `database is locked` instead of simply being second.
				client.run(	"PRAGMA busy_timeout = 15000;");
			},
			catch: failed("configure"),
		});
		return makeLocalDatabaseFrom(client);
	});

/**
 * Brings the schema up to date from the migration files. Opening a handle and shaping its schema are
 * separate concerns, so a host can open at construction and migrate when its lifecycle says so.
 */
export const migrateLocalDatabase = (database: LocalDatabaseShape, migrationsDir: string | undefined): Effect.Effect<void, LocalDatabaseError> =>
	runMigrations(database.client, migrationsDir);

/** Opens, shapes and migrates, in that order. */
export const makeLocalDatabase = (
	options: LocalDatabaseOptions & { readonly client?: Database },
): Effect.Effect<LocalDatabaseShape, LocalDatabaseError, Scope.Scope> =>
	Effect.gen(function* () {
		const database = yield* openLocalDatabase(options);
		yield* migrateLocalDatabase(database, options.migrationsDir);
		return database;
	});

function ensureDirectory(databasePath: string): void {
	const dir = path.dirname(databasePath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** The local SQLite database, opened and migrated once per layer. */
export class LocalDatabase extends Context.Service<LocalDatabase, LocalDatabaseShape>()("node-state/LocalDatabase") {
	static readonly layer = (options: LocalDatabaseOptions & { readonly client?: Database }): Layer.Layer<LocalDatabase, LocalDatabaseError> =>
		Layer.effect(LocalDatabase, makeLocalDatabase(options));
}
