import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnvService as BaseEnvService } from "@repo/nest-env";
import { apiEnvSchema, type ApiEnv } from "@repo/env";

/**
 * The API's environment service — the shared mechanism bound to the API's
 * contract.
 *
 * WHY A SUBCLASS RATHER THAN A TYPE ALIAS
 * A `type EnvService = NestEnvService<ApiEnv>` would be erased at compile time,
 * so Nest would receive `Object` as the DI token and injection would fail. A
 * real class keeps a runtime token AND narrows `get()` to `ApiEnv`'s keys, so
 * every injection site is typed without repeating the type parameter.
 *
 * The SCHEMA lives in `@repo/env` (the variable-shape contract, shared with
 * whatever else needs to read it); this class is the API's binding of it. An
 * app with different variables subclasses the same base with its own schema and
 * neither app inherits the other's.
 */
@Injectable()
export class EnvService extends BaseEnvService<ApiEnv> {
  constructor(@Optional() configService?: ConfigService) {
    super(apiEnvSchema, configService);
  }
}
