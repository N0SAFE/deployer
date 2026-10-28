/**
 * @deployer/docker — the Docker engine as Effect services.
 *
 * Framework-free: a Nest app mounts it by providing `DockerEngine.Live` over
 * `DockerClient.layer(config)`; nothing here imports Nest.
 */
export { DockerHost, makeDockerHost } from "./client/docker-host";
export type { DockerHostShape } from "./client/docker-host";
export { DockerClient, resolveDockerClient, DEFAULT_DOCKER_SOCKET_PATH } from "./client/docker-client";
export type { DockerConnectionConfig, ResolvedDockerClient } from "./client/docker-client";
export { DockerEngine, makeDockerEngine } from "./engine/docker-engine";
export type { DockerEngineShape } from "./engine/docker-engine";
export { DockerConflict, DockerInvalid, DockerNotFound, DockerUnavailable } from "./errors/errors";
export type { DockerError } from "./errors/errors";
export type { ContainerSummary, ContainersShape, CreateContainerOptions, HealthWaitOptions } from "./engine/containers/containers";
export type { ImagePullPolicy, ImagesShape, PullOptions } from "./engine/images/images";
export type { DockerEvent, EventsOptions, EventsShape } from "./engine/events/events";
export type { NetworksShape } from "./engine/networking/networks";
export type { SwarmServicesShape } from "./engine/swarm/swarm-services";
export { toDockerServiceSpec } from "./engine/swarm/swarm-spec.mapper";
export { resolveDockerHostIp } from "./client/host-address";
export { CONTAINER_LINK_RESOLVER } from "./links/container-link-resolver";
export type { IContainerLinkResolver, ContainerEnrichment } from "./links/container-link-resolver";
export {
	resolveSupervisorRuntime,
	swarmRuntimeForScope,
	SUPERVISOR_RUNTIME_RAW,
	platformNetworkName,
	platformOverlayNetworkName,
	platformOverlayForPrefix,
} from "./supervision/docker-supervisor-runtime";
export type {
	DockerSupervisorRuntime,
	SupervisorScope,
	SupervisorTopology,
} from "./supervision/docker-supervisor-runtime";
export type {
	ContainerHealth,
	HttpProbeResult,
} from "./engine/containers/containers";
export type { RecreateOverlayOptions, RecreateOverlayResult } from "./engine/networking/networks";
export type {
	SwarmClusterShape,
	SwarmConfigsShape,
	SwarmDataObject,
	SwarmNodesShape,
	SwarmSecretsShape,
} from "./engine/swarm/swarm-cluster";
export type { VolumesShape } from "./engine/networking/volumes";
export {
	buildSwarmNodeSpecPayload,
	resolveSwarmNodeRole,
} from "./engine/swarm/swarm-node";
export type {
	SwarmNodeAvailability,
	SwarmNodeRole,
	SwarmNodeSpecChange,
	SwarmNodeSpecPayload,
	SwarmNodeSpecSource,
} from "./engine/swarm/swarm-node";
export type { ExecResult, ExecShape, InteractiveExecOptions } from "./engine/containers/exec";
export type { LogsShape } from "./engine/containers/logs";
export type { BuildComposeOptions, BuildImageOptions, BuildShape } from "./engine/images/build";
export {
	attachPostgresOverlay,
	buildPostgresSpec,
	MANAGED_POSTGRES_ALIAS,
	MANAGED_POSTGRES_CONTAINER_NAME,
	MANAGED_POSTGRES_IMAGE,
	MANAGED_POSTGRES_PORT,
	MANAGED_POSTGRES_VOLUME_NAME,
	makePostgresProvisioner,
	managedPostgresServiceName,
	PostgresProvisionFailed,
	PostgresProvisioner,
} from "./provisioning/postgres";
export type { PostgresIdentity, PostgresProvisionerShape } from "./provisioning/postgres";
export { isSwarmVersionConflict } from "./engine/swarm/swarm-services";
export {
	makeScannerPool,
	ScannerConfigService,
	ScannerEngineAccessService,
	ScannerPool,
} from "./scanning/scanner-pool";
export type {
	ScannerConfig,
	ScannerEngineAccess,
	ScannerExecResult,
	ScannerPoolShape,
	ScannerType,
} from "./scanning/scanner-pool";
