/**
 * The setup app's local SQLite: it opens the node's file (the same one the API reads, because setup WRITES the swarm participation decision the API READS) and provides the `@deployer/node-state`
 * `LocalDatabase` Effect service under its own tag.
 *
 * This module owns the CONFIGURATION: WHERE this app's file lives and WHERE its migration files live.
 * Both are the app's, not a package's: an earlier version derived the migrations directory from its
 * own file location, which resolved to a directory that did not exist once the module moved into a
 * package, and the app booted against an UNMIGRATED schema. The migrations create the tables
 * `@deployer/nest-schema/local` defines, so they ship with that package and this app imports the path.
 */
import { Cause, Context, Effect, Exit, Scope } from "effect";

import { createGlobalModule, serviceLifecycle } from "@deployer/nest-effect";
import { LOCAL_MIGRATIONS_DIR } from "@deployer/nest-schema/migrations";
import {
	LocalDatabase,
	migrateLocalDatabase,
	openLocalDatabase,
	type LocalDatabaseOptions,
	type LocalDatabaseShape,
} from "@deployer/node-state";

import { EnvModule, EnvService } from "@/config/env/env.module";

const LOCAL_DATABASE_OPTIONS = "LOCAL_DATABASE_OPTIONS" as const;
const LOCAL_DATABASE_HANDLE = "LOCAL_DATABASE_HANDLE" as const;

/** Opening is a synchronous Effect; this runs one and throws its original failure. */
const runUnwrapped = <A, E>(effect: Effect.Effect<A, E>): A => {
	const exit = Effect.runSyncExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
};

/** The connection and the scope that owns it: each context opens its OWN handle, so each closes the one it opened. */
interface LocalDatabaseHandle {
	readonly database: LocalDatabaseShape;
	readonly scope: Scope.Closeable;
	readonly options: LocalDatabaseOptions;
}

/**
 * The database's lifetime, declared as a lifecycle: the schema is migrated in `onStart` (after the graph resolves
 * and before any consumer's own start), and the handle is closed in `onStop`, after the work that uses it.
 */
export type LocalDatabaseLifecycleShape = {
	readonly onStart: () => Effect.Effect<void, unknown>;
	readonly onStop: () => Effect.Effect<void, unknown>;
};

export class LocalDatabaseLifecycle extends Context.Service<LocalDatabaseLifecycle, LocalDatabaseLifecycleShape>()(
	"setup/LocalDatabaseLifecycle",
) {}

export const LocalDatabaseModule = createGlobalModule({
	imports: [EnvModule],
	providers: [
		{
			provide: LOCAL_DATABASE_OPTIONS,
			useFactory: (env: EnvService): LocalDatabaseOptions => ({
				databasePath: env.get("NODE_LOCAL_DB_PATH"),
				migrationsDir: LOCAL_MIGRATIONS_DIR,
			}),
			inject: [EnvService],
		},
		{
			// Opened at construction so providers can inject the Drizzle handle.
			provide: LOCAL_DATABASE_HANDLE,
			useFactory: (options: LocalDatabaseOptions): LocalDatabaseHandle => {
				const scope = Effect.runSync(Scope.make());
				return { database: runUnwrapped(openLocalDatabase(options).pipe(Scope.provide(scope))), scope, options };
			},
			inject: [LOCAL_DATABASE_OPTIONS],
		},
		{ provide: LocalDatabase, useFactory: (handle: LocalDatabaseHandle) => handle.database, inject: [LOCAL_DATABASE_HANDLE] },
		{
			provide: LocalDatabaseLifecycle,
			useFactory: (handle: LocalDatabaseHandle): LocalDatabaseLifecycleShape => ({
				onStart: () => migrateLocalDatabase(handle.database, handle.options.migrationsDir).pipe(Effect.asVoid),
				onStop: () => Scope.close(handle.scope, Exit.void),
			}),
			inject: [LOCAL_DATABASE_HANDLE],
		},
		serviceLifecycle(LocalDatabaseLifecycle),
	],
	exports: [LocalDatabase],
});
