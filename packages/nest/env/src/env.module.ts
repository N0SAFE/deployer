import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import * as path from "path";
import * as fs from "fs";

import { apiEnvSchema } from "@repo/env";

import { EnvService } from "./env.service";

/**
 * EnvModule — the validated, typed environment for any app in this monorepo.
 *
 * A FRAMEWORK PRIMITIVE, not business logic: it wires `@nestjs/config` to the
 * shared `apiEnvSchema` from `@repo/env` and exposes it through `EnvService`.
 * Both `apps/api` and `apps/setup` need exactly this, and the schema has to be
 * identical for whoever starts the process or the contract drifts — which is
 * what makes it legitimately shared.
 *
 * WHY IT MOVED OUT OF `apps/api`
 * Extracting any of the platform packages (docker, swarm, mesh, supervisors,
 * platform-ingress) was blocked by their importing `@/config/env/env.service`
 * — an app-local path. The dependency itself is legitimate; only its LOCATION
 * was wrong. Moving it here is what unblocks those extractions.
 *
 * `ConfigTriggerService` was deliberately NOT carried over: its only consumer
 * was this module re-exporting it, and it existed to feed the sub-app trigger
 * pipeline that `apps/api` is retiring. Dropping it removes a bridge rather
 * than preserving one.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      validate: (env) => apiEnvSchema.parse(env),
      isGlobal: true,
      envFilePath: (() => {
        const paths = [
          path.resolve(process.cwd(), ".env"),
          path.resolve(process.cwd(), "..", "..", ".env"),
        ];
        return paths.filter((p) => fs.existsSync(p));
      })(),
      ignoreEnvFile: false,
      expandVariables: true,
      cache: true,
    }),
  ],
  providers: [EnvService],
  exports: [EnvService, ConfigModule],
})
export class EnvModule {}
