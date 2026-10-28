import { Effect, Ref } from "effect";

import { DatabaseNotInitialized, DatabaseUnhealthy } from "./errors";

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";


/**
 * Any Drizzle database this handle can hold. Generic over the app's schema, so a subclass narrows
 * `db` to its own tables while the handle itself knows nothing about them: it only stores the
 * connection and runs `SELECT 1`.
 */
export type AnyDrizzleDatabase =
	| NodePgDatabase
	| BunSQLiteDatabase
	| NodePgDatabase<Record<string, unknown>>
	| BunSQLiteDatabase<Record<string, unknown>>;

export type DatabaseHandleShape<DB extends AnyDrizzleDatabase> = {
	/** Sets (or replaces) the connection. */
	readonly init: (db: DB) => Effect.Effect<void>;
	/** Whether a connection has been set. */
	readonly isInitialized: Effect.Effect<boolean>;
	/** The connection, or `DatabaseNotInitialized`. */
	readonly db: Effect.Effect<DB, DatabaseNotInitialized>;
	/**
	 * Runs `SELECT 1` and waits for the answer. Fails with `DatabaseNotInitialized` before a
	 * connection exists and `DatabaseUnhealthy` when the engine errors.
	 */
	readonly probe: Effect.Effect<void, DatabaseNotInitialized | DatabaseUnhealthy>;
	/** `probe` as a boolean: true when the database answered. */
	readonly healthy: Effect.Effect<boolean>;
	/** Synchronous reads for hosts that answer a plain getter. */
	readonly dbNow: () => DB | undefined;
	readonly initNow: (db: DB) => void;
};

const describeFailure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** Runs `SELECT 1` on whichever driver `db` is, awaiting a driver that answers asynchronously. */
const selectOne = (db: AnyDrizzleDatabase): Promise<unknown> => {
	// Duck-typed so neither driver is imported at runtime: bun:sqlite exposes `run`, Postgres `execute`.
	if ("run" in db) return Promise.resolve((db as { run: (sql: string) => unknown }).run("SELECT 1"));
	if ("execute" in db) return Promise.resolve((db as { execute: (sql: string) => unknown }).execute("SELECT 1"));
	return Promise.reject(new Error("Unsupported database type"));
};

/** A holder for one database connection. `owner` names it in errors. */
export function makeDatabaseHandle<DB extends AnyDrizzleDatabase>(
	owner: string,
	initial?: DB,
): DatabaseHandleShape<DB> {
	const ref = Ref.makeUnsafe<DB | undefined>(initial);
	const db = Effect.suspend(() => {
		const current = Ref.getUnsafe(ref);
		return current === undefined ? Effect.fail(new DatabaseNotInitialized({ owner })) : Effect.succeed(current);
	});
	const probe = db.pipe(
		Effect.flatMap((connection) =>
			Effect.tryPromise({
				try: () => selectOne(connection),
				catch: (cause) => new DatabaseUnhealthy({ reason: `Health check failed: ${describeFailure(cause)}` }),
			}),
		),
		Effect.asVoid,
	);
	return {
		init: (connection) => Ref.set(ref, connection),
		isInitialized: Effect.sync(() => Ref.getUnsafe(ref) !== undefined),
		db,
		probe,
		healthy: probe.pipe(
			Effect.as(true),
			Effect.catch((failure) =>
				Effect.logWarning(failure.publicMessage()).pipe(Effect.as(false)),
			),
		),
		dbNow: () => Ref.getUnsafe(ref),
		initNow: (connection) => {
			Effect.runSync(Ref.set(ref, connection));
		},
	};
}
