import { ConfigService } from "@nestjs/config";
import { runSyncUnwrapped } from "@deployer/effect-core";
import { makeEnvironment, type EnvironmentShape } from "@deployer/environment";
import { apiEnvSchema, type ApiEnv } from "@deployer/env";

/**
 * The API's environment, as the `@deployer/environment` Effect service bound to the API's contract.
 *
 * WHY AN ABSTRACT CLASS AND NOT A TYPE ALIAS
 * A type alias is erased at compile time, so Nest would receive `Object` as the DI token and
 * injection would fail. The abstract class is the runtime token; the merged interface gives it the
 * shape's members, so every injection site is typed by `ApiEnv` without repeating the parameter.
 * Nest provides the shape under this token directly (`apiEnvironmentProvider`), there is no wrapper.
 */
export abstract class EnvService {}
export interface EnvService extends EnvironmentShape<ApiEnv> {}

/** The `ConfigModule` has merged the `.env` files into its store; the schema validates what it reads. */
export const apiEnvironmentProvider = {
  provide: EnvService,
  useFactory: (config: ConfigService): EnvService =>
    runSyncUnwrapped(
      makeEnvironment(apiEnvSchema, { read: (key) => config.get(key), all: () => ({ ...process.env }) }),
    ),
  inject: [ConfigService],
};
