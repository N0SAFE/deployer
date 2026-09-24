/**
 * @repo/nest-docker — Docker engine primitives: containers, swarm services,
 * networks and volumes, plus the swarm-spec translation.
 *
 * WHAT THIS PACKAGE IS
 *   - `DockerService`            — the engine client (containers, services,
 *                                  networks, volumes, exec, logs)
 *   - `AbstractDockerContainerService` — container lifecycle base class
 *   - `BaseDockerSupervisorService`    — supervisor base for docker-backed
 *                                  resources (converge/probe/proc-info)
 *   - `toDockerServiceSpec`      — swarm-spec → dockerode `ServiceSpec`
 *   - the runtime/scope vocabulary (`DockerSupervisorRuntime`,
 *                                  `resolveSupervisorRuntime`, …)
 *   - the narrow config contracts (`DockerConnectionConfig`, `ScannerConfig`,
 *                                  `PostgresIdentityConfig`)
 *
 * WHAT IT IS NOT
 * It names no platform service and owns no environment. The supervisor
 * TOPOLOGY (which services exist, and their placement) lives in the app, because
 * naming our ingress/redis/database is a platform decision — the package only
 * knows HOW to schedule whatever it is given.
 *
 * Config arrives as DATA through the narrow contracts, so a second Nest app can
 * use these primitives with its own configuration instead of inheriting this
 * app's environment schema.
 */
export * from "./docker-config";
export { DockerModule } from "./docker.module";
export type { DockerModuleOptions, DockerModuleAsyncOptions } from "./docker.module";
export { DOCKER_CONNECTION_CONFIG, DOCKER_SCANNER_CONFIG } from "./docker.module";
export { DockerService } from "./services/docker.service";
export { AbstractDockerContainerService } from "./services/abstract-docker-container.service";
export { BaseDockerSupervisorService } from "./services/base-docker-supervisor.service";
export { CONTAINER_LINK_RESOLVER } from "./services/container-link-resolver.interface";
export type {
  IContainerLinkResolver,
  ContainerEnrichment,
} from "./services/container-link-resolver.interface";
export { toDockerServiceSpec } from "./services/swarm-spec.mapper";
export {
  resolveSupervisorRuntime,
  swarmRuntimeForScope,
  SUPERVISOR_RUNTIME_RAW,
  platformNetworkName,
  platformOverlayNetworkName,
  platformOverlayForPrefix,
} from "./services/docker-supervisor-runtime";
export type {
  DockerSupervisorRuntime,
  SupervisorScope,
  SupervisorTopology,
} from "./services/docker-supervisor-runtime";
export {
  ScannerContainerManagerService,
} from "./services/scanner-container-manager.service";
export {
  PostgresServiceProvisioner,
  toPostgresIdentity,
  MANAGED_POSTGRES_IMAGE,
  MANAGED_POSTGRES_CONTAINER_NAME,
  MANAGED_POSTGRES_ALIAS,
  MANAGED_POSTGRES_PORT,
  MANAGED_POSTGRES_VOLUME_NAME,
  managedPostgresServiceName,
} from "./containers/postgres/postgres-service.provisioner";
