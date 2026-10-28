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
export { toDockerServiceSpec } from "./swarm/swarm-spec.mapper";
export { resolveDockerHostIp } from "./host-address";
export { CONTAINER_LINK_RESOLVER } from "./container-link-resolver";
export type { IContainerLinkResolver, ContainerEnrichment } from "./container-link-resolver";
export {
	resolveSupervisorRuntime,
	swarmRuntimeForScope,
	SUPERVISOR_RUNTIME_RAW,
	platformNetworkName,
	platformOverlayNetworkName,
	platformOverlayForPrefix,
} from "./supervisor/docker-supervisor-runtime";
export type {
	DockerSupervisorRuntime,
	SupervisorScope,
	SupervisorTopology,
} from "./supervisor/docker-supervisor-runtime";
export type {
	ContainerHealth,
	HttpProbeResult,
} from "./engine/containers";
export type { RecreateOverlayOptions, RecreateOverlayResult } from "./engine/networks";
export type {
	SwarmClusterShape,
	SwarmConfigsShape,
	SwarmDataObject,
	SwarmNodesShape,
	SwarmSecretsShape,
} from "./engine/swarm-cluster";
export type { VolumesShape } from "./engine/volumes";
export {
	buildSwarmNodeSpecPayload,
	resolveSwarmNodeRole,
} from "./swarm/swarm-node";
export type {
	SwarmNodeAvailability,
	SwarmNodeRole,
	SwarmNodeSpecChange,
	SwarmNodeSpecPayload,
	SwarmNodeSpecSource,
} from "./swarm/swarm-node";
