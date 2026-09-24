/**
 * @repo/nest-database-core — the framework primitives every Drizzle-backed
 * service in this monorepo is built on.
 *
 * WHAT THIS PACKAGE IS
 *   - `BaseDatabaseService`: the abstract base holding a connection and exposing
 *     a typed `db` handle, with a duck-typed health check that works for both
 *     drivers (Postgres `execute`, bun:sqlite `run`) without importing either
 *     runtime at module load.
 *   - The DI tokens naming the connections and pooled clients.
 *
 * WHAT IT IS NOT
 * No connection is created here, no schema is declared here, and no boot policy
 * lives here. Those belong to the app (or to the schema/storage packages), which
 * is why this package has no dependency on either database's driver beyond the
 * drizzle TYPES.
 */
export { BaseDatabaseService } from "./base-database.service";
export {
	GLOBAL_DATABASE_CONNECTION,
	GLOBAL_DATABASE_POOL,
	LOCAL_DATABASE_CONNECTION,
	LOCAL_DATABASE_CLIENT,
} from "./database-connection";
