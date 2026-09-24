/**
 * @repo/nest-env — validated, typed environment for any NestJS app.
 *
 * WHAT THIS PACKAGE IS
 * The MECHANISM: load `.env`, validate once through a schema, expose a typed
 * `EnvService`. Plus a `forRoot`/`forRootAsync` module to wire it.
 *
 * WHAT IT IS NOT
 * It ships NO schema. The environment contract is application policy — which
 * variables exist, their defaults, which are required — so each app supplies
 * its own:
 *
 *   EnvModule.forRoot({ schema: apiEnvSchema })
 *   EnvModule.forRoot({ schema: setupEnvSchema })
 *
 * That is what makes the package reusable by a second Nest app: importing it
 * does not impose another app's variables.
 */
export { EnvModule } from "./env.module";
export type { EnvModuleOptions } from "./env.module";
export { EnvService } from "./env.service";
