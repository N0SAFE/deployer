import { Module } from "@nestjs/common";
import { EnvModule as NestEnvModule, EnvService as BaseEnvService } from "@repo/nest-env";

import { setupEnvSchema } from "./env.schema";
import { EnvService } from "./env.service";

/**
 * The setup app's environment module.
 *
 * Same package as the API's, different schema. Both symbols are re-exported so
 * `@/config/env/env.module` is the single import path for the module and its
 * service.
 */
@Module({
  imports: [NestEnvModule.forRoot({ schema: setupEnvSchema })],
  providers: [EnvService],
  exports: [EnvService, BaseEnvService, NestEnvModule],
})
export class EnvModule {}

export { EnvService };
