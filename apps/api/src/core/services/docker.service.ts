import { Injectable, Logger } from '@nestjs/common';
import Docker from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';
@Injectable()
export class DockerService {
    private readonly logger = new Logger(DockerService.name);
    private readonly docker: Docker;
    constructor() {
        // Configure Docker connection based on environment
        if (process.env.DOCKER_HOST) {
            // Use DOCKER_HOST if provided
            this.docker = new Docker({
                host: process.env.DOCKER_HOST,
                port: process.env.DOCKER_PORT ? parseInt(process.env.DOCKER_PORT) : undefined
            });
            this.logger.log(`Connected to Docker via DOCKER_HOST: ${process.env.DOCKER_HOST}`);
        }
        else if (fs.existsSync('/var/run/docker.sock')) {
            // Check if we're running in a container with mounted Docker socket
            try {
                // Verify socket permissions
                const socketStats = fs.statSync('/var/run/docker.sock');
                this.logger.log(`Docker socket found - mode: ${socketStats.mode.toString(8)}, uid: ${socketStats.uid}, gid: ${socketStats.gid}`);
                this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
                this.logger.log('Connected to Docker via mounted socket');
            }
            catch (error) {
                this.logger.error('Failed to access Docker socket:', error);
                // Fallback to default Docker connection
                this.docker = new Docker();
            }
        }
        else {
            // Fallback to default Docker connection
            this.logger.warn('Docker socket not found, using default connection');
            this.docker = new Docker();
        }
    }
    /**
     * Test Docker connection and log connection status
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.docker.ping();
            this.logger.log('Docker connection successful');
            return true;
        }
        catch (error) {
            this.logger.error('Docker connection failed:', error);
            return false;
        }
    }
    async buildImage(sourcePath: string, imageTag: string): Promise<void> {
        this.logger.log(`Building image ${imageTag} from ${sourcePath}`);
        // Check if Dockerfile exists
        const dockerfilePath = path.join(sourcePath, 'Dockerfile');
        if (!fs.existsSync(dockerfilePath)) {
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
        const stream = await this.docker.buildImage({
            context: sourcePath,
            src: ['.']
        }, {
            t: imageTag,
            dockerfile: 'Dockerfile'
        });
        await this.followStream(stream);
        this.logger.log(`Image ${imageTag} built successfully`);
    }
    async createAndStartContainer(options: {
        image: string;
        name: string;
        deploymentId: string;
        envVars?: Record<string, string>;
        ports?: Record<string, string>;
        imagePullPolicy?: 'IfNotPresent' | 'Always' | 'Never';
        registryAuth?: Docker.AuthConfig;
    }): Promise<string> {
        const { image, name, deploymentId, envVars = {}, ports = {}, imagePullPolicy = 'IfNotPresent', registryAuth } = options;
        this.logger.log(`Creating container ${name} from image ${image} (policy=${imagePullPolicy})`);
        // Convert environment variables to Docker format
        const env = Object.entries(envVars).map(([key, value]) => `${key}=${value}`);
        // Convert port mappings
        const exposedPorts: Record<string, {}> = {};
        const portBindings: Record<string, Array<{
            HostPort: string;
        }>> = {};
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
                        Name: 'unless-stopped'
                    }
                },
                Labels: {
                    'deployer.deployment_id': deploymentId,
                    'deployer.managed': 'true'
                }
            });
            await container.start();
            const containerInfo = await container.inspect();
            return containerInfo.Id;
        };

        // Pre-pull or inspect based on policy
        const shouldAttemptPull = async (img: string): Promise<boolean> => {
            if (imagePullPolicy === 'Always') return true;
            if (imagePullPolicy === 'Never') return false;
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
                    this.logger.warn(`Initial pull failed for ${image}: ${(pullErr as Error)?.message || String(pullErr)}`);
                    // If pull fails and policy is Never, rethrow. If policy allowed, we'll attempt fallbacks below.
                }
            }
            return await attemptCreate(image);
        } catch (error: any) {
            const errMsg = (error && (error.json && error.json.message || error.message || String(error))).toLowerCase();
            if (errMsg.includes('no such image') || errMsg.includes('not found') || errMsg.includes('manifest unknown')) {
                this.logger.warn(`Image ${image} not found locally after pre-pull. Attempting fallback pulls...`);
                const imagesToTry = [image];
                if (image === 'nginx:alpine') {
                    imagesToTry.push('nginx:latest', 'nginx:stable-alpine');
                }
                let lastPullError: any = null;
                for (const img of imagesToTry) {
                    try {
                        // Only attempt pull if policy permits
                        if (imagePullPolicy !== 'Never') {
                            await this.pullImage(img, registryAuth);
                        } else {
                            this.logger.warn(`ImagePullPolicy set to 'Never' - skipping pull for ${img}`);
                            continue;
                        }
                        this.logger.log(`Successfully pulled image ${img}. Retrying container creation...`);
                        return await attemptCreate(img);
                    } catch (pullErr) {
                        lastPullError = pullErr;
                        this.logger.warn(`Pulling image ${img} failed: ${(pullErr as Error)?.message || String(pullErr)}`);
                    }
                }
                this.logger.error(`All attempts to pull image ${image} and fallbacks failed`);
                throw new Error(`Failed to pull image ${image}: ${lastPullError instanceof Error ? lastPullError.message : String(lastPullError)}`);
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
                label: [`deployer.deployment_id=${deploymentId}`]
            }
        });
        for (const containerInfo of containers) {
            const container = this.docker.getContainer(containerInfo.Id);
            if (containerInfo.State === 'running') {
                await container.stop({ t: 10 }); // 10 second timeout
                this.logger.log(`Stopped container ${containerInfo.Names[0]}`);
            }
        }
    }
    async startContainersByDeployment(deploymentId: string): Promise<void> {
        this.logger.log(`Starting containers for deployment ${deploymentId}`);
        const containers = await this.docker.listContainers({
            all: true,
            filters: {
                label: [`deployer.deployment_id=${deploymentId}`]
            }
        });
        for (const containerInfo of containers) {
            const container = this.docker.getContainer(containerInfo.Id);
            if (containerInfo.State !== 'running') {
                await container.start();
                this.logger.log(`Started container ${containerInfo.Names[0]}`);
            }
        }
    }
    async listContainersByDeployment(deploymentId: string): Promise<Array<{
        id: string;
        name: string;
        status: string;
    }>> {
        this.logger.log(`Listing containers for deployment ${deploymentId}`);
        const containers = await this.docker.listContainers({
            all: true,
            filters: {
                label: [`deployer.deployment_id=${deploymentId}`]
            }
        });
        return containers.map(containerInfo => ({
            id: containerInfo.Id,
            name: containerInfo.Names[0] || 'unknown',
            status: containerInfo.State
        }));
    }
    async checkContainerHealth(containerId: string): Promise<boolean> {
        try {
            const container = this.docker.getContainer(containerId);
            const containerInfo = await container.inspect();
            // Check if container is running
            if (containerInfo.State.Status !== 'running') {
                return false;
            }
            // If health check is configured, use it
            if (containerInfo.State.Health) {
                return containerInfo.State.Health.Status === 'healthy';
            }
            // Otherwise, just check if it's running
            return true;
        }
        catch (error) {
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
            log: Array<{
                start: string;
                end: string;
                exitCode: number;
                output: string;
            }>;
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

            const uptime = containerInfo.State.StartedAt 
                ? Date.now() - new Date(containerInfo.State.StartedAt).getTime()
                : 0;

            type HealthCheckLogEntry = { start: string; end: string; exitCode: number; output: string };
            type DetailedHealth = {
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
            };

            const result: DetailedHealth = {
                isHealthy: containerInfo.State.Status === 'running',
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
                const rawLog = (containerInfo.State.Health.Log || []) as Array<Record<string, any>>;
                const normalizedLog: HealthCheckLogEntry[] = rawLog.slice(-5).map((entry) => ({
                    start: String(entry.Start ?? entry.start ?? ''),
                    end: String(entry.End ?? entry.end ?? ''),
                    exitCode: Number(entry.ExitCode ?? entry.exitCode ?? 0),
                    output: String(entry.Output ?? entry.output ?? ''),
                }));
                result.healthChecks = {
                    status: containerInfo.State.Health.Status,
                    failingStreak: containerInfo.State.Health.FailingStreak || 0,
                    log: normalizedLog,
                };
             }

            return result;
        }
        catch (error) {
            this.logger.error(`Failed to get detailed health for container ${containerId}:`, error);
            return {
                isHealthy: false,
                status: 'unknown',
                uptime: 0,
                restartCount: 0,
                lastStarted: null,
                resources: {},
            };
        }
    }

    async monitorContainersByDeployment(deploymentId: string): Promise<Array<{
        containerId: string;
        containerName: string;
        health: Awaited<ReturnType<DockerService['getDetailedContainerHealth']>>;
    }>> {
        try {
            const containers = await this.listContainersByDeployment(deploymentId);
            const results: Array<{
                containerId: string;
                containerName: string;
                health: Awaited<ReturnType<DockerService['getDetailedContainerHealth']>>;
            }> = [];

            for (const container of containers) {
                const health = await this.getDetailedContainerHealth(container.id);
                results.push({
                    containerId: container.id,
                    containerName: container.name,
                    health,
                });
            }

            return results;
        }
        catch (error) {
            this.logger.error(`Failed to monitor containers for deployment ${deploymentId}:`, error);
            return [];
        }
    }

    async performHealthCheck(containerId: string, healthCheckUrl?: string, timeout: number = 30000): Promise<{
        isHealthy: boolean;
        httpStatus?: number;
        responseTime?: number;
        error?: string;
        containerHealth: Awaited<ReturnType<DockerService['getDetailedContainerHealth']>>;
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
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch(healthCheckUrl, {
                    signal: controller.signal,
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Deployer-HealthCheck/1.0',
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
            }
            catch (error) {
                return {
                    ...result,
                    isHealthy: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        }

        return result;
    }

    async waitForContainerHealth(
        containerId: string, 
        maxRetries: number = 30, 
        retryInterval: number = 2000,
        healthCheckUrl?: string
    ): Promise<boolean> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            this.logger.debug(`Health check attempt ${attempt}/${maxRetries} for container ${containerId}`);
            
            const healthResult = await this.performHealthCheck(containerId, healthCheckUrl);
            
            if (healthResult.isHealthy) {
                this.logger.log(`Container ${containerId} is healthy after ${attempt} attempts`);
                return true;
            }

            if (attempt < maxRetries) {
                this.logger.debug(`Container ${containerId} not healthy yet, waiting ${retryInterval}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryInterval));
            }
        }

        this.logger.error(`Container ${containerId} failed health check after ${maxRetries} attempts`);
        return false;
    }

    async restartContainer(containerId: string): Promise<void> {
        try {
            const container = this.docker.getContainer(containerId);
            await container.restart();
            this.logger.log(`Container ${containerId} restarted successfully`);
        }
        catch (error) {
            this.logger.error(`Failed to restart container ${containerId}:`, error);
            throw error;
        }
    }
    async removeContainer(containerId: string): Promise<void> {
        try {
            const container = this.docker.getContainer(containerId);
            // Stop if running
            const containerInfo = await container.inspect();
            if (containerInfo.State.Status === 'running') {
                await container.stop({ t: 10 });
            }
            // Remove container
            await container.remove({ force: true });
            this.logger.log(`Removed container ${containerId}`);
        }
        catch (error) {
            this.logger.error(`Failed to remove container ${containerId}:`, error);
        }
    }
    async removeImage(imageTag: string): Promise<void> {
        try {
            const image = this.docker.getImage(imageTag);
            await image.remove({ force: true });
            this.logger.log(`Removed image ${imageTag}`);
        }
        catch (error) {
            this.logger.error(`Failed to remove image ${imageTag}:`, error);
        }
    }
    async createContainer(options: CreateContainerOptions): Promise<Docker.Container> {
        const requestedImage = options?.Image || options?.image || '';
        const imagePullPolicy: 'IfNotPresent' | 'Always' | 'Never' = options?.imagePullPolicy || 'IfNotPresent';
        const registryAuth = options?.registryAuth;
        // Ensure image exists locally; if not attempt pull first depending on policy
        if (requestedImage) {
            try {
                const img = this.docker.getImage(requestedImage);
                await img.inspect();
                this.logger.log(`Image ${requestedImage} exists locally`);
            } catch (inspectErr) {
                this.logger.debug(`Image inspect failed for ${requestedImage}: ${(inspectErr as any)?.message || String(inspectErr)}`);
                if (imagePullPolicy === 'Never') {
                    this.logger.warn(`Image ${requestedImage} not present locally and policy is 'Never' - refusing to pull`);
                    throw new Error(`Image ${requestedImage} not present locally and imagePullPolicy is 'Never'`);
                }
                this.logger.warn(`Image ${requestedImage} not present locally. Will attempt to pull before creating container (policy=${imagePullPolicy}).`);
                const imagesToTry = [requestedImage];
                if (requestedImage === 'nginx:alpine') {
                    imagesToTry.push('nginx:latest', 'nginx:stable-alpine');
                }
                let pulled = false;
                let lastErr: Error | null = null;
                for (const imgName of imagesToTry) {
                    try {
                        this.logger.log(`Pulling image prior to create: ${imgName}`);
                        await this.pullImage(imgName, registryAuth);
                        pulled = true;
                        if (imgName !== requestedImage) {
                            options.Image = imgName;
                        }
                        break;
                    } catch (pullErr) {
                        lastErr = pullErr as Error;
                        this.logger.warn(`Pulling image ${imgName} failed: ${(pullErr as any)?.message || String(pullErr)}`);
                    }
                }
                if (!pulled) {
                    this.logger.error(`Failed to pull requested image ${requestedImage} and fallbacks. Last error: ${(lastErr as any)?.message || String(lastErr)}`);
                    throw new Error(`Image ${requestedImage} missing and pull failed: ${(lastErr as any)?.message || String(lastErr)}`);
                }
            }
        }

        try {
            const container = await this.docker.createContainer(options);
            this.logger.log(`Created container ${container.id}`);
            return container;
        }
        catch (error: unknown) {
            const errMsg = (error && (error as any).message) || String(error);
            this.logger.error('Failed to create container:', errMsg);
            // Detect image-not-found errors and attempt pull+retry
            const errMsgLower = String(errMsg).toLowerCase();
            if (errMsgLower.includes('no such image') || errMsgLower.includes('not found') || errMsgLower.includes('manifest unknown')) {
                const imagesToTry = [requestedImage];
                if (requestedImage === 'nginx:alpine') {
                    imagesToTry.push('nginx:latest', 'nginx:stable-alpine');
                }
                let lastErr: Error | null = null;
                for (const img of imagesToTry) {
                    try {
                        this.logger.log(`Pulling image for container creation (retry path): ${img}`);
                        if (imagePullPolicy !== 'Never') {
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
                        lastErr = pullErr as Error;
                        this.logger.warn(`Pull or retry create failed for ${img}: ${(pullErr as any)?.message || String(pullErr)}`);
                    }
                }
                this.logger.error(`Failed to pull any images for container creation. Last error: ${(lastErr as any)?.message || String(lastErr)}`);
                throw new Error(`Failed to create container: image ${requestedImage} not available and pull attempts failed. Last error: ${(lastErr as any)?.message || String(lastErr)}`);
            }
            throw error;
        }
    }

    /**
     * Pull an image from a registry with optional auth and retry/backoff.
     */
    async pullImage(image: string, registryAuth?: Docker.AuthConfig, retries = 3, backoffMs = 2000): Promise<void> {
        this.logger.log(`Attempting to pull image ${image} (retries=${retries})`);
        let lastErr: Error | null = null;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const pullOpts: Record<string, unknown> = {};
                if (registryAuth) {
                    pullOpts.authconfig = registryAuth;
                }
                const stream: NodeJS.ReadableStream = await (this.docker.pull as any)(image, pullOpts);
                await this.followStream(stream);
                // Successful pull
                this.logger.log(`Successfully pulled ${image} on attempt ${attempt}`);
                return;
            } catch (err) {
                lastErr = err as Error;
                this.logger.warn(`Pull attempt ${attempt} failed for ${image}: ${(err as Error)?.message || String(err)}`);
                if (attempt < retries) {
                    this.logger.log(`Waiting ${backoffMs}ms before next pull attempt...`);
                    await new Promise((r) => setTimeout(r, backoffMs));
                    backoffMs *= 2; // exponential backoff
                }
            }
        }
        this.logger.error(`All pull attempts failed for image ${image}`);
        throw new Error(`Failed to pull image ${image}: ${(lastErr as Error)?.message || String(lastErr)}`);
    }

    private async followStream(stream: NodeJS.ReadableStream): Promise<void> {
        return new Promise((resolve, reject) => {
            this.docker.modem.followProgress(stream, (err: Error | null) => {
                 if (err) {
                     reject(err);
                 }
                 else {
                     resolve();
                 }
            }, (event: Record<string, unknown>) => {
                if (typeof event.stream === 'string') {
                    this.logger.debug(event.stream.trim());
                }
                if (typeof event.status === 'string') {
                    this.logger.debug(event.status);
                }
                if (event.error) {
                    this.logger.error(String(event.error));
                }
             });
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
            this.logger.error(`Failed to get container info for ${containerIdOrName}:`, error);
            throw error;
        }
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
            this.logger.error(`Failed to stop container ${containerIdOrName}:`, error);
            throw error;
        }
    }

    /**
     * List containers using dockerode listContainers
     */
    async listContainers(options: Docker.ContainerListOptions = {}): Promise<Docker.ContainerInfo[]> {
        try {
            const list = await this.docker.listContainers(options) as Docker.ContainerInfo[];
            return list || [];
        } catch (error) {
            this.logger.error('Failed to list containers:', error);
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
            this.logger.debug(`Executing in container ${containerIdOrName}: ${cmd.join(' ')}${input ? ' (with input)' : ''}`);
            const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, AttachStdin: !!input });

            this.logger.debug(`Created exec instance in container ${containerIdOrName} with ID ${exec.id}`);
            // Start exec and attach streams
            const stream = await exec.start({ hijack: true, stdin: !!input }) as NodeJS.ReadWriteStream;

            this.logger.debug(`Started exec instance in container ${containerIdOrName} (stream attached)`);
            // Collect stdout/stderr using demux if available
            const { PassThrough } = await import('stream');
            const stdoutStream = new PassThrough();
            const stderrStream = new PassThrough();

            if (this.docker.modem && typeof (this.docker.modem as any).demuxStream === 'function') {
                try {
                    this.logger.debug('Using demuxStream to separate stdout and stderr');
                    (this.docker.modem as any).demuxStream(stream, stdoutStream, stderrStream);
                }
                catch (demuxErr) {
                    // Fallback: if demux fails, still attach to raw stream
                    this.logger.warn('demuxStream failed, attaching to raw stream as fallback', demuxErr);
                    stream.on && stream.on('data', (chunk: Buffer) => stdoutStream.write(chunk));
                }
            }
            else {
                this.logger.debug('demuxStream not available - attaching to raw stream');
                // Older dockerode - fallback to raw stream
                stream.on && stream.on('data', (chunk: Buffer) => stdoutStream.write(chunk));
            }

            let output = '';
            stdoutStream.on('data', (c: Buffer) => { try { output += c.toString('utf8'); } catch { } });
            stderrStream.on('data', (c: Buffer) => { try { output += c.toString('utf8'); } catch { } });

            // If input supplied, write to stdin
            if (input) {
                try {
                    this.logger.debug(`Writing to exec stdin for container ${containerIdOrName}: ${input}`);
                    (stream as NodeJS.WritableStream).write(input);
                }
                catch (writeErr) {
                    this.logger.warn('Failed to write to exec stdin:', writeErr);
                }
                try { (stream as NodeJS.WritableStream).end(); } catch { }
            }

            // Wait for end
            await new Promise<void>((resolve, reject) => {
                stream.on && stream.on('end', () => resolve());
                stream.on && stream.on('close', () => resolve());
                stream.on && stream.on('error', (err: any) => reject(err));
            });

            // Inspect exec to obtain exit code
            const execInspect = await exec.inspect();
            const exitCode = typeof execInspect.ExitCode === 'number' ? execInspect.ExitCode : -1;
            if (exitCode !== 0) {
                this.logger.error(`Exec in container ${containerIdOrName} failed (exitCode=${exitCode}): ${output}`);
                throw new Error(`Command ${cmd.join(' ')} failed with exit code ${exitCode} - output: ${output}`);
            }

            this.logger.debug(`Exec in container ${containerIdOrName} completed (exitCode=${exitCode})`);

            return { exitCode, output };
        }
        catch (error: any) {
            // Improve error message for socket closure to provide actionable hint
            const msg = error && (error.message || String(error));

            // If Docker returns HTTP 101 (protocol upgrade) in environments where hijack/attach flows
            // are not supported or proxied, fall back to running the same command in a temporary
            // helper container which mounts the target container's volumes. This covers cases
            // where exec.start() fails with a modem upgrade error like "(HTTP code 101) unexpected -".
            if (msg && /http code\s*101|\(http code 101\)/i.test(msg)) {
                this.logger.warn(`Exec start returned HTTP 101 for container ${containerIdOrName} - attempting helper container fallback`);

                // First try an intermediate retry using a non-hijacked start. Some environments
                // (proxies or transports) don't support hijack/attach upgrades but will still
                // stream stdout/stderr when exec.start is called without hijack.
                try {
                    this.logger.debug(`Attempting non-hijack exec.start retry for container ${containerIdOrName}`);
                    const container = this.docker.getContainer(containerIdOrName);
                    const execRetry = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true, AttachStdin: !!input });
                    this.logger.debug(`Created exec instance (retry non-hijack) in container ${containerIdOrName} with ID ${execRetry.id}`);

                    const streamRetry = await execRetry.start({ hijack: false, stdin: !!input }) as NodeJS.ReadWriteStream;
                    this.logger.debug(`Started exec retry in container ${containerIdOrName} (non-hijack, stream attached)`);

                    // Collect output similarly to the normal path
                    const { PassThrough } = await import('stream');
                    const stdoutRetry = new PassThrough();
                    const stderrRetry = new PassThrough();

                    if (this.docker.modem && typeof this.docker.modem.demuxStream === 'function') {
                        try {
                            this.docker.modem.demuxStream(streamRetry, stdoutRetry, stderrRetry);
                        }
                        catch (demuxErr) {
                            this.logger.warn('demuxStream failed on non-hijack retry - attaching raw stream', demuxErr);
                            streamRetry.on && streamRetry.on('data', (chunk: Buffer) => stdoutRetry.write(chunk));
                        }
                    }
                    else {
                        streamRetry.on && streamRetry.on('data', (chunk: Buffer) => stdoutRetry.write(chunk));
                    }

                    let retryOutput = '';
                    stdoutRetry.on('data', (c: Buffer) => { try { retryOutput += c.toString('utf8'); } catch { } });
                    stderrRetry.on('data', (c: Buffer) => { try { retryOutput += c.toString('utf8'); } catch { } });

                    if (input) {
                        try { (streamRetry as NodeJS.WritableStream).write(input); } catch (w) { this.logger.warn('Failed to write input to retry exec stdin', w); }
                        try { (streamRetry as NodeJS.WritableStream).end(); } catch { }
                    }

                    await new Promise<void>((resolve, reject) => {
                        streamRetry.on && streamRetry.on('end', () => resolve());
                        streamRetry.on && streamRetry.on('close', () => resolve());
                        streamRetry.on && streamRetry.on('error', (err: any) => reject(err));
                    });

                    const retryInspect = await execRetry.inspect();
                    const retryExit = typeof retryInspect.ExitCode === 'number' ? retryInspect.ExitCode : -1;
                    if (retryExit === 0) {
                        this.logger.log(`Non-hijack exec retry succeeded in container ${containerIdOrName}`);
                        this.logger.debug(`Non-hijack exec output (truncated): ${retryOutput.slice(0, 2000)}`);
                        return { exitCode: retryExit, output: retryOutput };
                    }

                    this.logger.warn(`Non-hijack exec retry returned non-zero exit code ${retryExit} - falling back to helper container`);
                }
                catch (retryErr) {
                    this.logger.warn(`Non-hijack exec retry failed for container ${containerIdOrName}:`, retryErr);
                    // Helper container fallback is disabled - throw the original error
                    throw error;
                }

                // Helper container fallback has been disabled
                this.logger.error(`Both hijack and non-hijack exec attempts failed for container ${containerIdOrName}`);
                throw error;
            }

            if (msg && msg.includes('socket connection was closed unexpectedly')) {
                this.logger.error(`Failed to exec command in container ${containerIdOrName}: ${msg}. Consider retrying after container startup or using smaller payloads. To get more details, run with verbose fetch (docker-modem).`);
            }
            else {
                this.logger.error(`Failed to exec command in container ${containerIdOrName}:`, error);
            }
            throw error;
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
        }
        catch (err) {
            this.logger.error(`Failed to inspect container ${containerIdOrName} while preparing helper container:`, err);
            throw err;
        }

        const binds: string[] = [];
        try {
            const mounts = containerInfo?.Mounts || [];
            for (const m of mounts) {
                // For named volumes use the Name; for bind mounts use the host Source path
                if (m.Type === 'volume' && m.Name) {
                    binds.push(`${m.Name}:${m.Destination}`);
                }
                else if ((m.Type === 'bind' || m.Type === 'volume') && m.Source) {
                    binds.push(`${m.Source}:${m.Destination}`);
                }
            }
        }
        catch (err) {
            this.logger.warn(`Failed to build binds from mounts for container ${containerIdOrName}:`, err);
        }

        // If input was provided to the original exec call, note it here. We do not forward
        // stdin into the helper container for now (commands used in fallbacks are usually
        // non-interactive), but log its presence for diagnostics and to satisfy linting.
        if (typeof _input !== 'undefined') {
            this.logger.debug(`Helper fallback invoked with input length ${String(_input)?.length || 0} - input will not be forwarded to helper container.`);
        }

        // Ensure a small helper image is available
        const helperImage = 'alpine:latest';
        try {
            await this.pullImage(helperImage);
        }
        catch (pullErr) {
            this.logger.warn(`Could not pull helper image ${helperImage}, will still attempt to create container and rely on local image:`, pullErr);
        }

        // Create helper container
        const helperName = `deployer-helper-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const createOpts: Docker.ContainerCreateOptions = {
            Image: helperImage,
            Cmd: ['sh', '-c', command],
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
            const waitResult = await helperContainer.wait() as { StatusCode?: number } | undefined;
            const statusCode = typeof waitResult?.StatusCode === 'number' ? waitResult.StatusCode : -1;

            // Fetch logs
            let logs = '';
            try {
                logs = await this.getContainerLogs(helperContainer.id, { stdout: true, stderr: true, tail: 1000 });
            }
            catch (logErr) {
                this.logger.warn(`Failed to read logs from helper container ${helperName}:`, (logErr as Error)?.message || String(logErr));
            }

            // Clean up helper container
            try {
                await helperContainer.remove({ force: true });
            }
            catch (remErr) {
                this.logger.warn(`Failed to remove helper container ${helperName}:`, (remErr as Error)?.message || String(remErr));
            }

            if (statusCode !== 0) {
                this.logger.error(`Helper container ${helperName} exited with code ${statusCode}: ${logs}`);
                return { exitCode: statusCode, output: logs };
            }

            this.logger.debug(`Helper container ${helperName} completed successfully`);
            return { exitCode: 0, output: logs };
        }
        catch (err) {
            this.logger.error(`Helper container execution failed for ${containerIdOrName}:`, (err as any)?.message || String(err));
            // Attempt to clean up if container was created but not removed
            if (helperContainer) {
                try { await helperContainer.remove({ force: true }); } catch { }
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
                tail: options.tail || 200
             };
             const stream = (await container.logs(opts)) as unknown as NodeJS.ReadableStream;
             let logs = '';
             stream.on && stream.on('data', (chunk: Buffer) => { try { logs += chunk.toString('utf8'); } catch { } });
             await new Promise<void>((resolve, reject) => {
                 stream.on && stream.on('end', () => resolve());
                 stream.on && stream.on('close', () => resolve());
                 stream.on && stream.on('error', (err: any) => reject(err));
             });
             return logs;
         } catch (error: unknown) {
             this.logger.error(`Failed to fetch logs for container ${containerIdOrName}:`, (error as Error)?.message || String(error));
             throw error;
         }
     }

    /**
     * Attempt to detect the container id for the current process. Tries /proc/self/cgroup then falls back to hostname.
     */
    getSelfContainerId(): string | null {
        try {
            const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
            const lines = cgroup.split('\n');
            for (const line of lines) {
                // Docker cgroup lines often end with container id
                const parts = line.split(':');
                const candidate = parts[parts.length - 1] || '';
                if (candidate && candidate.length >= 12) {
                    // strip possible prefix like /docker/ or /kubepods/.../docker-<id>.scope
                    const m = candidate.match(/[0-9a-f]{12,64}/i);
                    if (m) return m[0];
                }
            }
        } catch { /* ignore */ }
        try {
            const hostname = fs.readFileSync('/etc/hostname', 'utf8').trim();
            if (hostname && hostname.length >= 12) return hostname;
        } catch { /* ignore */ }
        return null;
    }

    /**
     * Write a string as a file into a named volume at the given path.
     * Uses base64 to avoid shell quoting issues.
     */
    async putStringIntoVolume(volumeName: string, destPathInVolume: string, filename: string, content: string, retries = 3, backoffMs = 1000): Promise<void> {
        const helperImage = 'alpine:latest';
        try { await this.pullImage(helperImage); } catch { this.logger.debug(`Could not pull helper image ${helperImage} - proceeding if local image exists`); }

        const b64 = Buffer.from(content).toString('base64');
        const safeDest = destPathInVolume || '/';

        let lastErr: Error | null = null;
        for (let attempt = 1; attempt <= retries; attempt++) {
            const helperName = `deployer-putstr-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            const cmd = ['sh', '-c', `mkdir -p /target${safeDest} && printf '%s' '${b64}' | base64 -d > /target${safeDest}/${filename} && chown -R 1000:1000 /target${safeDest}/${filename}`];
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
                const waitRes = await helperContainer.wait();
                const status = (waitRes && (waitRes as any).StatusCode) || 0;
                const logs = await this.getContainerLogs(helperContainer.id, { stdout: true, stderr: true, tail: 200 });
                if (status !== 0) {
                    lastErr = new Error(`Helper putString exited ${status} - logs: ${logs}`);
                    this.logger.warn(`putString attempt ${attempt} failed for ${volumeName}${safeDest}/${filename}: ${lastErr.message}`);
                } else {
                    this.logger.log(`Wrote file ${filename} into volume ${volumeName} at ${safeDest} (attempt ${attempt})`);
                    try { await helperContainer.remove({ force: true }); } catch { }
                    return;
                }
            }
            catch (err) {
                lastErr = err as Error;
                this.logger.warn(`putString attempt ${attempt} failed for ${volumeName}${safeDest}/${filename}: ${lastErr.message}`);
                if (helperContainer) {
                    try { await helperContainer.remove({ force: true }); } catch { }
                }
            }

            if (attempt < retries) {
                this.logger.debug(`Retrying putString in ${backoffMs}ms (attempt ${attempt + 1}/${retries})`);
                await new Promise(r => setTimeout(r, backoffMs));
                backoffMs *= 2;
            }
        }

        throw new Error(`Failed to write file ${filename} into volume ${volumeName} after ${retries} attempts: ${(lastErr as Error)?.message || String(lastErr)}`);
    }

    /**
     * Copy files from a container to a Docker volume using native Dockerode operations.
     * This method creates a temporary container with the volume mounted, extracts files from source,
     * and puts them into the volume - all without needing a persistent helper container.
     */
    async copyFromContainerToVolume(
        sourceContainerIdOrName: string,
        sourcePath: string,
        volumeName: string,
        destPathInVolume: string
    ): Promise<void> {
        this.logger.log(`Copying from container ${sourceContainerIdOrName}:${sourcePath} into volume ${volumeName}:${destPathInVolume}`);
        
        const sourceContainer = this.docker.getContainer(sourceContainerIdOrName);
        
        // Create a one-shot container to receive the archive
        // This container will mount the volume, receive the tar stream, extract it, and exit
        const helperImage = 'alpine:latest';
        try { 
            await this.pullImage(helperImage); 
        } catch { 
            this.logger.debug('Could not pull helper image - will use local copy if available'); 
        }
        
        const helperName = `deployer-copy-${Date.now()}-${Math.floor(Math.random()*10000)}`;
        const createOpts: Docker.ContainerCreateOptions = {
            Image: helperImage,
            name: helperName,
            HostConfig: {
                Binds: [`${volumeName}:/target`],
                AutoRemove: false, // We'll remove manually after verification
            },
            // Use a sleep command to keep container alive for our operations
            Cmd: ['sh', '-c', 'sleep 60'],
            Tty: false,
        };
        
        let helperContainer: Docker.Container | null = null;
        try {
            this.logger.debug(`Creating helper container ${helperName} for volume copy`);
            helperContainer = await this.docker.createContainer(createOpts);
            
            // Start container to create directory structure first
            await helperContainer.start();
            
            // Create the parent directory structure
            const parentDir = destPathInVolume.substring(0, destPathInVolume.lastIndexOf('/')) || destPathInVolume;
            this.logger.debug(`Creating directory structure: /target${parentDir}`);
            try {
                const mkdirExec = await helperContainer.exec({ 
                    Cmd: ['sh', '-c', `mkdir -p /target${parentDir} && chmod 755 /target${parentDir}`], 
                    AttachStdout: true, 
                    AttachStderr: true 
                });
                const mkdirStream = await mkdirExec.start({ hijack: false, stdin: false });
                await this.waitForStreamEnd(mkdirStream as NodeJS.ReadableStream, 2000);
            } catch (mkdirErr) {
                this.logger.warn(`Failed to create parent directory (continuing anyway): ${(mkdirErr as Error)?.message || String(mkdirErr)}`);
            }
            
            // Get archive stream from source container and save to temp file
            // Using a temp file avoids Docker API's chunked encoding issues with putArchive
            this.logger.debug(`Getting archive from ${sourceContainerIdOrName}:${sourcePath}`);
            const archiveStream = await sourceContainer.getArchive({ path: sourcePath }) as NodeJS.ReadableStream;
            
            // Write archive to temporary file
            const { createWriteStream } = await import('fs');
            const { unlink } = await import('fs/promises');
            const tempTarPath = `/tmp/deployer-archive-${Date.now()}-${Math.floor(Math.random()*10000)}.tar`;
            this.logger.debug(`Writing archive to temp file: ${tempTarPath}`);
            
            const writeStream = createWriteStream(tempTarPath);
            archiveStream.pipe(writeStream);
            
            await new Promise<void>((resolve, reject) => {
                writeStream.on('finish', () => resolve());
                writeStream.on('error', (err) => reject(err));
                archiveStream.on('error', (err) => reject(err));
            });
            
            const { statSync, readFileSync } = await import('fs');
            const tarSize = statSync(tempTarPath).size;
            this.logger.debug(`Wrote ${tarSize} bytes to temp tar file`);
            
            // Since putArchive has issues with chunked encoding even from files,
            // use docker cp via exec to extract the tar directly
            const extractPath = `/target${parentDir}`;
            this.logger.debug(`Extracting tar using exec in ${helperName} at ${extractPath}`);
            
            try {
                // Read tar file as base64 to safely transfer via exec
                const tarBuffer = readFileSync(tempTarPath);
                const tarBase64 = tarBuffer.toString('base64');
                
                // Create the exact destination directory first
                const finalDestPath = `/target${destPathInVolume}`;
                const mkdirFinalExec = await helperContainer.exec({
                    Cmd: ['sh', '-c', `mkdir -p ${finalDestPath}`],
                    AttachStdout: true,
                    AttachStderr: true
                });
                const mkdirFinalStream = await mkdirFinalExec.start({ hijack: false, stdin: false });
                await this.waitForStreamEnd(mkdirFinalStream as NodeJS.ReadableStream, 2000);
                
                // The tar archive from getArchive contains the directory itself as the first entry,
                // so we use --strip-components=1 to remove it and extract files directly
                const extractCmd = `echo '${tarBase64}' | base64 -d | tar -xf - -C ${finalDestPath} --strip-components=1`;
                const extractExec = await helperContainer.exec({ 
                    Cmd: ['sh', '-c', extractCmd], 
                    AttachStdout: true, 
                    AttachStderr: true 
                });
                const extractStream = await extractExec.start({ hijack: false, stdin: false });
                const extractOutput = await this.captureStreamOutput(extractStream as NodeJS.ReadableStream, 5000);
                
                const extractInspect = await extractExec.inspect();
                if (extractInspect.ExitCode !== 0) {
                    throw new Error(`Tar extraction failed with exit code ${extractInspect.ExitCode}: ${extractOutput}`);
                }
                
                this.logger.debug(`Successfully extracted tar to ${finalDestPath} with strip-components=1`);
            } finally {
                // Clean up temp file
                try {
                    await unlink(tempTarPath);
                    this.logger.debug(`Deleted temp tar file ${tempTarPath}`);
                } catch (unlinkErr) {
                    this.logger.warn(`Failed to delete temp tar file (non-fatal): ${(unlinkErr as Error)?.message}`);
                }
            }
            
            this.logger.log(`Successfully copied archive into volume ${volumeName}${destPathInVolume}`);
            
            // Container is already running, now run verification and permission fixes
            this.logger.debug(`Running post-copy operations on ${helperName}`);
            
            // Fix permissions (set to lighttpd user 100:101)
            try {
                const chownCmd = `chown -R 100:101 /target${destPathInVolume} 2>/dev/null || true`;
                const chownExec = await helperContainer.exec({ 
                    Cmd: ['sh', '-c', chownCmd], 
                    AttachStdout: true, 
                    AttachStderr: true 
                });
                const chownStream = await chownExec.start({ hijack: false, stdin: false });
                await this.waitForStreamEnd(chownStream as NodeJS.ReadableStream, 3000);
                this.logger.debug('Set ownership to 100:101 for lighttpd');
            } catch (chownErr) {
                this.logger.warn(`Failed to set ownership (non-fatal): ${(chownErr as Error)?.message || String(chownErr)}`);
            }
            
            // Set file permissions
            try {
                const chmodCmd = `find /target${destPathInVolume} -type f -exec chmod 644 {} \\; && find /target${destPathInVolume} -type d -exec chmod 755 {} \\;`;
                const chmodExec = await helperContainer.exec({ 
                    Cmd: ['sh', '-c', chmodCmd], 
                    AttachStdout: true, 
                    AttachStderr: true 
                });
                const chmodStream = await chmodExec.start({ hijack: false, stdin: false });
                await this.waitForStreamEnd(chmodStream as NodeJS.ReadableStream, 3000);
                this.logger.debug('Set permissions: 644 for files, 755 for directories');
            } catch (chmodErr) {
                this.logger.warn(`Failed to set permissions (non-fatal): ${(chmodErr as Error)?.message || String(chmodErr)}`);
            }
            
            // Verify files were copied
            // Add sync command to ensure files are flushed to disk before verification
            try {
                const verifyCmd = `sync && sleep 0.5 && ls -la /target${destPathInVolume} && find /target${destPathInVolume} -type f | wc -l`;
                const verifyExec = await helperContainer.exec({ 
                    Cmd: ['sh', '-c', verifyCmd], 
                    AttachStdout: true, 
                    AttachStderr: true 
                });
                const verifyStream = await verifyExec.start({ hijack: false, stdin: false });
                const output = await this.captureStreamOutput(verifyStream as NodeJS.ReadableStream, 3000);
                
                // Debug: log the raw output
                this.logger.debug(`Verification raw output: ${JSON.stringify(output)}`);
                
                const lines = output.split('\n');
                this.logger.debug(`Verification lines: ${JSON.stringify(lines)}`);
                
                const lastLine = lines[lines.length - 1]?.trim() || lines[lines.length - 2]?.trim();
                const filesCount = Number(lastLine) || 0;
                
                this.logger.log(`Verification: ${filesCount} files found in ${volumeName}${destPathInVolume} (last line: "${lastLine}")`);

                
                if (filesCount === 0) {
                    throw new Error('Archive extracted but no files found in destination');
                }
            } catch (verifyErr) {
                this.logger.error(`Post-copy verification failed: ${(verifyErr as Error)?.message || String(verifyErr)}`);
                throw verifyErr;
            }
            
            // Clean up helper container
            try { 
                await helperContainer.stop({ t: 1 }); 
            } catch {
                // Container might have already exited
                this.logger.debug('Container already stopped');
            }
            
            try { 
                await helperContainer.remove({ force: true }); 
                this.logger.debug(`Removed helper container ${helperName}`);
            } catch (removeErr) {
                this.logger.warn(`Failed to remove helper container: ${(removeErr as Error)?.message || String(removeErr)}`);
            }
            
        } catch (err) {
            this.logger.error(`Failed to copy from ${sourceContainerIdOrName}:${sourcePath} to volume ${volumeName}:${destPathInVolume}:`, (err as Error)?.message || String(err));
            
            // Clean up on error
            if (helperContainer) {
                try { 
                    await helperContainer.remove({ force: true }); 
                } catch (cleanupErr) {
                    this.logger.debug('Failed to cleanup helper container:', (cleanupErr as Error)?.message);
                }
            }
            
            throw err;
        }
    }
    
    /**
     * Helper method to wait for a stream to end with timeout
     */
    private async waitForStreamEnd(stream: NodeJS.ReadableStream, timeoutMs: number = 5000): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                resolve(); // Don't reject on timeout, just continue
            }, timeoutMs);
            
            stream.on('end', () => {
                clearTimeout(timeout);
                resolve();
            });
            
            stream.on('error', (err) => {
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
    private async captureStreamOutput(stream: NodeJS.ReadableStream, timeoutMs: number = 5000): Promise<string> {
        return new Promise((resolve, reject) => {
            let output = '';
            const timeout = setTimeout(() => {
                resolve(output); // Return what we have so far
            }, timeoutMs);
            
            stream.on('data', (chunk) => {
                // Docker exec streams are multiplexed with 8-byte headers
                // Format: [stream_type, 0, 0, 0, size_bytes(4)]
                // We need to strip these headers to get clean output
                let data = chunk.toString();
                
                // Remove Docker stream headers (8 bytes at start of each chunk)
                // Header format: 1 byte type, 3 bytes padding, 4 bytes size
                if (Buffer.isBuffer(chunk) && chunk.length > 8) {
                    // Check if this looks like a Docker stream header
                    const streamType = chunk[0];
                    if (streamType === 1 || streamType === 2) { // stdout or stderr
                        // Skip the 8-byte header
                        data = chunk.slice(8).toString();
                    }
                }
                
                output += data;
            });
            
            stream.on('end', () => {
                clearTimeout(timeout);
                resolve(output);
            });
            
            stream.on('error', (err) => {
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
        const helperImage = 'alpine:latest';
        try {
            await this.pullImage(helperImage);
        }
        catch (pullErr) {
            this.logger.warn(`Could not pull helper image ${helperImage}, proceeding with local image if available:`, pullErr);
        }

        const helperName = `deployer-vol-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const createOpts: Docker.ContainerCreateOptions = {
            Image: helperImage,
            Cmd: ['sh', '-c', command],
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
            const waitPromise = helperContainer.wait() as Promise<{ StatusCode?: number } | undefined>;
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Container wait timeout after 120 seconds')), 120000);
            });
            
            const waitResult = await Promise.race([waitPromise, timeoutPromise]);
            const statusCode = typeof waitResult?.StatusCode === 'number' ? waitResult.StatusCode : -1;

            // Fetch logs
            let logs = '';
            try {
                logs = await this.getContainerLogs(helperContainer.id, { stdout: true, stderr: true, tail: 1000 });
            }
            catch (logErr) {
                this.logger.warn(`Failed to read logs from helper container ${helperName}:`, (logErr as Error)?.message || String(logErr));
            }

            // Clean up helper container
            try {
                await helperContainer.remove({ force: true });
            }
            catch (remErr) {
                this.logger.warn(`Failed to remove helper container ${helperName}:`, (remErr as Error)?.message || String(remErr));
            }

            if (statusCode !== 0) {
                this.logger.error(`Helper container ${helperName} exited with code ${statusCode}: ${logs}`);
                return { exitCode: statusCode, output: logs };
            }

            this.logger.debug(`Helper container ${helperName} completed successfully`);
            return { exitCode: 0, output: logs };
        }
        catch (err) {
            const errorMessage = (err as any)?.message || String(err);
            this.logger.error(`Helper container execution failed for volume ${volumeName}: ${errorMessage}`);
            
            // Attempt to clean up if container was created but not removed
            if (helperContainer) {
                try { 
                    await helperContainer.remove({ force: true }); 
                    this.logger.debug(`Cleaned up helper container ${helperName} after error`);
                } catch (removeErr) {
                    this.logger.warn(`Failed to clean up helper container ${helperName}: ${(removeErr as any)?.message}`);
                }
            }
            
            // If it was a timeout, return a specific error response instead of throwing
            if (errorMessage.includes('timeout')) {
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
            
            if (!containers || containers.length === 0) {
                this.logger.debug('No running containers found to search');
                return null;
            }

            this.logger.debug(`Searching through ${containers.length} running containers for path ${searchPath}`);

            // Check each container for the path
            for (const containerInfo of containers) {
                const containerId = containerInfo.Id;
                const containerName = containerInfo.Names?.[0] || containerId;

                try {
                    // Try to check if path exists in this container
                    const checkCmd = ['sh', '-c', `test -e "${searchPath}" && echo "EXISTS" || echo "NOT_FOUND"`];
                    
                    // Use a simpler approach - try to inspect the path via container exec
                    const container = this.docker.getContainer(containerId);
                    const exec = await container.exec({
                        Cmd: checkCmd,
                        AttachStdout: true,
                        AttachStderr: true,
                    });

                    const stream = await exec.start({ hijack: false, stdin: false }) as NodeJS.ReadableStream;
                    
                    let output = '';
                    stream.on && stream.on('data', (chunk: Buffer) => {
                        try { output += chunk.toString('utf8'); } catch { }
                    });

                    await new Promise<void>((resolve) => {
                        stream.on && stream.on('end', () => resolve());
                        stream.on && stream.on('close', () => resolve());
                        // Timeout after 2 seconds
                        setTimeout(() => resolve(), 2000);
                    });

                    const execInspect = await exec.inspect();
                    const exitCode = typeof execInspect.ExitCode === 'number' ? execInspect.ExitCode : -1;

                    if (exitCode === 0 && output.includes('EXISTS')) {
                        this.logger.log(`Found path ${searchPath} in container ${containerName} (${containerId})`);
                        return containerId;
                    }

                    this.logger.debug(`Path ${searchPath} not found in container ${containerName} (exit=${exitCode}, output=${output.trim()})`);
                } catch (execErr) {
                    // If exec fails (e.g., no sh available), try alternative approach or skip
                    this.logger.debug(`Could not check path in container ${containerName}: ${(execErr as Error)?.message || String(execErr)}`);
                    
                    // Try alternative: check using stat or ls
                    try {
                        const altCmd = ['test', '-e', searchPath];
                        const container = this.docker.getContainer(containerId);
                        const altExec = await container.exec({
                            Cmd: altCmd,
                            AttachStdout: true,
                            AttachStderr: true,
                        });

                        const altStream = await altExec.start({ hijack: false, stdin: false }) as NodeJS.ReadableStream;
                        
                        await new Promise<void>((resolve) => {
                            altStream.on && altStream.on('end', () => resolve());
                            altStream.on && altStream.on('close', () => resolve());
                            setTimeout(() => resolve(), 2000);
                        });

                        const altInspect = await altExec.inspect();
                        const altExitCode = typeof altInspect.ExitCode === 'number' ? altInspect.ExitCode : -1;

                        if (altExitCode === 0) {
                            this.logger.log(`Found path ${searchPath} in container ${containerName} (${containerId}) using test command`);
                            return containerId;
                        }
                    } catch (altErr) {
                        this.logger.debug(`Alternative check also failed for ${containerName}: ${(altErr as Error)?.message || String(altErr)}`);
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
    imagePullPolicy?: 'IfNotPresent' | 'Always' | 'Never';
    registryAuth?: Docker.AuthConfig;
}
