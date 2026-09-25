/**
 * CORE MODULE: Local database — the API's WIRING of `@repo/nest-database-local`.
 *
 * The package owns the mechanism (open SQLite, run migrations, expose the
 * Drizzle handle and its tokens); this module owns the CONFIGURATION: WHERE
 * this app's file lives and WHERE its migration files live.
 *
 * BOTH VALUES ARE THE APP'S, NOT THE PACKAGE'S
 * An earlier version of the package read `process.env.NODE_LOCAL_DB_PATH` and
 * derived the migrations directory from its own file location. That worked only
 * while the module lived inside the app: once it moved into a package, the
 * derived path resolved to a directory that does not exist, the runner logged
 * "directory not found, skipping", and the app booted against an UNMIGRATED
 * schema. `forRootAsync` is what makes that class of failure impossible — the
 * app must supply both, so neither can be wrong by accident.
 *
 * WHY THE MIGRATIONS PATH IS COMPUTED HERE
 * Migrations are the app's DATA — they describe this app's local tables, and
 * `drizzle-kit` generates and reads them from this app's drizzle config. The
 * path is relative to THIS file, so it stays correct regardless of the process
 * working directory.
 */

import { Global, Module } from "@nestjs/common";
import { fileURLToPath } from "node:url";

import {
	LocalDatabaseModule as NestLocalDatabaseModule,
	type LocalDatabaseModuleOptions,
} from "@repo/nest-database-local/local-database.module";
import { EnvModule, EnvService } from "@/config/env/env.module";

/** Where THIS app's SQLite migrations live. */
const LOCAL_MIGRATIONS_DIR = fileURLToPath(
	new URL("../../../../config/drizzle/local/migrations", import.meta.url),
);

/**
 * The API's local-database module.
 *
 * Re-exported under the same name the package used, so the modules that consume
 * it keep one identifier and only their import path changes.
 *
 * `@Global` is re-declared here because the decorator is not inherited through
 * an import: consumers inject `LocalDatabaseService` without importing this
 * file, and that only works if the module holding it is global in THIS container.
 */
@Global()
@Module({
	imports: [
		NestLocalDatabaseModule.forRootAsync({
			imports: [EnvModule],
			inject: [EnvService],
			useFactory: (env: EnvService): LocalDatabaseModuleOptions => ({
				databasePath: env.get("NODE_LOCAL_DB_PATH"),
				migrationsDir: LOCAL_MIGRATIONS_DIR,
			}),
		}),
	],
	exports: [NestLocalDatabaseModule],
})
export class LocalDatabaseModule {}
