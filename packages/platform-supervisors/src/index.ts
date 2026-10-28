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
export { SupervisedResourceMissing, SupervisedResourceUnavailable } from "./errors";
export {
	attachOverlay,
	DEFERRED_UNTIL_SWARM,
	makeSwarmServiceOps,
	PLATFORM_ROLE_LABEL,
} from "./swarm-service/swarm-service-ops";
export type { SwarmServiceOps } from "./swarm-service/swarm-service-ops";
export { makeRedisSupervisor } from "./redis/redis-supervisor";
export type { RedisConfig, RedisManagedConfig, RedisSupervisor, RedisSupervisorDeps } from "./redis/redis-supervisor";
export {
	PLATFORM_REDIS_SUPERVISOR_ID,
	REDIS_CONTAINER_BASE_NAME,
	REDIS_DATA_MOUNT,
	REDIS_DATA_VOLUME,
	REDIS_INTERNAL_PORT,
	REDIS_SERVICE_IMAGE_DEFAULT,
	redisProcessInfoSchema,
	redisRuntimeSchema,
	redisSupervisorPayloadSchema,
} from "./redis/schemas";
export type { RedisProcessInfo, RedisRuntime, RedisSupervisorPayload } from "./redis/schemas";
