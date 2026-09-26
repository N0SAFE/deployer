/**
 * The setup app's local-SQLite wiring.
 *
 * Same package as the API's, different DATA: the file path comes from this
 * app's env, and the migrations ship with `@repo/nest-schema` (they create the
 * tables that package defines, and the API reads the same set).
 *
 * WHY `@Global` IS RE-DECLARED: the decorator is not inherited through an
 * import, and `swarm`/`nodes` inject `LocalDatabaseService` without importing
 * this file \u2014 which only resolves if the module holding it is global in THIS
 * container.
 */
import { Global, Module } from "@nestjs/common";

import {
  LocalDatabaseModule as NestLocalDatabaseModule,
  type LocalDatabaseModuleOptions,
} from "@repo/nest-database-local/local-database.module";
import { LOCAL_MIGRATIONS_DIR } from "@repo/nest-schema/migrations";

import { EnvModule, EnvService } from "@/config/env/env.module";

/**
 * The registration other modules forward into their own `imports`.
 *
 * Exported as a FUNCTION rather than a constant because `forRootAsync` returns
 * a DynamicModule whose factory captures `EnvModule`; calling it per consumer
 * keeps the same shape Nest expects while avoiding a module-level side effect.
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
