/**
 * The Nest host for `@deployer/docker`: the module that connects the engine in a Nest context, the
 * Promise adapter (`DockerService`) the Nest callers inject, the Promise faces of the Postgres
 * provisioner and the scanner pool, and the base class for supervisors of docker-backed resources.
 * The behaviour is the Effect package's; nothing here decides how docker is driven.
 */
export { DockerModule, DOCKER_CONNECTION_CONFIG, DOCKER_SCANNER_CONFIG } from "./docker.module";
export type { DockerModuleAsyncOptions, DockerModuleOptions } from "./docker.module";
export { DockerService } from "./docker.service";
export { ScannerContainerManagerService } from "./scanner-container-manager.service";
export { PostgresServiceProvisioner, toPostgresIdentity } from "./postgres-service.provisioner";
export type { PostgresIdentityConfig } from "./docker-config";
export { makeMeshAgentEngine } from "./mesh-agent-engine";
