/**
 * @repo/nest-env — validated, typed environment for every app in this monorepo.
 *
 * Exports:
 *   - `EnvModule`   — @Global module wiring ConfigModule to the shared schema
 *   - `EnvService`  — typed accessor over the parsed environment
 *
 * The SCHEMA lives in `@repo/env` (single source of truth for the env
 * contract); this package is only the NestJS binding for it.
 */
export { EnvModule } from "./env.module";
export { EnvService } from "./env.service";
