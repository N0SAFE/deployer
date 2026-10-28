/**
 * The Nest host for `@deployer/database`: the base service Drizzle-backed services extend and the DI
 * tokens that name the connections. No connection is created here; the app (or the schema/storage
 * packages) does that.
 */
export { BaseDatabaseService } from "./base-database.service";
export {
	GLOBAL_DATABASE_CONNECTION,
	GLOBAL_DATABASE_POOL,
	LOCAL_DATABASE_CONNECTION,
	LOCAL_DATABASE_CLIENT,
} from "./database-connection";
export type { AnyDrizzleDatabase } from "@deployer/database";
