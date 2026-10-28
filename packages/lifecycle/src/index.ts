/**
 * @deployer/lifecycle — the application lifecycle as Effect.
 *
 * Framework-free: a Nest app provides the `AppLifecycle` tag from `makeAppLifecycle`.
 */
export { AppLifecycle, makeAppLifecycle } from "./app-lifecycle";
export type { AppLifecycleShape } from "./app-lifecycle";
export { AppLifecyclePhase, BootstrapStep, describePhase } from "./phases";
export type { AppLifecycleEvent, LifecycleState, TransitionDetails } from "./phases";
