/**
 * @deployer/database — a Drizzle database handle as Effect.
 *
 * Framework-free: a Nest app mounts it through `@deployer/nest-effect/database`. It creates no
 * connection and declares no schema; the app (or the schema/storage packages) do.
 */
export { makeDatabaseHandle } from "./database-handle";
export type { AnyDrizzleDatabase, DatabaseHandleShape } from "./database-handle";
export { DatabaseNotInitialized, DatabaseUnhealthy } from "./errors";
