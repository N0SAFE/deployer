import * as fs from "node:fs";
import * as path from "node:path";

import { ConfigModule } from "@nestjs/config";

import { apiEnvSchema } from "@deployer/env";
import { createModuleContext } from "@deployer/nest-effect";

import { apiEnvironmentProvider, EnvService } from "./env.service";

// Re-exported so `@/config/env/env.module` is the ONE import path for both the
// module and its service, matching how consumers already write it.
export { EnvService };

/**
 * The API's environment module.
 *
 * `ConfigModule` loads the `.env` files (the working directory's and the repo root's, which covers
 * running from an app directory and from the root) and validates them once through the API's own
 * contract, `apiEnvSchema`, so a malformed environment fails at boot with the schema's message.
 * The Effect environment is then provided under the `EnvService` token.
 */
export class EnvModule extends createModuleContext({
  imports: [
    ConfigModule.forRoot({
      validate: (env) => apiEnvSchema.parse(env) as Record<string, unknown>,
      isGlobal: true,
      envFilePath: [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", "..", ".env")].filter((p) =>
        fs.existsSync(p),
      ),
      ignoreEnvFile: false,
      expandVariables: true,
      cache: true,
    }),
  ],
  providers: [apiEnvironmentProvider],
  exports: [EnvService, ConfigModule],
}) {}
