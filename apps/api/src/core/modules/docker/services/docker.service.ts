import { Injectable, Logger } from "@nestjs/common";
import Docker from "dockerode";
import * as fs from "fs";
import * as path from "path";
import { PassThrough } from "stream";
import { Observable } from "rxjs";
import { EnvService } from "@/config/env/env.service";


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

@Injectable()
export class DockerService {
    private readonly logger = new Logger(DockerService.name);
    private readonly docker: Docker;
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

    private static getDockerErrMsg(err: unknown): string {
        if (err instanceof Error) return err.message;
        if (typeof err === "object" && err !== null) {
            if ("json" in err) {
                const json = err.json;
                if (typeof json === "object" && json !== null && "message" in json) {
                    const msg = json.message;
                    if (typeof msg === "string") return msg;
                }
            }
            if ("message" in err) {
                const msg = err.message;
                if (typeof msg === "string") return msg;
            }
        }
        return String(err);
    }

    private isReadWriteStream(val: unknown): val is NodeJS.ReadWriteStream {
        return typeof val === "object" && val !== null && "pipe" in val && "write" in val && "end" in val && "read" in val;
    }

    private isReadableStream(val: unknown): val is NodeJS.ReadableStream {
        return typeof val === "object" && val !== null && "pipe" in val && "read" in val && "on" in val;
    }

    private isBufferLike(val: unknown): val is Buffer | Uint8Array {
        return Buffer.isBuffer(val) || val instanceof Uint8Array;
    }

    private extractExecOutputPayload(raw: unknown): string | null {
        if (typeof raw === "string") {
            return raw;
        }

        if (this.isBufferLike(raw)) {
            return Buffer.from(raw).toString("utf8");
        }

        if (typeof raw !== "object" || raw === null) {
            return null;
        }

        const record = isRecord(raw) ? raw : {};
        const outputCandidate = record.output;

        if (typeof outputCandidate === "string") {
            return outputCandidate;
        }

        if (this.isBufferLike(outputCandidate)) {
            return Buffer.from(outputCandidate).toString("utf8");
        }

        const stdoutCandidate = record.stdout;
        const stderrCandidate = record.stderr;

        const stdout = typeof stdoutCandidate === "string"
            ? stdoutCandidate
            : this.isBufferLike(stdoutCandidate)
                ? Buffer.from(stdoutCandidate).toString("utf8")
                : "";

        const stderr = typeof stderrCandidate === "string"
            ? stderrCandidate
            : this.isBufferLike(stderrCandidate)
                ? Buffer.from(stderrCandidate).toString("utf8")
                : "";

        const combined = `${stdout}${stderr}`;
        return combined.length > 0 ? combined : null;
    }

    private decodeContainerLogsPayload(raw: Buffer): string {
        const demultiplexed = this.tryDemultiplexDockerStream(raw);
        if (demultiplexed) {
            return demultiplexed.toString("utf8");
        }

        return raw.toString("utf8");
    }

    private tryDemultiplexDockerStream(raw: Buffer): Buffer | null {
        if (raw.length < 8) {
            return null;
        }

        const frames: Buffer[] = [];
        let offset = 0;

        while (offset + 8 <= raw.length) {
            const streamType = raw[offset];
            // Docker multiplexed stream types: 0=stdin, 1=stdout, 2=stderr
            if (streamType !== 0 && streamType !== 1 && streamType !== 2) {
                return null;
            }

            const frameLength = raw.readUInt32BE(offset + 4);
            const payloadStart = offset + 8;
            const payloadEnd = payloadStart + frameLength;

            if (payloadEnd > raw.length) {
                return null;
            }

            frames.push(raw.subarray(payloadStart, payloadEnd));
            offset = payloadEnd;
        }

        if (offset !== raw.length || frames.length === 0) {
            return null;
        }

        return Buffer.concat(frames);
    }

    private resolveDockerClientConfig(
        dockerHost: unknown,
        dockerPort: unknown,
    ): { client: Docker; mode: string; socketPath?: string } {
        const hasMountedSocket = fs.existsSync(DockerService.DEFAULT_DOCKER_SOCKET_PATH);
        const parsedEnvPort = typeof dockerPort === "number" ? dockerPort : undefined;
        const hostRaw = typeof dockerHost === "string" ? dockerHost.trim() : "";

        if (hostRaw.length > 0) {
            if (hostRaw.startsWith("unix://")) {
                const socketPath = hostRaw.slice("unix://".length);
                return {
                    client: new Docker({ socketPath }),
                    mode: `DOCKER_HOST unix socket (${socketPath})`,
                    socketPath,
                };
            }

            if (hostRaw.startsWith("/")) {
                return {
                    client: new Docker({ socketPath: hostRaw }),
                    mode: `DOCKER_HOST socket path (${hostRaw})`,
                    socketPath: hostRaw,
                };
            }

            if (
                (hostRaw === "localhost" || hostRaw === "127.0.0.1" || hostRaw === "::1")
                && parsedEnvPort === undefined
                && hasMountedSocket
            ) {
                this.logger.warn(
                    `DOCKER_HOST=${hostRaw} has no DOCKER_PORT. Falling back to mounted Docker socket at ${DockerService.DEFAULT_DOCKER_SOCKET_PATH}.`,
                );
                return {
                    client: new Docker({ socketPath: DockerService.DEFAULT_DOCKER_SOCKET_PATH }),
                    mode: "mounted Docker socket fallback",
                    socketPath: DockerService.DEFAULT_DOCKER_SOCKET_PATH,
                };
            }

            if (
                hostRaw.startsWith("tcp://")
                || hostRaw.startsWith("http://")
                || hostRaw.startsWith("https://")
            ) {
                const normalized = hostRaw.startsWith("tcp://")
                    ? `http://${hostRaw.slice("tcp://".length)}`
                    : hostRaw;

                const parsedUrl = new URL(normalized);
                const resolvedPort =
                    parsedEnvPort
                    ?? (parsedUrl.port.length > 0 ? Number(parsedUrl.port) : undefined);

                if (
                    (parsedUrl.hostname === "localhost"
                        || parsedUrl.hostname === "127.0.0.1"
                        || parsedUrl.hostname === "::1")
                    && resolvedPort === undefined
                    && hasMountedSocket
                ) {
                    this.logger.warn(
                        `DOCKER_HOST=${hostRaw} points to localhost without port. Falling back to mounted Docker socket at ${DockerService.DEFAULT_DOCKER_SOCKET_PATH}.`,
                    );
                    return {
                        client: new Docker({ socketPath: DockerService.DEFAULT_DOCKER_SOCKET_PATH }),
                        mode: "mounted Docker socket fallback",
                        socketPath: DockerService.DEFAULT_DOCKER_SOCKET_PATH,
                    };
                }

                return {
                    client: new Docker({
                        host: parsedUrl.hostname,
                        port: resolvedPort,
                        protocol: parsedUrl.protocol === "https:" ? "https" : "http",
                    }),
                    mode: `DOCKER_HOST URL (${hostRaw})`,
                    // No socket path when using TCP
                };
            }

            return {
                client: new Docker({
                    host: hostRaw,
                    port: parsedEnvPort,
                }),
                mode: `DOCKER_HOST host (${hostRaw})`,
                // No socket path when using TCP
            };
        }

        if (hasMountedSocket) {
            return {
                client: new Docker({ socketPath: DockerService.DEFAULT_DOCKER_SOCKET_PATH }),
                mode: "mounted Docker socket",
                socketPath: DockerService.DEFAULT_DOCKER_SOCKET_PATH,
            };
        }

        return {
            client: new Docker(),
            mode: "dockerode default connection",
            // No socket path when using default dockerode connection (TCP)
        };
    }

    constructor(private readonly envService: EnvService) {
        const dockerHost = this.envService.get("DOCKER_HOST");
        const dockerPort = this.envService.get("DOCKER_PORT");

        const { client, mode, socketPath } = this.resolveDockerClientConfig(dockerHost, dockerPort);
        this.docker = client;
        this.resolvedSocketPath = socketPath ?? null;

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
    /**
     * Test Docker connection and log connection status
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.docker.ping();
            this.logger.log("Docker connection successful");
            return true;
        } catch (error) {
            this.logger.error("Docker connection failed:", error);
            return false;
        }
    }
    async buildImage(
        sourcePath: string,
        imageTag: string,
        options?: {
            dockerfileName?: string;
            autoCreateDockerfile?: boolean;
        },
    ): Promise<void> {
        this.logger.log(`Building image ${imageTag} from ${sourcePath}`);
        const dockerfileName = options?.dockerfileName ?? "Dockerfile";
        const autoCreateDockerfile = options?.autoCreateDockerfile ?? true;
        // Check if Dockerfile exists
        const dockerfilePath = path.join(sourcePath, dockerfileName);
        if (autoCreateDockerfile && !fs.existsSync(dockerfilePath)) {
            // Create a basic Dockerfile if none exists
            const basicDockerfile = `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
      `.trim();
            fs.writeFileSync(dockerfilePath, basicDockerfile);
        }
        const stream = await this.docker.buildImage(
            {
                context: sourcePath,
                src: ["."],
            },
            {
                t: imageTag,
                dockerfile: dockerfileName,
            }
        );
        await this.followStream(stream);
        this.logger.log(`Image ${imageTag} built successfully`);
    }
    async createAndStartContainer(options: {
        image: string;
        name: string;
        deploymentId: string;
        serviceId?: string;
        projectId?: string;
        envVars?: Record<string, string>;
        ports?: Record<string, string>;
        imagePullPolicy?: "IfNotPresent" | "Always" | "Never";
        registryAuth?: Docker.AuthConfig;
    }): Promise<string> {
        const {
            image,
            name,
            deploymentId,
            serviceId,
            projectId,
            envVars = {},
            ports = {},
            imagePullPolicy = "IfNotPresent",
            registryAuth,
        } = options;
        this.logger.log(`Creating container ${name} from image ${image} (policy=${imagePullPolicy})`);
        // Convert environment variables to Docker format
        const env = Object.entries(envVars).map(([key, value]) => `${key}=${value}`);
        // Convert port mappings
        const exposedPorts: Record<string, object> = {};
        const portBindings: Record<
            string,
            {
                HostPort: string;
            }[]
        > = {};
        Object.entries(ports).forEach(([containerPort, hostPort]) => {
            exposedPorts[`${containerPort}/tcp`] = {};
            portBindings[`${containerPort}/tcp`] = [{ HostPort: hostPort }];
        });

        // Helper to attempt container creation
        const attemptCreate = async (imgToUse: string) => {
            const container = await this.docker.createContainer({
                Image: imgToUse,
                name,
                Env: env,
                ExposedPorts: exposedPorts,
                HostConfig: {
                    PortBindings: portBindings,
                    RestartPolicy: {
                        Name: "unless-stopped",
                    },
                },
                Labels: {
                    "deployer.deployment_id": deploymentId,
                    "deployer.managed": "true",
                    "deployer.managed_by": "deployment_service",
                    "deployer.managed_reason": "deployment_execution",
                    ...(serviceId
                        ? {
                              "deployer.service_id": serviceId,
                          }
                        : {}),
                    ...(projectId
                        ? {
                              "deployer.project_id": projectId,
                          }
                        : {}),
                },
            });
            await container.start();
            const containerInfo = await container.inspect();
            return containerInfo.Id;
        };

        // Pre-pull or inspect based on policy
        const shouldAttemptPull = async (img: string): Promise<boolean> => {
            if (imagePullPolicy === "Always") return true;
            if (imagePullPolicy === "Never") return false;
            // IfNotPresent -> check local presence
            try {
                const existing = this.docker.getImage(img);
                await existing.inspect();
                this.logger.log(`Image ${img} already present locally`);
                return false;
            } catch {
                return true;
            }
        };

        try {
            // If policy says we should pull (Always) or image absent (IfNotPresent), try pulling first
            if (await shouldAttemptPull(image)) {
                try {
                    await this.pullImage(image, registryAuth);
                } catch (pullErr) {
                    this.logger.warn(`Initial pull failed for ${image}: ${DockerService.getErrMsg(pullErr)}`);
                    // If pull fails and policy is Never, rethrow. If policy allowed, we'll attempt fallbacks below.
                }
            }
            return await attemptCreate(image);
        } catch (error) {
            const errMsg = DockerService.getDockerErrMsg(error).toLowerCase();
            if (errMsg.includes("no such image") || errMsg.includes("not found") || errMsg.includes("manifest unknown")) {
                this.logger.warn(`Image ${image} not found locally after pre-pull. Attempting fallback pulls...`);
                const imagesToTry = [image];
                if (image === "nginx:alpine") {
                    imagesToTry.push("nginx:latest", "nginx:stable-alpine");
                }
                let lastPullErrMsg: string | null = null;
                for (const img of imagesToTry) {
                    try {
                        // Only attempt pull if policy permits
                        if (imagePullPolicy !== "Never") {
                            await this.pullImage(img, registryAuth);
                        } else {
                            this.logger.warn(`ImagePullPolicy set to 'Never' - skipping pull for ${img}`);
                            continue;
                        }
                        this.logger.log(`Successfully pulled image ${img}. Retrying container creation...`);
                        return await attemptCreate(img);
                    } catch (pullErr) {
                        lastPullErrMsg = DockerService.getErrMsg(pullErr);
                        this.logger.warn(`Pulling image ${img} failed: ${lastPullErrMsg}`);
                    }
                }
                this.logger.error(`All attempts to pull image ${image} and fallbacks failed`);
                throw new Error(`Failed to pull image ${image}: ${lastPullErrMsg ?? "unknown error"}`);
            }

            // Unknown error - rethrow
            this.logger.error(`Failed to create container ${name}:`, error);
            throw error;
        }
    }
    async stopContainersByDeployment(deploymentId: string): Promise<void> {
        this.logger.log(`Stopping containers for deployment ${deploymentId}`);
        const containers = await this.docker.listContainers({
            all: true,
            filters: {
                label: [`deployer.deployment_id=${deploymentId}`],
            },
        });
        for (const containerInfo of containers) {
            const container = this.docker.getContainer(containerInfo.Id);
            if (containerInfo.State === "running") {
                await container.stop({ t: 10 }); // 10 second timeout
                this.logger.log(`Stopped container ${containerInfo.Names[0] ?? containerInfo.Id}`);
            }
        }
    }
    async startContainersByDeployment(deploymentId: string): Promise<void> {
        this.logger.log(`Starting containers for deployment ${deploymentId}`);
        const containers = await this.docker.listContainers({
            all: true,
            filters: {
                label: [`deployer.deployment_id=${deploymentId}`],
            },
        });
        for (const containerInfo of containers) {
            const container = this.docker.getContainer(containerInfo.Id);
            if (containerInfo.State !== "running") {
                await container.start();
                this.logger.log(`Started container ${containerInfo.Names[0] ?? containerInfo.Id}`);
            }
        }
    }
    async listContainersByDeployment(deploymentId: string): Promise<
        {
            id: string;
            name: string;
            status: string;
        }[]
    > {
        this.logger.log(`Listing containers for deployment ${deploymentId}`);
        const containers = await this.docker.listContainers({
            all: true,
            filters: {
                label: [`deployer.deployment_id=${deploymentId}`],
            },
        });
        return containers.map((containerInfo) => ({
            id: containerInfo.Id,
            name: containerInfo.Names[0] ?? "unknown",
            status: containerInfo.State,
        }));
    }
    async checkContainerHealth(containerId: string): Promise<boolean> {
        try {
            const container = this.docker.getContainer(containerId);
            const containerInfo = await container.inspect();
            // Check if container is running
            if (containerInfo.State.Status !== "running") {
                return false;
            }
            // If health check is configured, use it
            if (containerInfo.State.Health) {
                return containerInfo.State.Health.Status === "healthy";
            }
            // Otherwise, just check if it's running
            return true;
        } catch (error) {
            this.logger.error(`Failed to check health for container ${containerId}:`, error);
            return false;
        }
    }

    async getDetailedContainerHealth(containerId: string): Promise<{
        isHealthy: boolean;
        status: string;
        uptime: number;
        restartCount: number;
        lastStarted: Date | null;
        healthChecks?: {
            status: string;
            failingStreak: number;
            log: {
                start: string;
                end: string;
                exitCode: number;
                output: string;
            }[];
        };
        resources: {
            cpuUsage?: number;
            memoryUsage?: number;
            memoryLimit?: number;
        };
    }> {
        try {
            const container = this.docker.getContainer(containerId);
            const containerInfo = await container.inspect();

            // Get container stats for resource usage
            let resources: { cpuUsage?: number; memoryUsage?: number; memoryLimit?: number } = {};
            try {
                const stats = await container.stats({ stream: false });
                const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
                const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
                const cpuUsage = cpuDelta > 0 && systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;

                resources = {
                    cpuUsage: Math.round(cpuUsage * 100) / 100,
                    memoryUsage: stats.memory_stats.usage,
                    memoryLimit: stats.memory_stats.limit,
                };
            } catch (statsError) {
                this.logger.warn(`Could not get stats for container ${containerId}:`, statsError);
            }

            const uptime = containerInfo.State.StartedAt ? Date.now() - new Date(containerInfo.State.StartedAt).getTime() : 0;

            interface HealthCheckLogEntry {
                start: string;
                end: string;
                exitCode: number;
                output: string;
            }
            interface DetailedHealth {
                isHealthy: boolean;
                status: string;
                uptime: number;
                restartCount: number;
                lastStarted: Date | null;
                resources: { cpuUsage?: number; memoryUsage?: number; memoryLimit?: number };
                healthChecks?: {
                    status: string;
                    failingStreak: number;
                    log: HealthCheckLogEntry[];
                };
            }

            const result: DetailedHealth = {
                isHealthy: containerInfo.State.Status === "running",
                status: containerInfo.State.Status,
                uptime: Math.floor(uptime / 1000), // in seconds
                restartCount: containerInfo.RestartCount || 0,
                lastStarted: containerInfo.State.StartedAt ? new Date(containerInfo.State.StartedAt) : null,
                resources,
            };

            // Add health check details if available
            if (containerInfo.State.Health) {
                // Docker's health log entries use capitalized keys (Start, End, ExitCode, Output)
                // Normalize them to the shape our callers expect: { start, end, exitCode, output }
                const rawLog = containerInfo.State.Health.Log;
                const normalizedLog: HealthCheckLogEntry[] = rawLog.slice(-5).map((entry) => ({
                    start: entry.Start,
                    end: entry.End,
                    exitCode: entry.ExitCode,
                    output: entry.Output,
                }));
                result.healthChecks = {
                    status: containerInfo.State.Health.Status,
                    failingStreak: containerInfo.State.Health.FailingStreak || 0,
                    log: normalizedLog,
                };
            }

            return result;
        } catch (error) {
            this.logger.error(`Failed to get detailed health for container ${containerId}:`, error);
            return {
                isHealthy: false,
                status: "unknown",
                uptime: 0,
                restartCount: 0,
                lastStarted: null,
                resources: {},
            };
        }
    }

    async monitorContainersByDeployment(deploymentId: string): Promise<
        {
            containerId: string;
            containerName: string;
            health: Awaited<ReturnType<DockerService["getDetailedContainerHealth"]>>;
        }[]
    > {
        try {
            const containers = await this.listContainersByDeployment(deploymentId);
            const results: {
                containerId: string;
                containerName: string;
                health: Awaited<ReturnType<DockerService["getDetailedContainerHealth"]>>;
            }[] = [];

            for (const container of containers) {
                const health = await this.getDetailedContainerHealth(container.id);
                results.push({
                    containerId: container.id,
                    containerName: container.name,
                    health,
                });
            }

            return results;
        } catch (error) {
            this.logger.error(`Failed to monitor containers for deployment ${deploymentId}:`, error);
            return [];
        }
    }

    async performHealthCheck(
        containerId: string,
        healthCheckUrl?: string,
        timeout = 30000
    ): Promise<{
        isHealthy: boolean;
        httpStatus?: number;
        responseTime?: number;
        error?: string;
        containerHealth: Awaited<ReturnType<DockerService["getDetailedContainerHealth"]>>;
    }> {
        const containerHealth = await this.getDetailedContainerHealth(containerId);

        const result = {
            isHealthy: containerHealth.isHealthy,
            containerHealth,
        };

        // If HTTP health check URL is provided, test it
        if (healthCheckUrl && containerHealth.isHealthy) {
            try {
                const startTime = Date.now();
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    controller.abort();
                }, timeout);

                const response = await fetch(healthCheckUrl, {
                    signal: controller.signal,
                    method: "GET",
                    headers: {
                        "User-Agent": "Deployer-HealthCheck/1.0",
                    },
                });

                clearTimeout(timeoutId);
                const responseTime = Date.now() - startTime;

                return {
                    ...result,
                    isHealthy: response.ok && containerHealth.isHealthy,
                    httpStatus: response.status,
                    responseTime,
                };
            } catch (error) {
                return {
                    ...result,
                    isHealthy: false,
                    error: error instanceof Error ? error.message : "Unknown error",
                };
            }
        }

        return result;
    }

    async waitForContainerHealth(containerId: string, maxRetries = 30, retryInterval = 2000, healthCheckUrl?: string): Promise<boolean> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            this.logger.debug(`Health check attempt ${String(attempt)}/${String(maxRetries)} for container ${containerId}`);

            const healthResult = await this.performHealthCheck(containerId, healthCheckUrl);

            if (healthResult.isHealthy) {
                this.logger.log(`Container ${containerId} is healthy after ${String(attempt)} attempts`);
                return true;
            }

            if (attempt < maxRetries) {
                this.logger.debug(`Container ${containerId} not healthy yet, waiting ${String(retryInterval)}ms...`);
                await new Promise((resolve) => setTimeout(resolve, retryInterval));
            }
        }

        this.logger.error(`Container ${containerId} failed health check after ${String(maxRetries)} attempts`);
        return false;
    }

    async restartContainer(containerId: string): Promise<void> {
        try {
            const container = this.docker.getContainer(containerId);
            await container.restart();
            this.logger.log(`Container ${containerId} restarted successfully`);
        } catch (error) {
            this.logger.error(`Failed to restart container ${containerId}:`, error);
            throw error;
        }
    }

    async pauseContainer(containerIdOrName: string): Promise<void> {
        try {
            const container = this.docker.getContainer(containerIdOrName);
            await container.pause();
            this.logger.log(`Paused container ${containerIdOrName}`);
        } catch (error) {
            const errorMessage = DockerService.getDockerErrMsg(error).toLowerCase();
            if (errorMessage.includes("already paused")) {
                this.logger.log(`Container ${containerIdOrName} already paused`);
                return;
            }

            this.logger.error(`Failed to pause container ${containerIdOrName}:`, error);
            throw error;
        }
    }

    async unpauseContainer(containerIdOrName: string): Promise<void> {
        try {
            const container = this.docker.getContainer(containerIdOrName);
            await container.unpause();
            this.logger.log(`Unpaused container ${containerIdOrName}`);
        } catch (error) {
            const errorMessage = DockerService.getDockerErrMsg(error).toLowerCase();
            if (errorMessage.includes("is not paused") || errorMessage.includes("not paused")) {
                this.logger.log(`Container ${containerIdOrName} already unpaused`);
                return;
            }

            this.logger.error(`Failed to unpause container ${containerIdOrName}:`, error);
            throw error;
        }
    }

    async killContainer(containerIdOrName: string): Promise<void> {
        try {
            const container = this.docker.getContainer(containerIdOrName);
            await container.kill();
            this.logger.log(`Killed container ${containerIdOrName}`);
        } catch (error) {
            const errorMessage = DockerService.getDockerErrMsg(error).toLowerCase();
            if (errorMessage.includes("is not running") || errorMessage.includes("not running")) {
                this.logger.log(`Container ${containerIdOrName} already stopped`);
                return;
            }

            this.logger.error(`Failed to kill container ${containerIdOrName}:`, error);
            throw error;
        }
    }

    async removeContainer(containerId: string): Promise<void> {
        try {
            const container = this.docker.getContainer(containerId);
            // Stop if running
            const containerInfo = await container.inspect();
            if (containerInfo.State.Status === "running") {
                await container.stop({ t: 10 });
            }
            // Remove container
            await container.remove({ force: true, v: true });
            this.logger.log(`Removed container ${containerId}`);
        } catch (error) {
            // Ignore "container not found" errors
            if (error instanceof Error && (error.message.includes("no such container") || error.message.includes("404"))) {
                this.logger.log(`Container ${containerId} already removed or not found`);
                return;
            }
            this.logger.error(`Failed to remove container ${containerId}:`, error);
        }
    }
    async removeImage(imageTag: string): Promise<void> {
        try {
            const image = this.docker.getImage(imageTag);
            await image.remove({ force: true });
            this.logger.log(`Removed image ${imageTag}`);
        } catch (error) {
            this.logger.error(`Failed to remove image ${imageTag}:`, error);
        }
    }
    async createContainer(options: CreateContainerOptions): Promise<Docker.Container> {
        const requestedImage = options.Image;
        const imagePullPolicy: "IfNotPresent" | "Always" | "Never" = options.imagePullPolicy ?? "IfNotPresent";
        const registryAuth = options.registryAuth;
        // Ensure image exists locally; if not attempt pull first depending on policy
        if (requestedImage) {
            try {
                const img = this.docker.getImage(requestedImage);
                await img.inspect();
                this.logger.log(`Image ${requestedImage} exists locally`);
            } catch (inspectErr) {
                this.logger.debug(`Image inspect failed for ${requestedImage}: ${DockerService.getErrMsg(inspectErr)}`);
                if (imagePullPolicy === "Never") {
                    this.logger.warn(`Image ${requestedImage} not present locally and policy is 'Never' - refusing to pull`);
                    throw new Error(`Image ${requestedImage} not present locally and imagePullPolicy is 'Never'`);
                }
                this.logger.warn(`Image ${requestedImage} not present locally. Will attempt to pull before creating container (policy=${imagePullPolicy}).`);
                const imagesToTry = [requestedImage];
                if (requestedImage === "nginx:alpine") {
                    imagesToTry.push("nginx:latest", "nginx:stable-alpine");
                }
                let pulled = false;
                let lastPullErrMsg: string | null = null;
                for (const imgName of imagesToTry) {
                    try {
                        this.logger.log(`Pulling image prior to create: ${imgName}`);
                        await this.pullImage(imgName, registryAuth);
                        pulled = true;
                        if (imgName !== requestedImage) {
                            options.image = imgName;
                        }
                        break;
                    } catch (pullErr) {
                        lastPullErrMsg = DockerService.getErrMsg(pullErr);
                        this.logger.warn(`Pulling image ${imgName} failed: ${lastPullErrMsg}`);
                    }
                }
                if (!pulled) {
                    this.logger.error(`Failed to pull requested image ${requestedImage} and fallbacks. Last error: ${lastPullErrMsg ?? "unknown error"}`);
                    throw new Error(`Image ${requestedImage} missing and pull failed: ${lastPullErrMsg ?? "unknown error"}`);
                }
            }
        }

        try {
            const container = await this.docker.createContainer(options);
            this.logger.log(`Created container ${container.id}`);
            return container;
        } catch (error: unknown) {
            const errMsg = DockerService.getDockerErrMsg(error);
            this.logger.error("Failed to create container:", errMsg);
            // Detect image-not-found errors and attempt pull+retry
            const errMsgLower = errMsg.toLowerCase();
            if (errMsgLower.includes("no such image") || errMsgLower.includes("not found") || errMsgLower.includes("manifest unknown")) {
                if (!requestedImage) {
                    throw new Error("Cannot create container: no image specified");
                }
                const imagesToTry: string[] = [requestedImage];
                if (requestedImage === "nginx:alpine") {
                    imagesToTry.push("nginx:latest", "nginx:stable-alpine");
                }
                let lastErrMsg: string | null = null;
                for (const img of imagesToTry) {
                    try {
                        this.logger.log(`Pulling image for container creation (retry path): ${img}`);
                        if (imagePullPolicy !== "Never") {
                            await this.pullImage(img, registryAuth);
                        } else {
                            this.logger.warn(`ImagePullPolicy set to 'Never' - skipping pull for ${img}`);
                            continue;
                        }
                        this.logger.log(`Retrying container create after pulling ${img}...`);
                        const retryOptions = { ...options, Image: img };
                        const container = await this.docker.createContainer(retryOptions);
                        this.logger.log(`Created container ${container.id} with image ${img}`);
                        return container;
                    } catch (pullErr) {
                        lastErrMsg = DockerService.getErrMsg(pullErr);
                        this.logger.warn(`Pull or retry create failed for ${img}: ${lastErrMsg}`);
                    }
                }
                this.logger.error(`Failed to pull any images for container creation. Last error: ${lastErrMsg ?? "unknown error"}`);
                throw new Error(`Failed to create container: image ${requestedImage} not available and pull attempts failed. Last error: ${lastErrMsg ?? "unknown error"}`);
            }
            throw error;
        }
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
        this.logger.log(`Attempting to pull image ${image} (retries=${String(retries)})`);
        let lastErrMsg: string | null = null;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const pullOpts: Record<string, unknown> = {};
                if (registryAuth) {
                    pullOpts.authconfig = registryAuth;
                }
                const stream: NodeJS.ReadableStream = await this.docker.pull(image, pullOpts);
                await this.followStream(stream, onProgressLine);
                // Successful pull
                this.logger.log(`Successfully pulled ${image} on attempt ${String(attempt)}`);
                return;
            } catch (err) {
                lastErrMsg = DockerService.getErrMsg(err);
                this.logger.warn(`Pull attempt ${String(attempt)} failed for ${image}: ${lastErrMsg}`);
                if (attempt < retries) {
                    this.logger.log(`Waiting ${String(backoffMs)}ms before next pull attempt...`);
                    await new Promise((r) => setTimeout(r, backoffMs));
                    backoffMs *= 2; // exponential backoff
                }
            }
        }
        this.logger.error(`All pull attempts failed for image ${image}`);
        throw new Error(`Failed to pull image ${image}: ${lastErrMsg ?? "unknown error"}`);
    }

    private async followStream(stream: NodeJS.ReadableStream, onProgressLine?: (line: string) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            this.docker.modem.followProgress(
                stream,
                (err: Error | null) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                },
                (event: Record<string, unknown>) => {
                    const streamMessage = typeof event.stream === "string"
                        ? event.stream.trim()
                        : "";

                    if (streamMessage.length > 0) {
                        this.logger.debug(streamMessage);
                        onProgressLine?.(streamMessage);
                    }

                    if (typeof event.status === "string") {
                        const status = event.status.trim();
                        const layerId = typeof event.id === "string" ? event.id.trim() : "";
                        const progress = typeof event.progress === "string" ? event.progress.trim() : "";
                        const statusMessage = layerId.length > 0
                            ? `${layerId}: ${status}${progress.length > 0 ? ` ${progress}` : ""}`
                            : `${status}${progress.length > 0 ? ` ${progress}` : ""}`;

                        this.logger.debug(statusMessage);
                        onProgressLine?.(statusMessage);
                    }

                    if (event.error) {
                        const errorMessage = typeof event.error === "string" ? event.error : JSON.stringify(event.error);
                        this.logger.error(errorMessage);
                        onProgressLine?.(`error: ${errorMessage}`);
                    }
                }
            );
        });
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
        try {
            const container = this.docker.getContainer(containerIdOrName);
            const info = await container.inspect();
            return info;
        } catch (error) {
            if (!this.isContainerNotFoundError(error)) {
                this.logger.error(`Failed to get container info for ${containerIdOrName}:`, error);
            }
            throw error;
        }
    }

    private isContainerNotFoundError(error: unknown): boolean {
        if (typeof error !== "object" || error === null) {
            return false;
        }

        const record = isRecord(error) ? error : {};
        if (record.statusCode === 404) {
            return true;
        }

        const reason = typeof record.reason === "string" ? record.reason.toLowerCase() : "";
        if (reason.includes("no such container")) {
            return true;
        }

        const jsonMessage =
            typeof record.json === "object"
            && record.json !== null
            && typeof Reflect.get(isRecord(record.json) ? record.json : {}, "message") === "string"
                ? (Reflect.get(isRecord(record.json) ? record.json : {}, "message") as string).toLowerCase()
                : "";

        return jsonMessage.includes("no such container");
    }

    /**
     * Stop a container by id or name
     */
    async stopContainer(containerIdOrName: string): Promise<void> {
        try {
            const container = this.docker.getContainer(containerIdOrName);
            await container.stop({ t: 10 });
            this.logger.log(`Stopped container ${containerIdOrName}`);
        } catch (error) {
            const errorMessage = DockerService.getDockerErrMsg(error).toLowerCase();
            if (errorMessage.includes("is not running") || errorMessage.includes("not running")) {
                this.logger.log(`Container ${containerIdOrName} already stopped`);
                return;
            }

            this.logger.error(`Failed to stop container ${containerIdOrName}:`, error);
            throw error;
        }
    }

    /**
     * Start a container by id or name
     */
    async startContainer(containerIdOrName: string): Promise<Docker.Container> {
        try {
            const container = this.docker.getContainer(containerIdOrName);
            await container.start();
            this.logger.log(`Started container ${containerIdOrName}`);
            return container;
        } catch (error) {
            const errorMessage = DockerService.getDockerErrMsg(error).toLowerCase();
            if (errorMessage.includes("already started") || errorMessage.includes("already running")) {
                this.logger.log(`Container ${containerIdOrName} already running`);
                return this.docker.getContainer(containerIdOrName);
            }

            this.logger.error(`Failed to start container ${containerIdOrName}:`, error);
            throw error;
        }
    }

    /**
     * List containers using dockerode listContainers
     */
    async listContainers(options: Docker.ContainerListOptions = {}): Promise<Docker.ContainerInfo[]> {
        try {
            const list = await this.docker.listContainers(options);
            return list;
        } catch (error) {
            this.logger.error("Failed to list containers:", error);
            return [];
        }
    }

    async getContainerStats(containerId: string): Promise<Record<string, any>> {
        try {
            const container = this.docker.getContainer(containerId);
            const stats = await container.stats({ stream: false });
            return stats;
        } catch (error) {
            this.logger.error(`Failed to get container stats for ${containerId}:`, error);
            throw error;
        }
    }

    /**
     * Execute a command inside a running container using the Docker API (no host 'docker' CLI required).
     * Supports providing input that will be written to the command's stdin.
     */
    async execInContainer(containerIdOrName: string, cmd: string[], input?: string): Promise<{ exitCode: number; output: string }> {
        try {
            const container = this.docker.getContainer(containerIdOrName);
            // Create exec instance
            this.logger.debug(`Executing in container ${containerIdOrName}: ${cmd.join(" ")}${input ? " (with input)" : ""}`);
            const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, AttachStdin: !!input });

            this.logger.debug(`Created exec instance in container ${containerIdOrName} with ID ${exec.id}`);
            // Start exec and attach streams
            const rawStream: unknown = await exec.start({ hijack: true, stdin: !!input });
            const inlineOutput = this.extractExecOutputPayload(rawStream);
            if (inlineOutput !== null) {
                const execInspect = await exec.inspect();
                const exitCode = typeof execInspect.ExitCode === "number" ? execInspect.ExitCode : -1;
                if (exitCode !== 0) {
                    this.logger.error(`Exec in container ${containerIdOrName} failed (exitCode=${String(exitCode)}): ${inlineOutput}`);
                    throw new Error(`Command ${cmd.join(" ")} failed with exit code ${String(exitCode)} - output: ${inlineOutput}`);
                }

                this.logger.debug(`Exec in container ${containerIdOrName} completed with inline payload (exitCode=${String(exitCode)})`);
                return { exitCode, output: inlineOutput };
            }

            if (!this.isReadWriteStream(rawStream) && !this.isReadableStream(rawStream)) {
                throw new Error("exec.start() returned an unexpected non-stream value");
            }

            const stream = rawStream;

            this.logger.debug(`Started exec instance in container ${containerIdOrName} (stream attached)`);
            // Collect stdout/stderr using demux if available
            const stdoutStream = new PassThrough();
            const stderrStream = new PassThrough();

            try {
                this.logger.debug("Using demuxStream to separate stdout and stderr");
                this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);
            } catch (demuxErr) {
                // Fallback: if demux fails, still attach to raw stream
                this.logger.warn("demuxStream failed, attaching to raw stream as fallback", demuxErr);
                stream.on("data", (chunk: Buffer) => stdoutStream.write(chunk));
            }

            let output = "";
            stdoutStream.on("data", (c: Buffer) => {
                try {
                    output += c.toString("utf8");
                } catch { /* UTF-8 decode error, skip chunk */ }
            });
            stderrStream.on("data", (c: Buffer) => {
                try {
                    output += c.toString("utf8");
                } catch { /* UTF-8 decode error, skip chunk */ }
            });

            // If input supplied, write to stdin
            if (input) {
                if (!this.isReadWriteStream(stream)) {
                    throw new Error("exec.start() returned a non-writable stream while stdin input was provided");
                }
                try {
                    this.logger.debug(`Writing to exec stdin for container ${containerIdOrName}: ${input}`);
                    (stream).write(input);
                } catch (writeErr) {
                    this.logger.warn("Failed to write to exec stdin:", writeErr);
                }
                try {
                    (stream).end();
                } catch { /* stream already ended or closed */ }
            }

            // Wait for end
            await new Promise<void>((resolve, reject) => {
                
                    stream.on("end", () => {
                        resolve();
                    });
                
                    stream.on("close", () => {
                        resolve();
                    });
                
                    stream.on("error", (err: Error) => {
                        reject(err);
                    });
            });

            // Inspect exec to obtain exit code
            const execInspect = await exec.inspect();
            const exitCode = typeof execInspect.ExitCode === "number" ? execInspect.ExitCode : -1;
            if (exitCode !== 0) {
                this.logger.error(`Exec in container ${containerIdOrName} failed (exitCode=${String(exitCode)}): ${output}`);
                throw new Error(`Command ${cmd.join(" ")} failed with exit code ${String(exitCode)} - output: ${output}`);
            }

            this.logger.debug(`Exec in container ${containerIdOrName} completed (exitCode=${String(exitCode)})`);
            return { exitCode, output };
        } catch (error: unknown) {
            // Improve error message for socket closure to provide actionable hint
            const msg = DockerService.getErrMsg(error);

            // If Docker returns HTTP 101 (protocol upgrade) in environments where hijack/attach flows
            // are not supported or proxied, fall back to running the same command in a temporary
            // helper container which mounts the target container's volumes. This covers cases
            // where exec.start() fails with a modem upgrade error like "(HTTP code 101) unexpected -".
            if (/http code\s*101|\(http code 101\)/i.test(msg)) {
                this.logger.warn(`Exec start returned HTTP 101 for container ${containerIdOrName} - attempting helper container fallback`);

                // First try an intermediate retry using a non-hijacked start. Some environments
                // (proxies or transports) don't support hijack/attach upgrades but will still
                // stream stdout/stderr when exec.start is called without hijack.
                try {
                    this.logger.debug(`Attempting non-hijack exec.start retry for container ${containerIdOrName}`);
                    const container = this.docker.getContainer(containerIdOrName);
                    const execRetry = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, AttachStdin: !!input });
                    this.logger.debug(`Created exec instance (retry non-hijack) in container ${containerIdOrName} with ID ${execRetry.id}`);

                    const rawStreamRetry: unknown = await execRetry.start({ hijack: false, stdin: !!input });
                    const inlineRetryOutput = this.extractExecOutputPayload(rawStreamRetry);
                    if (inlineRetryOutput !== null) {
                        const retryInspect = await execRetry.inspect();
                        const retryExit = typeof retryInspect.ExitCode === "number" ? retryInspect.ExitCode : -1;
                        if (retryExit === 0) {
                            this.logger.log(`Non-hijack exec retry succeeded in container ${containerIdOrName} (inline payload)`);
                            this.logger.debug(`Non-hijack exec output (truncated): ${inlineRetryOutput.slice(0, 2000)}`);
                            return { exitCode: retryExit, output: inlineRetryOutput };
                        }

                        this.logger.warn(`Non-hijack exec retry returned non-zero exit code ${String(retryExit)} - falling back to helper container`);
                        throw new Error(`Non-hijack exec retry failed with exit code ${String(retryExit)}: ${inlineRetryOutput}`);
                    }

                    if (!this.isReadWriteStream(rawStreamRetry) && !this.isReadableStream(rawStreamRetry)) {
                        throw new Error("exec.start() returned an unexpected non-stream value");
                    }

                    const streamRetry = rawStreamRetry;
                    this.logger.debug(`Started exec retry in container ${containerIdOrName} (non-hijack, stream attached)`);

                    // Collect output similarly to the normal path
                    const stdoutRetry = new PassThrough();
                    const stderrRetry = new PassThrough();

                        try {
                            this.docker.modem.demuxStream(streamRetry, stdoutRetry, stderrRetry);
                        } catch (demuxErr) {
                            this.logger.warn("demuxStream failed on non-hijack retry - attaching raw stream", demuxErr);
                            streamRetry.on("data", (chunk: Buffer) => stdoutRetry.write(chunk));
                        }

                    let retryOutput = "";
                    stdoutRetry.on("data", (c: Buffer) => {
                        try {
                            retryOutput += c.toString("utf8");
                        } catch { /* UTF-8 decode error, skip chunk */ }
                    });
                    stderrRetry.on("data", (c: Buffer) => {
                        try {
                            retryOutput += c.toString("utf8");
                        } catch { /* UTF-8 decode error, skip chunk */ }
                    });

                    if (input) {
                        if (!this.isReadWriteStream(streamRetry)) {
                            throw new Error("exec retry stream is not writable while stdin input was provided");
                        }
                        try {
                            (streamRetry).write(input);
                        } catch (w) {
                            this.logger.warn("Failed to write input to retry exec stdin", w);
                        }
                        try {
                            (streamRetry).end();
                        } catch { /* stream already ended or closed */ }
                    }

                    await new Promise<void>((resolve, reject) => {
                            streamRetry.on("end", () => {
                                resolve();
                            });
                            streamRetry.on("close", () => {
                                resolve();
                            });
                            streamRetry.on("error", (err: Error) => {
                                reject(err);
                            });
                    });

                    const retryInspect = await execRetry.inspect();
                    const retryExit = typeof retryInspect.ExitCode === "number" ? retryInspect.ExitCode : -1;
                    if (retryExit === 0) {
                        this.logger.log(`Non-hijack exec retry succeeded in container ${containerIdOrName}`);
                        this.logger.debug(`Non-hijack exec output (truncated): ${retryOutput.slice(0, 2000)}`);
                        return { exitCode: retryExit, output: retryOutput };
                    }

                    this.logger.warn(`Non-hijack exec retry returned non-zero exit code ${String(retryExit)} - falling back to helper container`);
                } catch (retryErr) {
                    this.logger.warn(`Non-hijack exec retry failed for container ${containerIdOrName}:`, retryErr);
                    // Helper container fallback is disabled - throw the original error
                    throw error;
                }

                // Helper container fallback has been disabled
                this.logger.error(`Both hijack and non-hijack exec attempts failed for container ${containerIdOrName}`);
                throw error;
            }

            if (msg.includes("socket connection was closed unexpectedly")) {
                this.logger.error(
                    `Failed to exec command in container ${containerIdOrName}: ${msg}. Consider retrying after container startup or using smaller payloads. To get more details, run with verbose fetch (docker-modem).`
                );
            } else {
                this.logger.error(`Failed to exec command in container ${containerIdOrName}:`, error);
            }
            throw error;
        }
    }

    /**
     * Execute a command inside a running container and return the exit code + output
     * WITHOUT throwing on non-zero exit codes.
     *
     * Unlike execInContainer (which throws when the command exits non-zero), this
     * method always returns the exit code and output as data. This is required for
     * scanner commands (trivy, grype, dive) that may return non-zero exit codes
     * when they find vulnerabilities — a non-zero exit is a valid result, not a failure.
     */
    async execInContainerCapture(containerIdOrName: string, cmd: string[], input?: string): Promise<{ exitCode: number; output: string }> {
        try {
            const container = this.docker.getContainer(containerIdOrName);
            this.logger.debug(`Exec-capture in container ${containerIdOrName}: ${cmd.join(" ")}`);
            const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, AttachStdin: !!input });

            const rawStream: unknown = await exec.start({ hijack: true, stdin: !!input });
            const inlineOutput = this.extractExecOutputPayload(rawStream);
            if (inlineOutput !== null) {
                const execInspect = await exec.inspect();
                const exitCode = typeof execInspect.ExitCode === "number" ? execInspect.ExitCode : -1;
                this.logger.debug(`Exec-capture in container ${containerIdOrName} completed with inline payload (exitCode=${String(exitCode)})`);
                return { exitCode, output: inlineOutput };
            }

            if (!this.isReadWriteStream(rawStream) && !this.isReadableStream(rawStream)) {
                throw new Error("exec.start() returned an unexpected non-stream value");
            }

            const stream = rawStream;
            const stdoutStream = new PassThrough();
            const stderrStream = new PassThrough();

            try {
                this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);
            } catch (demuxErr) {
                this.logger.warn("demuxStream failed in exec-capture, attaching to raw stream as fallback", demuxErr);
                stream.on("data", (chunk: Buffer) => stdoutStream.write(chunk));
            }

            let output = "";
            stdoutStream.on("data", (c: Buffer) => {
                try { output += c.toString("utf8"); } catch { /* skip */ }
            });
            stderrStream.on("data", (c: Buffer) => {
                try { output += c.toString("utf8"); } catch { /* skip */ }
            });

            if (input) {
                if (!this.isReadWriteStream(stream)) {
                    throw new Error("exec-capture stream is not writable while stdin input was provided");
                }
                try { (stream).write(input); } catch { /* skip */ }
                try { (stream).end(); } catch { /* skip */ }
            }

            await new Promise<void>((resolve, reject) => {
                stream.on("end", () => { resolve(); });
                stream.on("close", () => { resolve(); });
                stream.on("error", (err: Error) => { reject(err); });
            });

            const execInspect = await exec.inspect();
            const exitCode = typeof execInspect.ExitCode === "number" ? execInspect.ExitCode : -1;

            this.logger.debug(`Exec-capture in container ${containerIdOrName} completed (exitCode=${String(exitCode)})`);
            return { exitCode, output };
        } catch (error: unknown) {
            const msg = DockerService.getErrMsg(error);
            this.logger.error(`Exec-capture failed in container ${containerIdOrName}: ${msg}`);
            return { exitCode: -1, output: msg };
        }
    }

    /**
     * Run a command in a short-lived helper container that mounts the same volumes as the
     * target container. This is used as a fallback when exec/start over the Docker API
     * fails due to protocol upgrade issues (HTTP 101) or other attach-related problems.
     */
    async runCommandInHelperContainer(containerIdOrName: string, command: string, _input?: string): Promise<{ exitCode: number; output: string }> {
        this.logger.debug(`Starting helper container to run command for ${containerIdOrName}: ${command}`);
        // Inspect target container to discover mounts
        let containerInfo: Docker.ContainerInspectInfo;
        try {
            containerInfo = await this.getContainerInfo(containerIdOrName);
        } catch (err) {
            this.logger.error(`Failed to inspect container ${containerIdOrName} while preparing helper container:`, err);
            throw err;
        }

        const binds: string[] = [];
        try {
            const mounts = containerInfo.Mounts;
            for (const m of mounts) {
                // For named volumes use the Name; for bind mounts use the host Source path
                if (m.Type === "volume" && m.Name) {
                    binds.push(`${m.Name}:${m.Destination}`);
                } else if ((m.Type === "bind" || m.Type === "volume") && m.Source) {
                    binds.push(`${m.Source}:${m.Destination}`);
                }
            }
        } catch (err) {
            this.logger.warn(`Failed to build binds from mounts for container ${containerIdOrName}:`, err);
        }

        // If input was provided to the original exec call, note it here. We do not forward
        // stdin into the helper container for now (commands used in fallbacks are usually
        // non-interactive), but log its presence for diagnostics and to satisfy linting.
        if (typeof _input !== "undefined") {
            this.logger.debug(`Helper fallback invoked with input length ${String(_input.length)} - input will not be forwarded to helper container.`);
        }

        // Ensure a small helper image is available
        const helperImage = "alpine:latest";
        try {
            await this.pullImage(helperImage);
        } catch (pullErr) {
            this.logger.warn(`Could not pull helper image ${helperImage}, will still attempt to create container and rely on local image:`, pullErr);
        }

        // Create helper container
        const helperName = `deployer-helper-${String(Date.now())}-${String(Math.floor(Math.random() * 10000))}`;
        const createOpts: Docker.ContainerCreateOptions = {
            Image: helperImage,
            Cmd: ["sh", "-c", command],
            name: helperName,
            HostConfig: {
                Binds: binds,
            },
            Tty: false,
        };

        let helperContainer: Docker.Container | null = null;
        try {
            helperContainer = await this.docker.createContainer(createOpts);
            await helperContainer.start();
            this.logger.debug(`Started helper container ${helperName} (id=${helperContainer.id}) to run fallback command`);

            // Wait for completion
            const waitRaw: unknown = await helperContainer.wait();
            const statusCode = typeof waitRaw === "object" && waitRaw !== null && "StatusCode" in waitRaw && typeof waitRaw.StatusCode === "number" ? waitRaw.StatusCode : -1;

            // Fetch logs
            let logs = "";
            try {
                logs = await this.getContainerLogs(helperContainer.id, { stdout: true, stderr: true, tail: 1000 });
            } catch (logErr) {
                this.logger.warn(`Failed to read logs from helper container ${helperName}:`, DockerService.getErrMsg(logErr));
            }

            // Clean up helper container
            try {
                await helperContainer.remove({ force: true });
            } catch (remErr) {
                this.logger.warn(`Failed to remove helper container ${helperName}:`, DockerService.getErrMsg(remErr));
            }

            if (statusCode !== 0) {
                this.logger.error(`Helper container ${helperName} exited with code ${String(statusCode)}: ${logs}`);
                return { exitCode: statusCode, output: logs };
            }

            this.logger.debug(`Helper container ${helperName} completed successfully`);
            return { exitCode: 0, output: logs };
        } catch (err) {
            this.logger.error(`Helper container execution failed for ${containerIdOrName}:`, DockerService.getErrMsg(err));
            // Attempt to clean up if container was created but not removed
            if (helperContainer) {
                try {
                    await helperContainer.remove({ force: true });
                } catch { /* cleanup: ignore removal errors */ }
            }
            throw err;
        }
    }

    async getContainerLogs(containerIdOrName: string, options: Docker.ContainerLogsOptions = { stdout: true, stderr: true, tail: 200 }): Promise<string> {
        try {
            const container = this.docker.getContainer(containerIdOrName);
            const opts = {
                stdout: options.stdout !== false,
                stderr: options.stderr !== false,
                tail: options.tail ?? "all",
                since: options.since,
                until: options.until,
                timestamps: options.timestamps,
            };
            const rawLogs: unknown = options.follow === true
                ? await container.logs({ ...opts, follow: true as const })
                : await container.logs({ ...opts, follow: false as const });

            // Docker API may return non-stream payloads (Buffer/string) for non-follow log requests.
            if (typeof rawLogs === "string") {
                return rawLogs;
            }

            if (this.isBufferLike(rawLogs)) {
                return this.decodeContainerLogsPayload(Buffer.from(rawLogs));
            }

            if (!this.isReadableStream(rawLogs)) {
                throw new Error("container.logs() returned an unexpected non-stream value");
            }
            const stream = rawLogs;
            const chunks: Buffer[] = [];
                stream.on("data", (chunk) => {
                    try {
                        if (typeof chunk === "string") {
                            chunks.push(Buffer.from(chunk, "utf8"));
                            return;
                        }

                        if (Buffer.isBuffer(chunk)) {
                            chunks.push(chunk);
                            return;
                        }

                        if (chunk instanceof Uint8Array) {
                            chunks.push(Buffer.from(chunk));
                        }
                    } catch { /* UTF-8 decode error, skip chunk */ }
                });
            await new Promise<void>((resolve, reject) => {
                    stream.on("end", () => {
                        resolve();
                    });
                stream.on("close", () => {
                        resolve();
                    });
                stream.on("error", (err: Error) => {
                        reject(err);
                    });
            });

            return this.decodeContainerLogsPayload(Buffer.concat(chunks));
        } catch (error: unknown) {
            this.logger.error(`Failed to fetch logs for container ${containerIdOrName}:`, DockerService.getErrMsg(error));
            throw error;
        }
    }

    /**
     * Stream container logs as an async iterable of decoded line strings.
     *
     * Uses Docker's `follow: true` log stream. Each yielded line is a single
     * line (split on `\n`, with trailing newlines stripped). Multiplexed
     * stdout/stderr frames are demultiplexed and merged into a single line
     * stream (stderr is prefixed with `[stderr] ` so callers can distinguish).
     *
     * The iterator completes naturally when the underlying stream emits
     * `end`. Callers can also break out of the `for await` loop early to
     * stop consuming without leaking the underlying socket — the stream
     * is destroyed via `.destroy()` on early break.
     *
     * @example
     * ```ts
     * for await (const line of docker.streamContainerLogs(containerId, { tail: 50 })) {
     *     emit(InitializationService.stepLog("provision_database", line))
     * }
     * ```
     */
    async *streamContainerLogs(
        containerIdOrName: string,
        options: Docker.ContainerLogsOptions & { stderrPrefix?: string } = {},
    ): AsyncIterable<string> {
        const stderrPrefix = options.stderrPrefix ?? "[stderr] ";
        const container = this.docker.getContainer(containerIdOrName);
        const rawLogs: unknown = await container.logs({
            stdout: options.stdout !== false,
            stderr: options.stderr !== false,
            follow: true as const,
            tail: options.tail ?? 0, // 0 = from start of new lines only
            timestamps: false,
        });

        if (typeof rawLogs === "string" || this.isBufferLike(rawLogs)) {
            // Non-stream result (shouldn't happen with follow:true, but guard anyway)
            const text = typeof rawLogs === "string"
                ? rawLogs
                : this.decodeContainerLogsPayload(Buffer.from(rawLogs));
            for (const line of text.split("\n")) {
                if (line.length > 0) yield line;
            }
            return;
        }

        if (!this.isReadableStream(rawLogs)) {
            throw new Error("container.logs(follow:true) returned an unexpected non-stream value");
        }

        const stream = rawLogs;
        let pending = Buffer.alloc(0);
        let streamEnded = false;
        let streamError: Error | null = null;

        const done = new Promise<void>((resolve, reject) => {
            stream.on("end", () => { streamEnded = true; resolve(); });
            stream.on("close", () => { streamEnded = true; resolve(); });
            stream.on("error", (err: Error) => {
                streamError = err;
                reject(err);
            });
        });

        try {
            while (true) {
                if (streamError) throw streamError;

                // Parse complete frames from the pending buffer
                if (pending.length >= 8) {
                    const streamType = pending[0];
                    if (streamType === 0 || streamType === 1 || streamType === 2) {
                        const frameLength = pending.readUInt32BE(4);
                        if (pending.length >= 8 + frameLength) {
                            const payload = pending.subarray(8, 8 + frameLength);
                            pending = pending.subarray(8 + frameLength);
                            const text = payload.toString("utf8");
                            const prefix = streamType === 2 ? stderrPrefix : "";
                            for (const line of text.split("\n")) {
                                if (line.length > 0) yield prefix + line;
                            }
                            continue;
                        }
                    } else {
                        // Non-multiplexed stream — treat entire buffer as plain text
                        const text = pending.toString("utf8");
                        pending = Buffer.alloc(0);
                        for (const line of text.split("\n")) {
                            if (line.length > 0) yield line;
                        }
                        continue;
                    }
                }

                if (streamEnded) {
                    // Flush any remaining bytes as a final line
                    if (pending.length > 0) {
                        const text = pending.toString("utf8").trim();
                        if (text.length > 0) yield text;
                    }
                    return;
                }

                // Wait for more data or stream end
                const moreData = new Promise<void>((resolve) => {
                    const onData = (chunk: Buffer | string) => {
                        stream.off("end", onEnd);
                        stream.off("close", onClose);
                        stream.off("error", onError);
                        if (typeof chunk === "string") {
                            pending = Buffer.concat([pending, Buffer.from(chunk, "utf8")]);
                        } else if (Buffer.isBuffer(chunk)) {
                            pending = Buffer.concat([pending, chunk]);
                        } else if (chunk instanceof Uint8Array) {
                            pending = Buffer.concat([pending, Buffer.from(chunk)]);
                        }
                        resolve();
                    };
                    const onEnd = () => { stream.off("data", onData); stream.off("error", onError); resolve(); };
                    const onClose = () => { stream.off("data", onData); stream.off("error", onError); resolve(); };
                    const onError = (err: Error) => { stream.off("data", onData); stream.off("end", onEnd); stream.off("close", onClose); streamError = err; resolve(); };

                    stream.once("data", onData);
                    stream.once("end", onEnd);
                    stream.once("close", onClose);
                    stream.once("error", onError);
                });

                await moreData;
            }
        } catch (err) {
            if (streamError) throw streamError;
            throw err;
        } finally {
            // Always tear down the underlying socket so we don't leak
            // half-open log streams if the consumer breaks out of the loop.
            if (typeof (stream as { destroy?: () => void }).destroy === "function") {
                try { (stream as { destroy: () => void }).destroy(); } catch { /* ignore */ }
            }
            // Suppress unhandled rejection from the `done` promise if we broke out early
            done.catch(() => undefined);
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

    /**
     * Attempt to detect the container id for the current process. Tries /proc/self/cgroup then falls back to hostname.
     */
    getSelfContainerId(): string | null {
        try {
            const cgroup = fs.readFileSync("/proc/self/cgroup", "utf8");
            const lines = cgroup.split("\n");
            for (const line of lines) {
                // Docker cgroup lines often end with container id
                const parts = line.split(":");
                const candidate = parts[parts.length - 1] ?? "";
                if (candidate && candidate.length >= 12) {
                    // strip possible prefix like /docker/ or /kubepods/.../docker-<id>.scope
                    const m = /[0-9a-f]{12,64}/i.exec(candidate);
                    if (m) return m[0];
                }
            }
        } catch {
            /* ignore */
        }
        try {
            const hostname = fs.readFileSync("/etc/hostname", "utf8").trim();
            if (hostname && hostname.length >= 12) return hostname;
        } catch {
            /* ignore */
        }
        return null;
    }

    /**
     * Write a string as a file into a named volume at the given path.
     * Uses base64 to avoid shell quoting issues.
     */
    async putStringIntoVolume(volumeName: string, destPathInVolume: string, filename: string, content: string, retries = 3, backoffMs = 1000): Promise<void> {
        const helperImage = "alpine:latest";
        try {
            await this.pullImage(helperImage);
        } catch {
            this.logger.debug(`Could not pull helper image ${helperImage} - proceeding if local image exists`);
        }

        const b64 = Buffer.from(content).toString("base64");
        const safeDest = destPathInVolume || "/";

        let lastErrMsg: string | null = null;
        for (let attempt = 1; attempt <= retries; attempt++) {
            const helperName = `deployer-putstr-${String(Date.now())}-${String(Math.floor(Math.random() * 10000))}`;
            const cmd = ["sh", "-c", `mkdir -p /target${safeDest} && printf '%s' '${b64}' | base64 -d > /target${safeDest}/${filename} && chown -R 1000:1000 /target${safeDest}/${filename}`];
            const createOpts: Docker.ContainerCreateOptions = {
                Image: helperImage,
                name: helperName,
                HostConfig: { Binds: [`${volumeName}:/target`] },
                Cmd: cmd,
                Tty: false,
            };

            let helperContainer: Docker.Container | null = null;
            try {
                helperContainer = await this.docker.createContainer(createOpts);
                await helperContainer.start();
                const waitRaw2: unknown = await helperContainer.wait();
                const status = typeof waitRaw2 === "object" && waitRaw2 !== null && "StatusCode" in waitRaw2 && typeof waitRaw2.StatusCode === "number" ? waitRaw2.StatusCode : 0;
                const logs = await this.getContainerLogs(helperContainer.id, { stdout: true, stderr: true, tail: 200 });
                if (status !== 0) {
                    lastErrMsg = `Helper putString exited ${String(status)} - logs: ${logs}`;
                    this.logger.warn(`putString attempt ${String(attempt)} failed for ${volumeName}${safeDest}/${filename}: ${lastErrMsg}`);
                } else {
                    this.logger.log(`Wrote file ${filename} into volume ${volumeName} at ${safeDest} (attempt ${String(attempt)})`);
                    try {
                        await helperContainer.remove({ force: true });
                    } catch { /* cleanup: ignore removal errors */ }
                    return;
                }
            } catch (err) {
                lastErrMsg = DockerService.getErrMsg(err);
                this.logger.warn(`putString attempt ${String(attempt)} failed for ${volumeName}${safeDest}/${filename}: ${lastErrMsg}`);
                if (helperContainer) {
                    try {
                        await helperContainer.remove({ force: true });
                    } catch { /* cleanup: ignore removal errors */ }
                }
            }

            if (attempt < retries) {
                this.logger.debug(`Retrying putString in ${String(backoffMs)}ms (attempt ${String(attempt + 1)}/${String(retries)})`);
                await new Promise((r) => setTimeout(r, backoffMs));
                backoffMs *= 2;
            }
        }

        throw new Error(`Failed to write file ${filename} into volume ${volumeName} after ${String(retries)} attempts: ${lastErrMsg ?? "unknown error"}`);
    }

    /**
     * Copy files from a container to a Docker volume using native Dockerode operations.
     * This method creates a temporary container with the volume mounted, extracts files from source,
     * and puts them into the volume - all without needing a persistent helper container.
     */
    async copyFromContainerToVolume(sourceContainerIdOrName: string, sourcePath: string, volumeName: string, destPathInVolume: string): Promise<void> {
        this.logger.log(`Copying from container ${sourceContainerIdOrName}:${sourcePath} into volume ${volumeName}:${destPathInVolume}`);

        const sourceContainer = this.docker.getContainer(sourceContainerIdOrName);

        // Create a one-shot container to receive the archive
        // This container will mount the volume, receive the tar stream, extract it, and exit
        const helperImage = "alpine:latest";
        try {
            await this.pullImage(helperImage);
        } catch {
            this.logger.debug("Could not pull helper image - will use local copy if available");
        }

        const helperName = `deployer-copy-${String(Date.now())}-${String(Math.floor(Math.random() * 10000))}`;
        const createOpts: Docker.ContainerCreateOptions = {
            Image: helperImage,
            name: helperName,
            HostConfig: {
                Binds: [`${volumeName}:/target`],
                AutoRemove: false, // We'll remove manually after verification
            },
            // Use a sleep command to keep container alive for our operations
            Cmd: ["sh", "-c", "sleep 60"],
            Tty: false,
        };

        let helperContainer: Docker.Container | null = null;
        try {
            this.logger.debug(`Creating helper container ${helperName} for volume copy`);
            helperContainer = await this.docker.createContainer(createOpts);

            // Start container to create directory structure first
            await helperContainer.start();

            // Create the parent directory structure
            const parentDir = destPathInVolume.substring(0, destPathInVolume.lastIndexOf("/")) || destPathInVolume;
            this.logger.debug(`Creating directory structure: /target${parentDir}`);
            try {
                const mkdirExec = await helperContainer.exec({
                    Cmd: ["sh", "-c", `mkdir -p /target${parentDir} && chmod 755 /target${parentDir}`],
                    AttachStdout: true,
                    AttachStderr: true,
                });
                const mkdirStream = await mkdirExec.start({ hijack: false, stdin: false });
                await this.waitForStreamEnd(mkdirStream, 2000);
            } catch (mkdirErr) {
                this.logger.warn(`Failed to create parent directory (continuing anyway): ${DockerService.getErrMsg(mkdirErr)}`);
            }

            // Get archive stream from source container and save to temp file
            // Using a temp file avoids Docker API's chunked encoding issues with putArchive
            this.logger.debug(`Getting archive from ${sourceContainerIdOrName}:${sourcePath}`);
            const archiveStream = await sourceContainer.getArchive({ path: sourcePath });

            // Write archive to temporary file
            const { createWriteStream } = await import("fs");
            const { unlink } = await import("fs/promises");
            const tempTarPath = `/tmp/deployer-archive-${String(Date.now())}-${String(Math.floor(Math.random() * 10000))}.tar`;
            this.logger.debug(`Writing archive to temp file: ${tempTarPath}`);

            const writeStream = createWriteStream(tempTarPath);
            archiveStream.pipe(writeStream);

            await new Promise<void>((resolve, reject) => {
                writeStream.on("finish", () => {
                    resolve();
                });
                writeStream.on("error", (err: Error) => {
                    reject(err);
                });
                archiveStream.on("error", (err: Error) => {
                    reject(err);
                });
            });

            const { statSync, readFileSync } = await import("fs");
            const tarSize = statSync(tempTarPath).size;
            this.logger.debug(`Wrote ${String(tarSize)} bytes to temp tar file`);

            // Since putArchive has issues with chunked encoding even from files,
            // use docker cp via exec to extract the tar directly
            const extractPath = `/target${parentDir}`;
            this.logger.debug(`Extracting tar using exec in ${helperName} at ${extractPath}`);

            try {
                // Read tar file as base64 to safely transfer via exec
                const tarBuffer = readFileSync(tempTarPath);
                const tarBase64 = tarBuffer.toString("base64");

                // Create the exact destination directory first
                const finalDestPath = `/target${destPathInVolume}`;
                const mkdirFinalExec = await helperContainer.exec({
                    Cmd: ["sh", "-c", `mkdir -p ${finalDestPath}`],
                    AttachStdout: true,
                    AttachStderr: true,
                });
                const mkdirFinalStream = await mkdirFinalExec.start({ hijack: false, stdin: false });
                await this.waitForStreamEnd(mkdirFinalStream, 2000);

                // The tar archive from getArchive contains the directory itself as the first entry,
                // so we use --strip-components=1 to remove it and extract files directly
                const extractCmd = `echo '${tarBase64}' | base64 -d | tar -xf - -C ${finalDestPath} --strip-components=1`;
                const extractExec = await helperContainer.exec({
                    Cmd: ["sh", "-c", extractCmd],
                    AttachStdout: true,
                    AttachStderr: true,
                });
                const extractStream = await extractExec.start({ hijack: false, stdin: false });
                const extractOutput = await this.captureStreamOutput(extractStream, 5000);

                const extractInspect = await extractExec.inspect();
                if (extractInspect.ExitCode !== 0) {
                    throw new Error(`Tar extraction failed with exit code ${String(extractInspect.ExitCode)}: ${extractOutput}`);
                }

                this.logger.debug(`Successfully extracted tar to ${finalDestPath} with strip-components=1`);
            } finally {
                // Clean up temp file
                try {
                    await unlink(tempTarPath);
                    this.logger.debug(`Deleted temp tar file ${tempTarPath}`);
                } catch (unlinkErr) {
                    this.logger.warn(`Failed to delete temp tar file (non-fatal): ${DockerService.getErrMsg(unlinkErr)}`);
                }
            }

            this.logger.log(`Successfully copied archive into volume ${volumeName}${destPathInVolume}`);

            // Container is already running, now run verification and permission fixes
            this.logger.debug(`Running post-copy operations on ${helperName}`);

            // Fix permissions (set to lighttpd user 100:101)
            try {
                const chownCmd = `chown -R 100:101 /target${destPathInVolume} 2>/dev/null || true`;
                const chownExec = await helperContainer.exec({
                    Cmd: ["sh", "-c", chownCmd],
                    AttachStdout: true,
                    AttachStderr: true,
                });
                const chownStream = await chownExec.start({ hijack: false, stdin: false });
                await this.waitForStreamEnd(chownStream, 3000);
                this.logger.debug("Set ownership to 100:101 for lighttpd");
            } catch (chownErr) {
                this.logger.warn(`Failed to set ownership (non-fatal): ${DockerService.getErrMsg(chownErr)}`);
            }

            // Set file permissions
            try {
                const chmodCmd = `find /target${destPathInVolume} -type f -exec chmod 644 {} \\; && find /target${destPathInVolume} -type d -exec chmod 755 {} \\;`;
                const chmodExec = await helperContainer.exec({
                    Cmd: ["sh", "-c", chmodCmd],
                    AttachStdout: true,
                    AttachStderr: true,
                });
                const chmodStream = await chmodExec.start({ hijack: false, stdin: false });
                await this.waitForStreamEnd(chmodStream, 3000);
                this.logger.debug("Set permissions: 644 for files, 755 for directories");
            } catch (chmodErr) {
                this.logger.warn(`Failed to set permissions (non-fatal): ${DockerService.getErrMsg(chmodErr)}`);
            }

            // Verify files were copied
            // Add sync command to ensure files are flushed to disk before verification
            try {
                const verifyCmd = `sync && sleep 0.5 && ls -la /target${destPathInVolume} && find /target${destPathInVolume} -type f | wc -l`;
                const verifyExec = await helperContainer.exec({
                    Cmd: ["sh", "-c", verifyCmd],
                    AttachStdout: true,
                    AttachStderr: true,
                });
                const verifyStream = await verifyExec.start({ hijack: false, stdin: false });
                const output = await this.captureStreamOutput(verifyStream, 3000);

                // Debug: log the raw output
                this.logger.debug(`Verification raw output: ${JSON.stringify(output)}`);

                const lines = output.split("\n");
                this.logger.debug(`Verification lines: ${JSON.stringify(lines)}`);

                const lastLine = lines[lines.length - 1]?.trim() ?? lines[lines.length - 2]?.trim();
                const filesCount = Number(lastLine) || 0;

                this.logger.log(`Verification: ${String(filesCount)} files found in ${volumeName}${destPathInVolume} (last line: "${lastLine ?? ""}")`);

                if (filesCount === 0) {
                    throw new Error("Archive extracted but no files found in destination");
                }
            } catch (verifyErr) {
                this.logger.error(`Post-copy verification failed: ${DockerService.getErrMsg(verifyErr)}`);
                throw verifyErr;
            }

            // Clean up helper container
            try {
                await helperContainer.stop({ t: 1 });
            } catch {
                // Container might have already exited
                this.logger.debug("Container already stopped");
            }

            try {
                await helperContainer.remove({ force: true });
                this.logger.debug(`Removed helper container ${helperName}`);
            } catch (removeErr) {
                this.logger.warn(`Failed to remove helper container: ${DockerService.getErrMsg(removeErr)}`);
            }
        } catch (err) {
            this.logger.error(`Failed to copy from ${sourceContainerIdOrName}:${sourcePath} to volume ${volumeName}:${destPathInVolume}:`, DockerService.getErrMsg(err));

            // Clean up on error
            if (helperContainer) {
                try {
                    await helperContainer.remove({ force: true });
                } catch (cleanupErr) {
                    this.logger.debug("Failed to cleanup helper container:", DockerService.getErrMsg(cleanupErr));
                }
            }

            throw err;
        }
    }

    /**
     * Helper method to wait for a stream to end with timeout
     */
    private async waitForStreamEnd(rawStream: unknown, timeoutMs = 5000): Promise<void> {
        if (!this.isReadableStream(rawStream)) {
            throw new Error("waitForStreamEnd: provided value is not a readable stream");
        }
        const stream = rawStream;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                resolve(); // Don't reject on timeout, just continue
            }, timeoutMs);

            stream.on("end", () => {
                clearTimeout(timeout);
                resolve();
            });

            stream.on("error", (err: Error) => {
                clearTimeout(timeout);
                reject(err);
            });

            // Start reading the stream
            stream.resume();
        });
    }

    /**
     * Helper method to capture stream output with timeout
     */
    private async captureStreamOutput(rawStream: unknown, timeoutMs = 5000): Promise<string> {
        if (!this.isReadableStream(rawStream)) {
            return "";
        }
        const stream = rawStream;
        return new Promise((resolve, reject) => {
            let output = "";
            const timeout = setTimeout(() => {
                resolve(output); // Return what we have so far
            }, timeoutMs);

            stream.on("data", (chunk: Buffer) => {
                // Docker exec streams are multiplexed with 8-byte headers
                // Format: [stream_type(1), padding(3), size(4)] then payload
                // streamType 1 = stdout, 2 = stderr — skip the 8-byte header
                const streamType = chunk[0];
                const data: string =
                    chunk.length > 8 && (streamType === 1 || streamType === 2)
                        ? chunk.subarray(8).toString()
                        : chunk.toString();
                output += data;
            });

            stream.on("end", () => {
                clearTimeout(timeout);
                resolve(output);
            });

            stream.on("error", (err: Error) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    /**
     * Run a command in a temporary helper container that mounts a named volume at /target.
     * Returns { exitCode, output } where output is combined stdout/stderr.
     */
    async runCommandInVolume(volumeName: string, command: string, _input?: string): Promise<{ exitCode: number; output: string }> {
        this.logger.debug(`Running command in volume ${volumeName}: ${command}`);
        const helperImage = "alpine:latest";
        try {
            await this.pullImage(helperImage);
        } catch (pullErr) {
            this.logger.warn(`Could not pull helper image ${helperImage}, proceeding with local image if available:`, pullErr);
        }

        const helperName = `deployer-vol-${String(Date.now())}-${String(Math.floor(Math.random() * 10000))}`;
        const createOpts: Docker.ContainerCreateOptions = {
            Image: helperImage,
            Cmd: ["sh", "-c", command],
            name: helperName,
            HostConfig: {
                Binds: [`${volumeName}:/target`],
            },
            Tty: false,
        };

        let helperContainer: Docker.Container | null = null;
        try {
            helperContainer = await this.docker.createContainer(createOpts);
            await helperContainer.start();
            this.logger.log(`Started helper container ${helperName} (id=${helperContainer.id}) for command execution`);

            // Wait for completion with timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(new Error("Container wait timeout after 120 seconds"));
                }, 120000);
            });

            const waitResult: unknown = await Promise.race([helperContainer.wait(), timeoutPromise]);
            const statusCode = typeof waitResult === "object" && waitResult !== null && "StatusCode" in waitResult && typeof waitResult.StatusCode === "number" ? waitResult.StatusCode : -1;

            // Fetch logs
            let logs = "";
            try {
                logs = await this.getContainerLogs(helperContainer.id, { stdout: true, stderr: true, tail: 1000 });
            } catch (logErr) {
                this.logger.warn(`Failed to read logs from helper container ${helperName}:`, DockerService.getErrMsg(logErr));
            }

            // Clean up helper container
            try {
                await helperContainer.remove({ force: true });
            } catch (remErr) {
                this.logger.warn(`Failed to remove helper container ${helperName}:`, DockerService.getErrMsg(remErr));
            }

            if (statusCode !== 0) {
                this.logger.error(`Helper container ${helperName} exited with code ${String(statusCode)}: ${logs}`);
                return { exitCode: statusCode, output: logs };
            }

            this.logger.debug(`Helper container ${helperName} completed successfully`);
            return { exitCode: 0, output: logs };
        } catch (err) {
            const errorMessage = DockerService.getErrMsg(err);
            this.logger.error(`Helper container execution failed for volume ${volumeName}: ${errorMessage}`);

            // Attempt to clean up if container was created but not removed
            if (helperContainer) {
                try {
                    await helperContainer.remove({ force: true });
                    this.logger.debug(`Cleaned up helper container ${helperName} after error`);
                } catch (removeErr) {
                    this.logger.warn(`Failed to clean up helper container ${helperName}: ${DockerService.getErrMsg(removeErr)}`);
                }
            }

            // If it was a timeout, return a specific error response instead of throwing
            if (errorMessage.includes("timeout")) {
                this.logger.warn(`Helper container ${helperName} timed out, returning failure result`);
                return { exitCode: 124, output: `Command timed out after 120 seconds: ${command}` };
            }

            throw err;
        }
    }

    /**
     * Find a container that contains the specified path in its filesystem.
     * Searches through running containers and checks if the path exists.
     * Returns the container ID if found, null otherwise.
     */
    async findContainerWithPath(searchPath: string): Promise<string | null> {
        this.logger.debug(`Searching for container containing path: ${searchPath}`);

        try {
            // List all running containers
            const containers = await this.docker.listContainers({ all: false });

            if (containers[0]) {
                this.logger.debug("No running containers found to search");
                return null;
            }

            this.logger.debug(`Searching through ${String(containers.length)} running containers for path ${searchPath}`);

            // Check each container for the path
            for (const containerInfo of containers) {
                const containerId = containerInfo.Id;
                const containerName = containerInfo.Names[0] ?? containerId;

                try {
                    // Try to check if path exists in this container
                    const checkCmd = ["sh", "-c", `test -e "${searchPath}" && echo "EXISTS" || echo "NOT_FOUND"`];

                    // Use a simpler approach - try to inspect the path via container exec
                    const container = this.docker.getContainer(containerId);
                    const exec = await container.exec({
                        Cmd: checkCmd,
                        AttachStdout: true,
                        AttachStderr: true,
                    });

                    const execRaw: unknown = await exec.start({ hijack: false, stdin: false });
                    if (!this.isReadableStream(execRaw)) {
                        throw new Error("exec.start() returned an unexpected non-stream value");
                    }
                    const stream = execRaw;

                    let output = "";
                        stream.on("data", (chunk: Buffer) => {
                            try {
                                output += chunk.toString("utf8");
                            } catch { /* UTF-8 decode error, skip chunk */ }
                        });

                    await new Promise<void>((resolve) => {
                            stream.on("end", () => {
                                resolve();
                            });
                            stream.on("close", () => {
                                resolve();
                            });
                        // Timeout after 2 seconds
                        setTimeout(() => {
                            resolve();
                        }, 2000);
                    });

                    const execInspect = await exec.inspect();
                    const exitCode = typeof execInspect.ExitCode === "number" ? execInspect.ExitCode : -1;

                    if (exitCode === 0 && output.includes("EXISTS")) {
                        this.logger.log(`Found path ${searchPath} in container ${containerName} (${containerId})`);
                        return containerId;
                    }

                    this.logger.debug(`Path ${searchPath} not found in container ${containerName} (exit=${String(exitCode)}, output=${output.trim()})`);
                } catch (execErr) {
                    // If exec fails (e.g., no sh available), try alternative approach or skip
                    this.logger.debug(`Could not check path in container ${containerName}: ${DockerService.getErrMsg(execErr)}`);

                    // Try alternative: check using stat or ls
                    try {
                        const altCmd = ["test", "-e", searchPath];
                        const container = this.docker.getContainer(containerId);
                        const altExec = await container.exec({
                            Cmd: altCmd,
                            AttachStdout: true,
                            AttachStderr: true,
                        });

                        const altRaw: unknown = await altExec.start({ hijack: false, stdin: false });
                        if (!this.isReadableStream(altRaw)) {
                            throw new Error("altExec.start() returned an unexpected non-stream value");
                        }
                        const altStream = altRaw;

                        await new Promise<void>((resolve) => {
                                altStream.on("end", () => {
                                    resolve();
                                });
                            altStream.on("close", () => {
                                    resolve();
                                });
                            setTimeout(() => {
                                resolve();
                            }, 2000);
                        });

                        const altInspect = await altExec.inspect();
                        const altExitCode = typeof altInspect.ExitCode === "number" ? altInspect.ExitCode : -1;

                        if (altExitCode === 0) {
                            this.logger.log(`Found path ${searchPath} in container ${containerName} (${containerId}) using test command`);
                            return containerId;
                        }
                    } catch (altErr) {
                        this.logger.debug(`Alternative check also failed for ${containerName}: ${DockerService.getErrMsg(altErr)}`);
                    }
                }
            }

            this.logger.debug(`Path ${searchPath} not found in any running container`);
            return null;
        } catch (error) {
            this.logger.error(`Error while searching for container with path ${searchPath}:`, error);
            return null;
        }
    }
}

// Stronger create container options combining dockerode types with our custom fields
export interface CreateContainerOptions extends Docker.ContainerCreateOptions {
    // backward compatibility: allow lowercase 'image' property
    image?: string;
    imagePullPolicy?: "IfNotPresent" | "Always" | "Never";
    registryAuth?: Docker.AuthConfig;
}
