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
        registryAuth?: any;
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
            if ((imagePullPolicy as any) === 'Always') return true;
            if ((imagePullPolicy as any) === 'Never') return false;
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
                    this.logger.warn(`Initial pull failed for ${image}: ${(pullErr as any)?.message || String(pullErr)}`);
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
                        if ((imagePullPolicy as any) !== 'Never') {
                            await this.pullImage(img, registryAuth);
                        } else {
                            this.logger.warn(`ImagePullPolicy set to 'Never' - skipping pull for ${img}`);
                            continue;
                        }
                        this.logger.log(`Successfully pulled image ${img}. Retrying container creation...`);
                        return await attemptCreate(img);
                    } catch (pullErr) {
                        lastPullError = pullErr;
                        this.logger.warn(`Pulling image ${img} failed: ${(pullErr as any)?.message || String(pullErr)}`);
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
            let resources: any = {};
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

            const result = {
                isHealthy: containerInfo.State.Status === 'running',
                status: containerInfo.State.Status,
                uptime: Math.floor(uptime / 1000), // in seconds
                restartCount: containerInfo.RestartCount || 0,
                lastStarted: containerInfo.State.StartedAt ? new Date(containerInfo.State.StartedAt) : null,
                resources,
            };

            // Add health check details if available
            if (containerInfo.State.Health) {
                (result as any).healthChecks = {
                    status: containerInfo.State.Health.Status,
                    failingStreak: containerInfo.State.Health.FailingStreak || 0,
                    log: containerInfo.State.Health.Log?.slice(-5) || [], // Last 5 health check logs
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
    async createContainer(options: any): Promise<any> {
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
                let lastErr: any = null;
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
                        lastErr = pullErr;
                        this.logger.warn(`Pull attempt failed for ${imgName}: ${(pullErr as any)?.message || String(pullErr)}`);
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
        catch (error: any) {
            this.logger.error('Failed to create container:', error);
            // Detect image-not-found errors and attempt pull+retry
            const errMsg = (error && (error.json && error.json.message || error.message || String(error))).toLowerCase();
            if (errMsg.includes('no such image') || errMsg.includes('not found') || errMsg.includes('manifest unknown')) {
                const imagesToTry = [requestedImage];
                if (requestedImage === 'nginx:alpine') {
                    imagesToTry.push('nginx:latest', 'nginx:stable-alpine');
                }
                let lastErr: any = null;
                for (const img of imagesToTry) {
                    try {
                        this.logger.log(`Pulling image for container creation (retry path): ${img}`);
                        if ((imagePullPolicy as any) !== 'Never') {
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
                        lastErr = pullErr;
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
    async pullImage(image: string, registryAuth?: any, retries = 3, backoffMs = 2000): Promise<void> {
        this.logger.log(`Attempting to pull image ${image} (retries=${retries})`);
        let lastErr: any = null;
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const pullOpts: any = {};
                if (registryAuth) {
                    pullOpts.authconfig = registryAuth;
                }
                const stream: NodeJS.ReadableStream = await (this.docker.pull as any)(image, pullOpts);
                await this.followStream(stream);
                // Successful pull
                this.logger.log(`Successfully pulled ${image} on attempt ${attempt}`);
                return;
            } catch (err) {
                lastErr = err;
                this.logger.warn(`Pull attempt ${attempt} failed for ${image}: ${(err as any)?.message || String(err)}`);
                if (attempt < retries) {
                    this.logger.log(`Waiting ${backoffMs}ms before next pull attempt...`);
                    await new Promise((r) => setTimeout(r, backoffMs));
                    backoffMs *= 2; // exponential backoff
                }
            }
        }
        this.logger.error(`All pull attempts failed for image ${image}`);
        throw new Error(`Failed to pull image ${image}: ${(lastErr as any)?.message || String(lastErr)}`);
    }

    private async followStream(stream: NodeJS.ReadableStream): Promise<void> {
        return new Promise((resolve, reject) => {
            this.docker.modem.followProgress(stream, (err: any) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            }, (event: any) => {
                if (event.stream) {
                    this.logger.debug(event.stream.trim());
                }
                if (event.status) {
                    this.logger.debug(event.status);
                }
                if (event.error) {
                    this.logger.error(event.error);
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
    async getContainerInfo(containerIdOrName: string): Promise<any> {
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
    async listContainers(options: any = {}): Promise<any[]> {
        try {
            const list = await (this.docker as any).listContainers(options);
            return list || [];
        } catch (error) {
            this.logger.error('Failed to list containers:', error);
            return [];
        }
    }

    async getContainerStats(containerId: string): Promise<any> {
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
                    stream.write(input);
                }
                catch (writeErr) {
                    this.logger.warn('Failed to write to exec stdin:', writeErr);
                }
                try {
                    stream.end();
                }
                catch { }
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
     * Connect a container to a docker network by name or id.
     */
    async connectContainerToNetwork(containerIdOrName: string, networkNameOrId: string): Promise<void> {
        try {
            // First, ensure the container is not already attached to the target network
            try {
                const container = this.docker.getContainer(containerIdOrName);
                const info = await container.inspect();
                const networks = info?.NetworkSettings?.Networks || {};
                if (networks[networkNameOrId] || Object.keys(networks).some(n => n === networkNameOrId)) {
                    this.logger.debug(`Container ${containerIdOrName} is already connected to network ${networkNameOrId}`);
                    return;
                }
            }
            catch (inspectErr) {
                this.logger.debug(`Could not inspect container ${containerIdOrName} before network connect: ${(inspectErr as any)?.message || String(inspectErr)}`);
            }

            const networks = await this.docker.listNetworks({});
            const target = networks.find(n => n.Name === networkNameOrId || n.Id === networkNameOrId);
            if (!target) {
                this.logger.warn(`Network ${networkNameOrId} not found - cannot connect container ${containerIdOrName}`);
                return;
            }
            const network = this.docker.getNetwork(target.Id);
            await network.connect({ Container: containerIdOrName });
            this.logger.log(`Connected container ${containerIdOrName} to network ${target.Name} (${target.Id})`);
        } catch (error: any) {
            // If the endpoint already exists, treat as a no-op (container already connected).
            const message = (error && (error.message || String(error))).toLowerCase();
            if (message.includes('endpoint with name') && message.includes('already exists')) {
                this.logger.debug(`Endpoint already exists when connecting ${containerIdOrName} to ${networkNameOrId} - treating as already connected`);
                return;
            }
            this.logger.error(`Failed to connect container ${containerIdOrName} to network ${networkNameOrId}:`, error);
            throw error;
        }
    }

    async getNetworkInfo(networkNameOrId: string): Promise<any> {
        try {
            const networks = await this.docker.listNetworks({ filters: { name: [networkNameOrId] } });
            if (!networks || networks.length === 0) {
                throw new Error(`Network ${networkNameOrId} not found`);
            }
            const network = this.docker.getNetwork(networks[0].Id);
            const info = await network.inspect();
            return info;
        } catch (error) {
            this.logger.error(`Failed to get network info for ${networkNameOrId}:`, error);
            throw error;
        }
    }

    async getContainerLogs(containerIdOrName: string, options: { stdout?: boolean; stderr?: boolean; tail?: number } = { stdout: true, stderr: true, tail: 200 }): Promise<string> {
        try {
            const container = this.docker.getContainer(containerIdOrName);
            const opts: any = {
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
        } catch (error) {
            this.logger.error(`Failed to fetch logs for container ${containerIdOrName}:`, error);
            throw error;
        }
    }
}
