import {
    BadRequestException,
    BadGatewayException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import Docker from "dockerode";
import {
    makeDockerEngine,
    resolveDockerClient,
    type ContainerHealth,
    type DockerEngineShape,
    type DockerError,
    type HttpProbeResult,
    type SwarmNodeSpecChange,
} from "@deployer/docker";
import { Cause, Effect, Exit, Stream } from "effect";
import * as fs from "fs";
import { Observable } from "rxjs";
// `DockerConnectionConfig` is a TYPE-ONLY export. Importing it as a value makes
// `bun build` fail with "No matching export in src/docker-config.ts", which is
// reported as `AggregateError: Bundle failed` with exit code 0 and NO dist/types
// written — silently breaking every downstream package that needs this one's types.
import type { DockerConnectionConfig } from "../docker-config";
import type {
    DockerodeSwarmInitResponse,
    DockerodeSwarmInfo,
    DockerodeSwarmInspect,
    DockerodeServiceSummary,
    DockerodeTaskSummary,
    DockerodeNodeSummary,
    DockerodeSecretSummary,
    DockerodeConfigSummary,
    DockerodeImageSummary,
    DockerodeNetworkSummary,
    DockerodeVolumeListResponse,
    SwarmInitOptions,
    SwarmJoinOptions,
    SwarmOverlayNetworkRequest,
} from "@deployer/contracts-entities";

@Injectable()
export class DockerService {
    private readonly logger = new Logger(DockerService.name);
    private readonly docker: Docker;
    /** The Effect-native engine over the current client; the methods below that it covers delegate to it. */
    private get engine(): DockerEngineShape {
        return makeDockerEngine(this.docker);
    }

    /** The Effect engine over this service's client, for the facades that run beside it. */
    getEngine(): DockerEngineShape {
        return this.engine;
    }
    private static readonly DEFAULT_DOCKER_SOCKET_PATH = "/var/run/docker.sock";

    /** The resolved Docker socket path in use (null when using TCP). */
    private resolvedSocketPath: string | null = null;

    /**
     * Return the resolved Docker socket path, or `null` if the client is
     * connected via TCP rather than a Unix socket.
     */
    getDockerSocketPath(): string | null {
        return this.resolvedSocketPath;
    }

    /**
     * Return a Docker socket bind-mount string suitable for container
     * `HostConfig.Binds`, or `null` if the client is connected via TCP.
     *
     * @example "/var/run/docker.sock:/var/run/docker.sock"
     */
    getDockerSocketBindMount(): string | null {
        const socketPath = this.resolvedSocketPath;
        if (!socketPath) {
            return null;
        }
        return `${socketPath}:${socketPath}`;
    }

    private static getErrMsg(err: unknown): string {
        if (err instanceof Error) return err.message;
        if (typeof err === "object" && err !== null && "message" in err) {
            const msg = err.message;
            if (typeof msg === "string") return msg;
        }
        return String(err);
    }








    /**
     * Runs an engine Effect for a Promise caller, translating its typed failure back to the Nest
     * exceptions this service has always thrown. Goes away with the Promise API.
     */
    private async runEngine<A>(effect: Effect.Effect<A, DockerError>): Promise<A> {
        const exit = await Effect.runPromiseExit(effect);
        if (Exit.isSuccess(exit)) {
            return exit.value;
        }
        const failure = Cause.squash(exit.cause);
        if (typeof failure === "object" && failure !== null && "_tag" in failure) {
            const message = failure instanceof Error ? failure.message : "Docker operation failed";
            switch (failure._tag) {
                case "DockerNotFound":
                    throw new NotFoundException(message);
                case "DockerInvalid":
                    throw new BadRequestException(message);
                case "DockerConflict":
                case "DockerUnavailable":
                    throw new BadGatewayException(message);
            }
        }
        throw failure;
    }

    /**
     * Like `runEngine`, for the methods that have always thrown the engine's own error
     * (callers read `statusCode` off it).
     */
    private async runEngineRaw<A>(effect: Effect.Effect<A, DockerError>): Promise<A> {
        const exit = await Effect.runPromiseExit(effect);
        if (Exit.isSuccess(exit)) {
            return exit.value;
        }
        const failure = Cause.squash(exit.cause);
        throw typeof failure === "object" && failure !== null && "cause" in failure && failure.cause !== undefined
            ? failure.cause
            : failure;
    }


    constructor(config: DockerConnectionConfig) {
        const { client, mode, socketPath, warnings } = resolveDockerClient(config);
        for (const warning of warnings) {
            this.logger.warn(warning);
        }
        this.docker = client;
        this.resolvedSocketPath = socketPath;

        if (fs.existsSync(DockerService.DEFAULT_DOCKER_SOCKET_PATH)) {
            try {
                const socketStats = fs.statSync(DockerService.DEFAULT_DOCKER_SOCKET_PATH);
                this.logger.log(
                    `Docker socket found - mode: ${socketStats.mode.toString(8)}, uid: ${String(socketStats.uid)}, gid: ${String(socketStats.gid)}`,
                );
            } catch (error) {
                this.logger.warn(
                    `Docker socket at ${DockerService.DEFAULT_DOCKER_SOCKET_PATH} is present but stats failed: ${DockerService.getErrMsg(error)}`,
                );
            }
        }

        this.logger.log(`Configured Docker client via ${mode}`);
    }
    async testConnection(): Promise<boolean> {
        return Effect.runPromise(this.engine.ping());
    }
    async buildImage(
        sourcePath: string,
        imageTag: string,
        options?: {
            dockerfileName?: string;
            autoCreateDockerfile?: boolean;
            buildArgs?: Record<string, string>;
        },
    ): Promise<void> {
        await this.runEngine(
            this.engine.build.image(sourcePath, imageTag, {
                ...(options?.dockerfileName ? { dockerfileName: options.dockerfileName } : {}),
                ...(options?.buildArgs ? { buildArgs: options.buildArgs } : {}),
            }),
        );
    }

    async buildCompose(
        sourcePath: string,
        options?: {
            composeFileName?: string;
            projectName?: string;
            serviceNames?: string[];
        },
    ): Promise<{ projectName: string; services: string[] }> {
        return this.runEngine(this.engine.build.compose(sourcePath, options));
    }


    async stopContainersByDeployment(deploymentId: string): Promise<void> {
        await this.runEngine(this.engine.containers.stopByDeployment(deploymentId));
    }
    async startContainersByDeployment(deploymentId: string): Promise<void> {
        await this.runEngine(this.engine.containers.startByDeployment(deploymentId));
    }
    async listContainersByDeployment(deploymentId: string): Promise<
        {
            id: string;
            name: string;
            status: string;
        }[]
    > {
        return this.runEngine(this.engine.containers.listByDeployment(deploymentId));
    }
    async checkContainerHealth(containerId: string): Promise<boolean> {
        return Effect.runPromise(this.engine.containers.isHealthy(containerId));
    }

    async getDetailedContainerHealth(containerId: string): Promise<ContainerHealth> {
        return Effect.runPromise(this.engine.containers.health(containerId));
    }

    async monitorContainersByDeployment(deploymentId: string): Promise<
        {
            containerId: string;
            containerName: string;
            health: ContainerHealth;
        }[]
    > {
        return Effect.runPromise(this.engine.containers.monitorByDeployment(deploymentId));
    }

    async performHealthCheck(
        containerId: string,
        healthCheckUrl?: string,
        timeout = 30000
    ): Promise<HttpProbeResult> {
        return Effect.runPromise(this.engine.containers.probe(containerId, healthCheckUrl, timeout));
    }

    async waitForContainerHealth(containerId: string, maxRetries = 30, retryInterval = 2000, healthCheckUrl?: string): Promise<boolean> {
        return Effect.runPromise(
            this.engine.containers.waitForHealth(containerId, {
                maxRetries,
                retryIntervalMs: retryInterval,
                ...(healthCheckUrl === undefined ? {} : { healthCheckUrl }),
            }),
        );
    }

    async restartContainer(containerId: string): Promise<void> {
        await this.runEngineRaw(this.engine.containers.restart(containerId));
    }

    async pauseContainer(containerIdOrName: string): Promise<void> {
        await this.runEngineRaw(this.engine.containers.pause(containerIdOrName));
    }

    async unpauseContainer(containerIdOrName: string): Promise<void> {
        await this.runEngineRaw(this.engine.containers.unpause(containerIdOrName));
    }

    async killContainer(containerIdOrName: string): Promise<void> {
        await this.runEngineRaw(this.engine.containers.kill(containerIdOrName));
    }

    async removeContainer(containerId: string): Promise<void> {
        // Callers clean up with this and have always been spared its failures.
        try {
            await this.runEngine(this.engine.containers.remove(containerId));
        } catch (error) {
            this.logger.error(`Failed to remove container ${containerId}:`, error);
        }
    }
    async removeImage(imageTag: string): Promise<void> {
        // Callers clean up with this and have always been spared its failures.
        try {
            await this.runEngine(this.engine.images.remove(imageTag));
        } catch (error) {
            this.logger.error(`Failed to remove image ${imageTag}:`, error);
        }
    }
    async createContainer(options: CreateContainerOptions): Promise<Docker.Container> {
        const { image, ...engineOptions } = options;
        const created = await this.runEngine(
            this.engine.containers.create({ ...engineOptions, Image: engineOptions.Image ?? image }),
        );
        return this.docker.getContainer(created.id);
    }

    /**
     * Pull an image from a registry with optional auth and retry/backoff.
     */
    async pullImage(
        image: string,
        registryAuth?: Docker.AuthConfig,
        retries = 3,
        backoffMs = 2000,
        onProgressLine?: (line: string) => void,
    ): Promise<void> {
        await this.runEngine(
            this.engine.images.pull(image, {
                ...(registryAuth ? { registryAuth } : {}),
                retries,
                backoffMs,
                ...(onProgressLine ? { onProgressLine } : {}),
            }),
        );
    }


    /**
     * Expose raw Docker client for advanced operations
     */
    getDockerClient(): Docker {
        return this.docker;
    }

    /**
     * Get container information (inspect) by id or name
     */
    async getContainerInfo(containerIdOrName: string): Promise<Docker.ContainerInspectInfo> {
        return this.runEngineRaw(this.engine.containers.inspect(containerIdOrName));
    }


    /**
     * Stop a container by id or name
     */
    async stopContainer(containerIdOrName: string): Promise<void> {
        await this.runEngineRaw(this.engine.containers.stop(containerIdOrName));
    }

    /**
     * Start a container by id or name
     */
    async startContainer(containerIdOrName: string): Promise<Docker.Container> {
        await this.runEngineRaw(this.engine.containers.start(containerIdOrName));
        return this.docker.getContainer(containerIdOrName);
    }

    /**
     * List containers using dockerode listContainers
     */
    async listContainers(options: Docker.ContainerListOptions = {}): Promise<Docker.ContainerInfo[]> {
        // Callers have always been given an empty list when the engine cannot answer.
        return Effect.runPromise(this.engine.containers.list(options).pipe(Effect.catch(() => Effect.succeed([]))));
    }

    async getContainerStats(containerId: string): Promise<Record<string, any>> {
        return this.runEngineRaw(this.engine.containers.stats(containerId));
    }

    async execInContainer(containerIdOrName: string, cmd: string[], input?: string): Promise<{ exitCode: number; output: string }> {
        return this.runEngine(this.engine.exec.run(containerIdOrName, cmd, input));
    }

    async execInContainerCapture(containerIdOrName: string, cmd: string[], input?: string): Promise<{ exitCode: number; output: string }> {
        return Effect.runPromise(this.engine.exec.capture(containerIdOrName, cmd, input));
    }


    async getContainerLogs(containerIdOrName: string, options: Docker.ContainerLogsOptions = { stdout: true, stderr: true, tail: 200 }): Promise<string> {
        return this.runEngineRaw(this.engine.logs.read(containerIdOrName, options));
    }

    async *streamContainerLogs(
        containerIdOrName: string,
        options: Docker.ContainerLogsOptions & { stderrPrefix?: string } = {},
    ): AsyncIterable<string> {
        for await (const line of Stream.toAsyncIterable(this.engine.logs.stream(containerIdOrName, options))) {
            yield line;
        }
    }

    /**
     * RxJS-friendly wrapper around {@link streamContainerLogs}.
     *
     * Yields each decoded log line on a Subject. Completes when the
     * underlying Docker stream ends, and errors out if the stream errors.
     * Consumers can subscribe and pipe lines into SSE/log emitters without
     * having to deal with the async-iterator protocol.
     *
     * @example
     * ```ts
     * const sub = docker.streamContainerLogs$(containerId, { tail: 0 }).subscribe({
     *     next: (line) => emit(setupEvent),
     *     error: (err) => logger.error(err),
     * });
     * // ... later, on teardown:
     * sub.unsubscribe();
     * ```
     */
    streamContainerLogs$(
        containerIdOrName: string,
        options: Docker.ContainerLogsOptions & { stderrPrefix?: string } = {},
    ): Observable<string> {
        return new Observable<string>((subscriber) => {
            // Kick off consumption; we keep a flag to avoid duplicate teardown
            let cancelled = false;
            void (async () => {
                try {
                    for await (const line of this.streamContainerLogs(containerIdOrName, options)) {
                        if (cancelled) break;
                        subscriber.next(line);
                    }
                    if (!cancelled) subscriber.complete();
                } catch (err: unknown) {
                    if (!cancelled) {
                        subscriber.error(err instanceof Error ? err : new Error(String(err)));
                    }
                }
            })();
            return () => {
                cancelled = true;
            };
        });
    }








    // ==========================================================================
    // SWARM MODE — dockerode SDK (no CLI). All engine responses are Zod-parsed
    // at this boundary (parse, don't validate); business logic never touches
    // dockerode's loose raw shapes.
    // ==========================================================================


    /**
     * Read the local engine's Swarm mode state (GET /info → `.Swarm`).
     * `LocalNodeState` drives idempotent cluster bootstrap (active → no-op).
     */
    async getSwarmInfo(): Promise<DockerodeSwarmInfo> {
        return this.runEngine(this.engine.swarmCluster.info());
    }

    /**
     * Inspect the local Swarm cluster (GET /swarm). Throws NotFoundException
     * when the engine is not part of any cluster.
     */
    async swarmInspect(): Promise<DockerodeSwarmInspect> {
        return this.runEngine(this.engine.swarmCluster.inspect());
    }

    /**
     * Initialize Swarm mode on the local engine (POST /swarm/init).
     * Callers should gate on `getSwarmInfo().LocalNodeState` for idempotency.
     *
     * ── THE RESPONSE IS A STRING, NOT A SWARM OBJECT ────────────────────────
     * `POST /swarm/init` answers with the bare node id that founded the cluster
     * (`dockerodeSwarmInitResponseSchema`), whereas `GET /swarm` answers with a
     * swarm object (`dockerodeSwarmInspectSchema`). This method used to parse the
     * init response with the INSPECT schema — so every successful init failed
     * validation with
     *
     *   Invalid input: expected object, received string
     *
     * and the caller saw "Failed to initialize Swarm cluster" for a cluster that
     * had in fact been created. The node id is returned so the caller can log or
     * correlate it.
     */
    async swarmInit(options: SwarmInitOptions): Promise<DockerodeSwarmInitResponse> {
        return this.runEngine(this.engine.swarmCluster.init(options));
    }

    /**
     * Join an existing Swarm cluster (POST /swarm/join) using a join token.
     */
    async swarmJoin(options: SwarmJoinOptions): Promise<void> {
        await this.runEngine(this.engine.swarmCluster.join(options));
    }

    /**
     * Leave the Swarm cluster (POST /swarm/leave). `force` leaves even as a
     * manager (last resort for decommissioning).
     */
    async swarmLeave(force = false): Promise<void> {
        await this.runEngine(this.engine.swarmCluster.leave(force));
    }

    /**
     * List all swarm services (GET /services).
     */
    async listSwarmServices(): Promise<DockerodeServiceSummary[]> {
        return this.runEngine(this.engine.swarmServices.list());
    }

    /**
     * Inspect a swarm service by id or name (GET /services/{id}).
     */
    async inspectSwarmService(serviceIdOrName: string): Promise<DockerodeServiceSummary> {
        return this.runEngine(this.engine.swarmServices.inspect(serviceIdOrName));
    }

    /**
     * Create a swarm service from a dockerode spec (POST /services/create).
     */
    async createSwarmService(spec: Docker.ServiceSpec): Promise<DockerodeServiceSummary> {
        return this.runEngine(this.engine.swarmServices.create(spec));
    }

    /**
     * Update a swarm service (POST /services/{id}/update?version=N[&rollback=true]).
     * `version` must match the service's current Version.Index (from inspect).
     *
     * Note: The Docker API update endpoint returns `{ Warnings: [...] }` or `{}`,
     * NOT a full service summary. Callers needing the updated state should call
     * `inspectSwarmService` after this completes.
     */
    async updateSwarmService(
        serviceIdOrName: string,
        version: number,
        spec: Docker.ServiceSpec,
        rollback = false,
    ): Promise<void> {
        await this.runEngine(this.engine.swarmServices.update(serviceIdOrName, version, spec, rollback));
    }

    /**
     * Remove a swarm service (DELETE /services/{id}). Gracefully drains tasks.
     */
    async removeSwarmService(serviceIdOrName: string): Promise<void> {
        await this.runEngine(this.engine.swarmServices.remove(serviceIdOrName));
    }

    /**
     * Scale a swarm service (POST /services/{id}/update?version=N) by
     * overriding `Mode.Replicated.Replicas`. The loose engine spec stays
     * INSIDE this boundary — callers only pass a service name + target count.
     */
    async scaleSwarmService(serviceIdOrName: string, replicas: number): Promise<void> {
        await this.runEngine(this.engine.swarmServices.scale(serviceIdOrName, replicas));
    }

    /**
     * Roll back a swarm service (POST /services/{id}/update?version=N&rollback=true).
     * The engine re-applies the service's `RollbackConfig` target (previous
     * good spec). The loose engine spec stays inside this boundary.
     */
    async rollbackSwarmService(serviceIdOrName: string): Promise<void> {
        await this.runEngine(this.engine.swarmServices.rollback(serviceIdOrName));
    }

    /**
     * Tail the logs of a swarm service's tasks (GET /services/{id}/logs).
     *
     * The service-level endpoint aggregates every task's output, which is what
     * supervision and setup diagnostics need: a service has no single
     * container, so there is no container id to read. Returns "" when the
     * engine reports no logs yet instead of throwing — log replay is a
     * convenience, never a gate.
     */
    async getSwarmServiceLogs(
        serviceIdOrName: string,
        options: Docker.ContainerLogsOptions = { stdout: true, stderr: true, tail: 200 },
    ): Promise<string> {
        return Effect.runPromise(this.engine.swarmServices.logs(serviceIdOrName, options));
    }

    /**
     * List the tasks of a service (GET /services/{id}/tasks).
     */
    async listSwarmServiceTasks(serviceIdOrName: string): Promise<DockerodeTaskSummary[]> {
        return this.runEngine(this.engine.swarmServices.listTasks(serviceIdOrName));
    }

    /**
     * List ALL swarm tasks cluster-wide (GET /tasks), optionally filtered by
     * service and/or node. Used by fleet aggregation (`SwarmFleetService`) to
     * answer per-service / per-node task queries without N+1 service calls.
     */
    async listAllSwarmTasks(filter?: { serviceId?: string; nodeId?: string }): Promise<DockerodeTaskSummary[]> {
        return this.runEngine(this.engine.swarmServices.listAllTasks(filter));
    }

    /**
     * List engine images (GET /images/json) for the connected node.
     * Used by the per-node resources aggregation (local scope only).
     */
    async listEngineImages(): Promise<DockerodeImageSummary[]> {
        return this.runEngine(this.engine.images.list());
    }

    /**
     * List engine networks (GET /networks) for the connected node — includes
     * swarm overlay networks from a manager.
     */
    async listEngineNetworks(): Promise<DockerodeNetworkSummary[]> {
        return this.runEngine(this.engine.networks.list());
    }

    /**
     * List engine volumes (GET /volumes) for the connected node.
     */
    async listEngineVolumes(): Promise<DockerodeVolumeListResponse["Volumes"]> {
        return this.runEngine(this.engine.volumes.list());
    }





    /**
     * List all swarm nodes (GET /nodes).
     */
    async listSwarmNodes(): Promise<DockerodeNodeSummary[]> {
        return this.runEngine(this.engine.swarmNodes.list());
    }

    /**
     * Inspect a swarm node (GET /nodes/{id}).
     */
    async inspectSwarmNode(nodeId: string): Promise<DockerodeNodeSummary> {
        return this.runEngine(this.engine.swarmNodes.inspect(nodeId));
    }

    /**
     * Update a swarm node's labels (POST /nodes/{id}/update?version=N).
     * Used for placement metadata: `deployer.ingress`, `deployer.tenant.*`,
     * `deployer.node.role`, regions, etc.
     *
     * `labels` is the COMPLETE desired map and replaces the node's own — see
     * `buildSwarmNodeSpecPayload` for why merging is wrong here.
     */
    async updateSwarmNodeLabels(
        nodeId: string,
        version: number,
        labels: Record<string, string>,
    ): Promise<void> {
        await this.runEngine(this.engine.swarmNodes.updateLabels(nodeId, version, labels));
    }

    /**
     * Update a swarm node's role and/or availability (POST /nodes/{id}/update).
     *
     * Labels are NOT touched: with no `labels` key the payload inherits the
     * node's current map, so a role change cannot silently drop a label that a
     * different writer set.
     */
    async updateSwarmNodeRoleAvailability(
        nodeId: string,
        version: number,
        change: Pick<SwarmNodeSpecChange, "role" | "availability">,
    ): Promise<void> {
        await this.runEngine(this.engine.swarmNodes.updateRoleAvailability(nodeId, version, change));
    }


    /**
     * Create a swarm secret (POST /secrets/create). Data is base64-encoded
     * for the engine (the engine never returns it in list/inspect).
     */
    async createSwarmSecret(options: {
        name: string;
        data: string;
        labels?: Record<string, string>;
    }): Promise<DockerodeSecretSummary> {
        return this.runEngine(this.engine.swarmSecrets.create(options));
    }

    /**
     * List swarm secrets (GET /secrets).
     */
    async listSwarmSecrets(): Promise<DockerodeSecretSummary[]> {
        return this.runEngine(this.engine.swarmSecrets.list());
    }

    /**
     * Create a swarm config (POST /configs/create). Data is base64-encoded.
     */
    async createSwarmConfig(options: {
        name: string;
        data: string;
        labels?: Record<string, string>;
    }): Promise<DockerodeConfigSummary> {
        return this.runEngine(this.engine.swarmConfigs.create(options));
    }

    /**
     * List swarm configs (GET /configs).
     */
    async listSwarmConfigs(): Promise<DockerodeConfigSummary[]> {
        return this.runEngine(this.engine.swarmConfigs.list());
    }

    private static readonly VXLAN_ID_OPTION = "com.docker.network.driver.overlay.vxlanid_list";

    /**
     * Rebuild an overlay whose VXLAN datapath the engine can no longer join, on a
     * VNI it has not poisoned.
     *
     * The engine can keep a stale vxlan device for a VNI (`error creating vxlan
     * interface: file exists`) in a namespace nothing but a daemon restart clears.
     * Every join on that VNI then times out, whoever asks. The VNI is the poisoned
     * part, not the name or the subnet, so the repair that needs no host access is
     * to recreate the network on another one.
     *
     * Services attached to the network are REMOVED first (a network in use cannot
     * be removed); the caller re-creates what it owns, which its own ensure-style
     * methods already do idempotently. `detachContainerIds` are force-disconnected
     * for the same reason. Any other endpoint still holding the network makes the
     * removal fail with the engine's own message rather than being evicted.
     */
    async recreateOverlayNetwork(
        request: SwarmOverlayNetworkRequest,
        options: { detachContainerIds?: string[]; avoidVxlanIds?: number[] } = {},
    ): Promise<{ vxlanId: number; avoidedVxlanIds: number[]; removedServices: string[] }> {
        return this.runEngine(this.engine.networks.recreateOverlay(request, options));
    }



    /**
     * Idempotently ensure an overlay network exists (create once, reuse by
     * name). Concurrent creation is tolerated: a 409 race resolves by
     * re-inspecting the network name.
     *
     * IMPORTANT (layering): this is used ONLY for Deployer-OWNED workload
     * networks (per-project overlays for scheduled services). If a network
     * with the target name already exists it must be a compatible OVERLAY —
     * reusing an incompatible non-overlay network (e.g. a compose-created
     * BRIDGE) that happens to share a name would silently break swarm
     * scheduling (Docker rejects bridge networks on services with HTTP 403),
     * the exact failure that this guard prevents.
     */
    async ensureOverlayNetwork(request: SwarmOverlayNetworkRequest): Promise<void> {
        await this.runEngine(this.engine.networks.ensureOverlay(request));
    }
}

// Stronger create container options combining dockerode types with our custom fields
export type CreateContainerOptions = {
    // backward compatibility: allow lowercase 'image' property
    image?: string;
    imagePullPolicy?: "IfNotPresent" | "Always" | "Never";
    registryAuth?: Docker.AuthConfig;
} & Docker.ContainerCreateOptions
