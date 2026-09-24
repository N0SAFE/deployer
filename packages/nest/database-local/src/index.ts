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
 * WHAT IT IS NOT
 * No table definitions (those are in `@repo/nest-schema/local`), no repositories
 * (those are in `@repo/nest-nodes`), and no migrations — the app owns its
 * drizzle config and migration files so `drizzle-kit` resolves them from there.
 */
export { LocalDatabaseService } from "./local-database.service";
export { LocalDatabaseLifecycleService } from "./local-database-lifecycle.service";
export { LocalDatabaseModule } from "./local-database.module";
