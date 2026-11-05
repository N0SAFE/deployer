/**
 * @deployer/database — a Drizzle database handle as Effect.
 *
 * Framework-free: a Nest app holds a handle from `makeDatabaseHandle`. It creates no
 * connection and declares no schema; the app (or the schema/storage packages) do.
 */
export { makeDatabaseHandle } from './database-handle'
export type { AnyDrizzleDatabase, DatabaseHandleShape } from './database-handle'
export { DatabaseNotInitialized, DatabaseUnhealthy } from './errors'
