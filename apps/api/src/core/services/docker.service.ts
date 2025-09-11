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
    }): Promise<string> {
        const { image, name, deploymentId, envVars = {}, ports = {} } = options;
        this.logger.log(`Creating container ${name} from image ${image}`);
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
        const container = await this.docker.createContainer({
            Image: image,
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
        this.logger.log(`Container ${name} started with ID ${containerInfo.Id}`);
        return containerInfo.Id;
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
        try {
            const container = await this.docker.createContainer(options);
            this.logger.log(`Created container ${container.id}`);
            return container;
        }
        catch (error) {
            this.logger.error('Failed to create container:', error);
            throw error;
        }
    }
    async stopContainer(containerId: string): Promise<void> {
        try {
            const container = this.docker.getContainer(containerId);
            await container.stop({ t: 10 });
            this.logger.log(`Stopped container ${containerId}`);
        }
        catch (error) {
            this.logger.error(`Failed to stop container ${containerId}:`, error);
            throw error;
        }
    }
    async getContainerInfo(containerId: string): Promise<any> {
        try {
            const container = this.docker.getContainer(containerId);
            const info = await container.inspect();
            return info;
        }
        catch (error) {
            this.logger.error(`Failed to get container info for ${containerId}:`, error);
            throw error;
        }
    }
    async listContainers(options: any = {}): Promise<any[]> {
        try {
            // Force the typing since TypeScript is having issues with dockerode
            const dockerInstance = this.docker as any;
            const containers = await dockerInstance.listContainers(options);
            return containers || [];
        }
        catch (error) {
            this.logger.error('Failed to list containers:', error);
            return [];
        }
    }
    private async followStream(stream: NodeJS.ReadableStream): Promise<void> {
        return new Promise((resolve, reject) => {
            this.docker.modem.followProgress(stream, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            }, (event) => {
                if (event.stream) {
                    this.logger.debug(event.stream.trim());
                }
                if (event.error) {
                    this.logger.error(event.error);
                }
            });
        });
    }

    async getContainerStats(containerId: string): Promise<any> {
        try {
            const container = this.docker.getContainer(containerId);
            const stats = await container.stats({ stream: false });
            return stats;
        }
        catch (error) {
            this.logger.error(`Failed to get container stats for ${containerId}:`, error);
            throw error;
        }
    }

    /**
     * Get the Docker client instance for advanced usage
     */
    getDockerClient(): Docker {
        return this.docker;
    }
}
