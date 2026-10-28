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
export { makeManagedWebSupervisor, HEALTH_PATH, INGRESS_INTERNAL_PORT, REACHABILITY_TIMEOUT_MS } from "./managed-web/managed-web-supervisor";
export type { ManagedWebConfig, ManagedWebDeps, ManagedWebSupervisor } from "./managed-web/managed-web-supervisor";
export { probeRoute } from "./managed-web/route-probe";
export type { RouteObservation, RouteProbeTarget } from "./managed-web/route-probe";
export {
	managedWebProcessInfoSchema,
	managedWebSupervisorPayloadSchema,
	PLATFORM_MANAGED_WEB_ROLE,
	PLATFORM_MANAGED_WEB_SUPERVISOR_ID,
} from "./managed-web/schemas";
export type { ManagedWebProcessInfo, ManagedWebSupervisorPayload } from "./managed-web/schemas";
export { makeGlobalDbSupervisor } from "./global-db/global-db-supervisor";
export type { GlobalDbConfig, GlobalDbDeps, GlobalDbSupervisor } from "./global-db/global-db-supervisor";
export { parsePostgresUrl } from "./global-db/connection";
export type { PostgresConnectionInfo } from "./global-db/connection";
export { probeExternalDatabase } from "./global-db/external-probe";
export type { ExternalDatabaseObservation } from "./global-db/external-probe";
export {
	GLOBAL_DB_SUPERVISOR_ID,
	globalDbProcessInfoSchema,
	globalDbSupervisorPayloadSchema,
} from "./global-db/schemas";
export type { GlobalDbProcessInfo, GlobalDbSupervisorPayload } from "./global-db/schemas";
export { makeDatabaseServiceSupervisor } from "./database-service/database-service-supervisor";
export type { DatabaseServiceConfig, DatabaseServiceDeps, DatabaseServiceSupervisor } from "./database-service/database-service-supervisor";
export { instanceAlias, makeDatabaseInstance } from "./database-service/database-instance";
export type { DatabaseInstance, DatabaseInstanceConfig, DatabaseInstanceSettings } from "./database-service/database-instance";
export {
	DATABASE_INSTANCE_PREFIX,
	DATABASE_POSTGRES_PORT,
	DATABASE_ROLE,
	DATABASE_SERVICE_SUPERVISOR_ID,
	databaseInstancePayloadSchema,
	databaseInstanceProcessInfoSchema,
	databaseServicePayloadSchema,
	databaseServiceProcessInfoSchema,
} from "./database-service/schemas";
export type {
	DatabaseInstancePayload,
	DatabaseInstanceProcessInfo,
	DatabaseServicePayload,
	DatabaseServiceProcessInfo,
} from "./database-service/schemas";
export { SupervisedResourceNotRunning } from "./errors";
export { makeEdgeConnectorSupervisor } from "./edge-connector/edge-connector-supervisor";
export type {
	DesiredEdgeConnector,
	EdgeConnectorConfig,
	EdgeConnectorDeps,
	EdgeConnectorProcess,
	EdgeConnectorSupervisor,
} from "./edge-connector/edge-connector-supervisor";
export {
	EDGE_CONNECTOR_BASE_NAME,
	EDGE_CONNECTOR_SUPERVISOR_ID,
	edgeConnectorProcessInfoSchema,
	edgeConnectorRuntimeSchema,
	edgeConnectorSupervisorPayloadSchema,
} from "./edge-connector/schemas";
export type { EdgeConnectorProcessInfo, EdgeConnectorRuntime, EdgeConnectorSupervisorPayload } from "./edge-connector/schemas";
export { makeLocalDbSupervisor } from "./local-db/local-db-supervisor";
export type { LocalDbDeps, LocalDbSupervisor, LocalSqlite } from "./local-db/local-db-supervisor";
export { LOCAL_DB_SUPERVISOR_ID, localDbProcessInfoSchema, localDbSupervisorPayloadSchema } from "./local-db/schemas";
export type { LocalDbProcessInfo, LocalDbSupervisorPayload } from "./local-db/schemas";
export { EntryPortConflict } from "./errors";
export {
	HANDOVER_POLL_MS,
	makeTraefikSupervisor,
} from "./traefik/traefik-supervisor";
export type {
	EdgeIngressPlanInput,
	LaneEntrypoint,
	LaneEntrypoints,
	TraefikConfig,
	TraefikDeps,
	TraefikSupervisor,
} from "./traefik/traefik-supervisor";
export {
	ENTRYPOINT_PROBE_TIMEOUT_MS,
	entrypointCandidates,
	probeEntrypoint,
	runsInsideContainer,
} from "./traefik/entrypoint-probe";
export type { EntrypointObservation } from "./traefik/entrypoint-probe";
export {
	PLATFORM_INGRESS_ROLE,
	PLATFORM_INGRESS_SUPERVISOR_ID,
	TRAEFIK_ACME_STORAGE_MOUNT,
	TRAEFIK_ACME_STORAGE_PATH,
	TRAEFIK_ACME_VOLUME,
	traefikProcessInfoSchema,
	traefikSupervisorPayloadSchema,
} from "./traefik/schemas";
export type { TraefikProcessInfo, TraefikSupervisorPayload } from "./traefik/schemas";
