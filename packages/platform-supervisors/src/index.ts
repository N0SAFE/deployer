/**
 * @deployer/platform-supervisors — the platform's own infrastructure as Effect supervisors.
 *
 * Each supervisor is a `SupervisorSpec` over the Docker engine; a Nest app hosts it through
 * `SupervisorHost` in `@deployer/nest-effect/supervision`.
 */
export {
	EVENT_RECONNECT_MS,
	makeSwarmAppWiring,
	RECONCILE_INTERVAL_MS,
} from "./swarm-app-wiring/swarm-app-wiring";
export type {
	SwarmAppWiring,
	SwarmAppWiringConfig,
	SwarmAppWiringDeps,
	SwarmAppWiringLogger,
} from "./swarm-app-wiring/swarm-app-wiring";
export {
	SWARM_APP_WIRING_SUPERVISOR_ID,
	swarmAppWiringPayloadSchema,
	swarmAppWiringProcessInfoSchema,
	swarmAppWiringTargetSchema,
} from "./swarm-app-wiring/schemas";
export type {
	SwarmAppWiringPayload,
	SwarmAppWiringProcessInfo,
	SwarmAppWiringTarget,
} from "./swarm-app-wiring/schemas";
