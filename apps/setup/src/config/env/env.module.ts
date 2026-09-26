import { Module } from "@nestjs/common";
import { EnvModule as NestEnvModule } from "@repo/nest-env";

import { setupEnvSchema } from "./env.schema";
import { EnvService } from "./env.service";

/**
 * The setup app's environment module.
 *
 * Same package as the API's, different schema — the package owns the MECHANISM
 * (load `.env`, validate once) and this app owns the CONTRACT
 * (`setupEnvSchema`).
 *
 * WHY `NestEnvModule` IS RE-EXPORTED RATHER THAN THE BASE CLASS
 * The package's `forRoot` PROVIDES the base `EnvService` and exports it from its
 * own module. Nest validates exports against the currently processed module's
 * providers and imports, so naming the bare class here fails at boot with
 * `UnknownExportException` — the class is not a provider of THIS module. The
 * token belongs to `NestEnvModule`, so `NestEnvModule` is what gets forwarded,
 * and the base service travels with it.
 *
 * The app's own subclass is provided AND exported, so consumers can inject
 * either: `EnvService` for `SetupEnv`-typed access, or the base service (via the
 * re-exported module) when they need `use()` with a different schema.
 */
@Module({
  imports: [NestEnvModule.forRoot({ schema: setupEnvSchema })],
  providers: [EnvService],
  exports: [EnvService, NestEnvModule],
})
export class EnvModule {}

export { EnvService };
