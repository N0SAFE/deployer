/**
 * @deployer/environment — the process environment as Effect.
 *
 * Framework-free: a Nest app provides it under its own token (see each app's `EnvModule`). It ships no schema; each
 * app supplies its own contract.
 */
export { Environment, makeEnvironment, makeLenientEnvironment, processEnvironment } from "./environment";
export type { EnvironmentShape, EnvironmentSource } from "./environment";
export { EnvironmentInvalid } from "./errors";
