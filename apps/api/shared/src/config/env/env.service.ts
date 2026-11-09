import { ConfigService } from '@nestjs/config'
import { Context } from 'effect'

import { runSyncUnwrapped } from '@deployer/effect-core'
import { apiEnvSchema, type ApiEnv } from '@deployer/env'
import { makeEnvironment, type EnvironmentShape } from '@deployer/environment'

/**
 * The API's environment, as the `@deployer/environment` Effect service bound to the API's contract.
 *
 * WHY AN ABSTRACT CLASS AND NOT A TYPE ALIAS
 * A type alias is erased at compile time, so Nest would receive `Object` as the DI token and
 * injection would fail. The abstract class is the runtime token; the merged interface gives it the
 * shape's members, so every injection site is typed by `ApiEnv` without repeating the parameter.
 * Nest provides the shape under this token directly (`apiEnvironmentProvider`), there is no wrapper.
 */
// The tag and its shape are one name on purpose (Nest provides the shape under this token); the empty class is
// the token, and the interface is the merged type. Both rules fire on that intentional merge, and both are
// disabled HERE rather than globally so the rest of the workspace keeps them.
/* eslint-disable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging */
export abstract class EnvService {}
export interface EnvService extends EnvironmentShape<ApiEnv> {}
/* eslint-enable @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unsafe-declaration-merging */

/**
 * The Effect key for the SAME instance.
 *
 * `EnvService` is a constructor-token abstract class, which Effect cannot `yield*`. This key is
 * bound to the identical object by `apiEnvironmentProvider`, so Effect code reaches the environment
 * through the container (`yield* ApiEnvironment`) instead of taking it as a constructor argument.
 */
export class ApiEnvironment extends Context.Service<
    ApiEnvironment,
    EnvironmentShape<ApiEnv>
>()('api/ApiEnvironment') {}

/** The `ConfigModule` has merged the `.env` files into its store; the schema validates what it reads. */
export const apiEnvironmentProvider = {
    provide: EnvService,
    useFactory: (config: ConfigService): EnvService =>
        runSyncUnwrapped(
            makeEnvironment(apiEnvSchema, {
                read: (key) => config.get(key),
                all: () => ({ ...process.env }),
            })
        ),
    inject: [ConfigService],
}

/** Same instance, Effect key — what `collectEffectLayer` picks up for `yield* ApiEnvironment`. */
export const apiEnvironmentEffectProvider = {
    provide: ApiEnvironment,
    useFactory: (env: EnvService): EnvService => env,
    inject: [EnvService],
}
