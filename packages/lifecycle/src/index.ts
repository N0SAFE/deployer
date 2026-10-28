/**
 * @deployer/lifecycle — the application lifecycle as Effect.
 *
 * Framework-free: a Nest app mounts it through `@deployer/nest-effect/lifecycle`.
 */
export { AppLifecycle, makeAppLifecycle } from "./app-lifecycle";
export type { AppLifecycleShape } from "./app-lifecycle";
export { AppLifecyclePhase, BootstrapStep, describePhase } from "./phases";
export type { AppLifecycleEvent, LifecycleState, TransitionDetails } from "./phases";
