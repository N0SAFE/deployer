/**
 * The Nest host for `@deployer/environment`: the module that loads `.env` files and the service the
 * Nest callers inject. The schema is the app's; the validation is the Effect package's.
 */
export { EnvModule } from "./env.module";
export type { EnvModuleOptions } from "./env.module";
export { EnvService } from "./env.service";
