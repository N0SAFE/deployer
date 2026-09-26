import { Module } from "@nestjs/common";
import { apiEnvSchema } from "@repo/env";
import { EnvModule as NestEnvModule } from "@repo/nest-env";

import { EnvService } from "./env.service";

// Re-exported so `@/config/env/env.module` is the ONE import path for both the
// module and its service, matching how consumers already write it.
export { EnvService };

/**
 * The API's environment module.
 *
 * The API owns its CONTRACT (`apiEnvSchema`); the shared `@repo/nest-env`
 * package owns the MECHANISM (load `.env`, validate, expose a typed service).
 * Declaring the schema here is what keeps `apps/setup` free to use the same
 * package with its own variables.
 *
 * WHY `NestEnvModule` IS RE-EXPORTED RATHER THAN THE BASE CLASS
 * The package's `forRoot` PROVIDES the base `EnvService` and exports it from its
 * own module. Nest validates exports against the currently processed module's
 * providers and imports, so naming the bare class here throws
 * `UnknownExportException` at boot — the class is not a provider of THIS module.
 * Re-exporting `NestEnvModule` forwards the token (and the base service with
 * it), so a module can inject either `EnvService` for `ApiEnv`-typed access, or
 * the base service when it needs `use()` with a different schema.
 */
@Module({
  imports: [NestEnvModule.forRoot({ schema: apiEnvSchema })],
  providers: [EnvService],
  exports: [EnvService, NestEnvModule],
})
export class EnvModule {}
