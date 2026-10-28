import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import {
	migrateLocalDatabase,
	openLocalDatabase,
	type LocalDatabaseOptions,
	type LocalDatabaseShape,
} from "@deployer/node-state";
import { Cause, Effect, Exit, Scope } from "effect";

export const LOCAL_DATABASE_OPTIONS_TOKEN = "LOCAL_DATABASE_OPTIONS" as const;

/**
 * The Nest host of the local SQLite database: the Effect `LocalDatabase` (in `@deployer/node-state`)
 * with its lifecycle tied to this Nest context.
 *
 * Each context opens its OWN handle (the API runs several contexts in one process), so each closes
 * the one it opened. The connection is opened here, at construction, so providers can inject the
 * Drizzle handle; the schema is migrated at `onModuleInit`, after the graph is resolvable and before
 * any consumer's own init hook, and closed at shutdown, after the container is disposed, so no
 * repository can still be using it.
 */
@Injectable()
export class LocalDatabaseHost implements OnModuleInit, OnApplicationShutdown {
	private readonly logger = new Logger(LocalDatabaseHost.name);
	private readonly scope = Effect.runSync(Scope.make());
	readonly database: LocalDatabaseShape;

	constructor(@Inject(LOCAL_DATABASE_OPTIONS_TOKEN) private readonly options: LocalDatabaseOptions) {
		this.database = LocalDatabaseHost.runUnwrapped(openLocalDatabase(options).pipe(Scope.provide(this.scope)));
	}

	onModuleInit(): void {
		LocalDatabaseHost.runUnwrapped(migrateLocalDatabase(this.database, this.options.migrationsDir));
	}

	onApplicationShutdown(): void {
		const exit = Effect.runSyncExit(Scope.close(this.scope, Exit.void));
		if (Exit.isFailure(exit)) this.logger.warn(`Local SQLite close failed: ${Cause.pretty(exit.cause)}`);
	}

	/** Opening and migrating are synchronous Effects; this runs one and throws its original failure. */
	private static runUnwrapped<A, E>(effect: Effect.Effect<A, E>): A {
		const exit = Effect.runSyncExit(effect);
		if (Exit.isSuccess(exit)) return exit.value;
		throw Cause.squash(exit.cause);
	}
}
