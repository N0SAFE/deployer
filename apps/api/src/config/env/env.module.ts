import { Module } from "@nestjs/common";
import { apiEnvSchema } from "@repo/env";
import { EnvModule as NestEnvModule, EnvService as BaseEnvService } from "@repo/nest-env";

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
 * Both the base service and the API's subclass are provided, so a module can
 * inject either: `EnvService` for `ApiEnv`-typed access, or the base
 * `BaseEnvService` when it needs `use()` with a different schema.
 */
@Module({
  imports: [NestEnvModule.forRoot({ schema: apiEnvSchema })],
  providers: [EnvService],
  exports: [EnvService, BaseEnvService, NestEnvModule],
})
export class EnvModule {}
