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
 * WHY THE MIGRATIONS ARE NOT IN THIS APP
 * They create the tables `@repo/nest-schema/local` defines, so they ship with
 * that package and this app imports the path. A copy per app would be a second
 * source of truth for the same tables — and `apps/setup` reads `node_config`
 * too, so it would have needed its own.
 */

import { Global, Module } from "@nestjs/common";

import {
	LocalDatabaseModule as NestLocalDatabaseModule,
	type LocalDatabaseModuleOptions,
} from "@repo/nest-database-local/local-database.module";
// The local migrations live in the SCHEMA package: they create the tables that
// `@repo/nest-schema/local` defines, so the package owning the schema owns them,
// and both apps read the same set instead of each carrying a copy.
import { LOCAL_MIGRATIONS_DIR } from "@repo/nest-schema/migrations";
import { EnvModule, EnvService } from "@/config/env/env.module";


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
/**
 * The registration other modules forward into their own `imports`.
 *
 * Exported as a FUNCTION rather than a constant because `forRootAsync` returns
 * a DynamicModule whose factory captures `EnvModule`; calling it per consumer
 * keeps the same shape Nest expects while avoiding a module-level side effect.
 *
 * `NodesModule.forRoot` requires the DynamicModule (not the wrapper class), so
 * this is what makes the node-state repositories able to resolve
 * `LocalDatabaseService` from their own module scope.
 */
export function localDatabaseRegistration() {
	return NestLocalDatabaseModule.forRootAsync({
		imports: [EnvModule],
		inject: [EnvService],
		useFactory: (env: EnvService): LocalDatabaseModuleOptions => ({
			databasePath: env.get("NODE_LOCAL_DB_PATH"),
			migrationsDir: LOCAL_MIGRATIONS_DIR,
		}),
	});
}

@Global()
@Module({
	imports: [localDatabaseRegistration()],
	exports: [NestLocalDatabaseModule],
})
export class LocalDatabaseModule {}
