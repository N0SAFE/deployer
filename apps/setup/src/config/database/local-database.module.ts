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
import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { Cause, Effect, Exit, Scope } from "effect";
import {
	LocalDatabase,
	migrateLocalDatabase,
	openLocalDatabase,
	type LocalDatabaseOptions,
	type LocalDatabaseShape,
} from "@deployer/node-state";
import { LOCAL_MIGRATIONS_DIR } from "@deployer/nest-schema/migrations";

import { EnvModule, EnvService } from "@/config/env/env.module";

const LOCAL_DATABASE_OPTIONS = "LOCAL_DATABASE_OPTIONS" as const;

/** Opening and migrating are synchronous Effects; this runs one and throws its original failure. */
const runUnwrapped = <A, E>(effect: Effect.Effect<A, E>): A => {
	const exit = Effect.runSyncExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
};

/**
 * Ties the Effect `LocalDatabase` to this Nest context: each context opens its OWN handle (the API
 * runs several contexts in one process), so each closes the one it opened. The connection is opened at
 * construction so providers can inject the Drizzle handle; the schema is migrated at `onModuleInit`,
 * after the graph resolves and before any consumer's own init hook, and closed at shutdown, after the
 * container is disposed, so no repository can still be using it.
 */
@Injectable()
class LocalDatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
	private readonly logger = new Logger(LocalDatabaseLifecycle.name);
	private readonly scope = Effect.runSync(Scope.make());
	readonly database: LocalDatabaseShape;

	constructor(@Inject(LOCAL_DATABASE_OPTIONS) private readonly options: LocalDatabaseOptions) {
		this.database = runUnwrapped(openLocalDatabase(options).pipe(Scope.provide(this.scope)));
	}

	onModuleInit(): void {
		runUnwrapped(migrateLocalDatabase(this.database, this.options.migrationsDir));
	}

	onApplicationShutdown(): void {
		const exit = Effect.runSyncExit(Scope.close(this.scope, Exit.void));
		if (Exit.isFailure(exit)) this.logger.warn(`Local SQLite close failed: ${Cause.pretty(exit.cause)}`);
	}
}

@Global()
@Module({
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
		LocalDatabaseLifecycle,
		{ provide: LocalDatabase, useFactory: (host: LocalDatabaseLifecycle) => host.database, inject: [LocalDatabaseLifecycle] },
	],
	exports: [LocalDatabase],
})
export class LocalDatabaseModule {}
