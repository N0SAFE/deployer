/**
 * @deployer/environment — the process environment as Effect.
 *
 * Framework-free: a Nest app mounts it through `@deployer/nest-effect/env`. It ships no schema; each
 * app supplies its own contract.
 */
export { Environment, makeEnvironment, makeLenientEnvironment, processEnvironment } from "./environment";
export type { EnvironmentShape, EnvironmentSource } from "./environment";
export { EnvironmentInvalid } from "./errors";
