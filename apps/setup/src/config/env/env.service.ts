import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnvService as BaseEnvService } from "@repo/nest-env";

import { setupEnvSchema, type SetupEnv } from "./env.schema";

/**
 * The setup app's environment service — the shared mechanism bound to THIS
 * app's contract.
 *
 * Compare with `apps/api/src/config/env/env.service.ts`: same base class, same
 * package, different schema. That is the whole design — neither app inherits
 * the other's variables, and the package holds no schema at all.
 *
 * A subclass rather than a type alias because a `type` is erased at compile
 * time: Nest would receive `Object` as the DI token and injection would fail.
 */
@Injectable()
export class EnvService extends BaseEnvService<SetupEnv> {
  constructor(@Optional() configService?: ConfigService) {
    super(setupEnvSchema, configService);
  }
}
