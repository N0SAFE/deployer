/**
 * @deployer/docker — the Docker engine as Effect services.
 *
 * Framework-free: a Nest app mounts it by providing `DockerEngine.Live` over
 * `DockerClient.layer(config)`; nothing here imports Nest.
 */
export { DockerClient, resolveDockerClient, DEFAULT_DOCKER_SOCKET_PATH } from "./docker-client";
export type { DockerConnectionConfig, ResolvedDockerClient } from "./docker-client";
export { DockerEngine, makeDockerEngine } from "./docker-engine";
export type { DockerEngineShape } from "./docker-engine";
export { DockerConflict, DockerInvalid, DockerNotFound, DockerUnavailable } from "./errors";
export type { DockerError } from "./errors";
export type { ContainerSummary, ContainersShape, CreateContainerOptions, HealthWaitOptions } from "./engine/containers";
export type { ImagePullPolicy, ImagesShape, PullOptions } from "./engine/images";
export type { NetworksShape } from "./engine/networks";
export type { SwarmServicesShape } from "./engine/swarm-services";
