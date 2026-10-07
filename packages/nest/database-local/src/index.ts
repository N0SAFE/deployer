/**
 * @repo/nest-database-local — the local SQLite database.
 *
 * WHAT THIS PACKAGE IS
 * The connection to the SQLite file next to the app: the Drizzle handle, the
 * lifecycle (open lazily, close on shutdown) and the `@Global` module that
 * provides both tokens.
 *
 * WHY IT IS SHARED
 * The file is the platform's pre-setup source of truth — it exists from the
 * first millisecond of boot, before the swarm and before the global Postgres.
 * The setup app reads the cluster decision from it and the API reads the same
 * rows afterwards, so both need the same connection with the same migrations
 * already applied.
 *
 * HOW TO REGISTER IT
 *   LocalDatabaseModule.forRoot({ databasePath, migrationsDir })
 *   LocalDatabaseModule.forRootAsync({ inject: [EnvService], useFactory })
 *
 * The APP supplies the database path. It also supplies the migrations directory
 * unless the local schema is owned some other way — passing none is a supported
 * configuration (migrations are skipped, with a warning) rather than a mistake.
 *
 * The package reads no environment variable and derives no path — it cannot
 * guess either one, and an earlier version that tried produced a silent failure
 * (see `LocalDatabaseModuleOptions.migrationsDir`).
 *
 * WHEN IT APPLIES THE MIGRATIONS
 * At `onModuleInit`, not while the connection is built: opening a handle and
 * shaping its schema are separate concerns, and only a lifecycle hook can
 * decline to migrate. That puts it after the DI graph is resolvable and before
 * every consumer's own init hook.
 *
 * WHAT IT IS NOT
 * No table definitions (those are in `@repo/nest-schema/local`), no repositories
 * (those are in `@repo/nest-nodes`), and no migration FILES — the app owns them
 * so `drizzle-kit` resolves them from its own drizzle config.
 */
export { LocalDatabaseService } from "./local-database.service";
export { LocalDatabaseLifecycleService } from "./local-database-lifecycle.service";
export { LocalDatabaseModule } from "./local-database.module";
export type {
	LocalDatabaseModuleOptions,
	LocalDatabaseModuleAsyncOptions,
} from "./local-database.module";
