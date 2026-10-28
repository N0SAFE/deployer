/**
 * @deployer/nest-docker — Docker engine primitives: containers, swarm services,
 * networks and volumes, plus the swarm-spec translation.
 *
 * WHAT THIS PACKAGE IS
 *   - `DockerService`            — the engine client (containers, services,
 *                                  networks, volumes, exec, logs)
 *   - `BaseDockerSupervisorService`    — supervisor base for docker-backed
 *                                  resources (converge/probe/proc-info)
 *   - `toDockerServiceSpec`      — swarm-spec → dockerode `ServiceSpec`
 *   - the runtime/scope vocabulary (`DockerSupervisorRuntime`,
 *                                  `resolveSupervisorRuntime`, …)
 *   - the narrow config contracts (now in `@deployer/docker`; `PostgresIdentityConfig` here,
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
export { BaseDockerSupervisorService } from "./services/base-docker-supervisor.service";
export {
  ScannerContainerManagerService,
} from "./services/scanner-container-manager.service";
export { PostgresServiceProvisioner, toPostgresIdentity } from "./containers/postgres/postgres-service.provisioner";
