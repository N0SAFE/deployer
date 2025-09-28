import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, desc, and, count } from 'drizzle-orm';
import { db } from '../modules/db/drizzle/index';
import { deployments, deploymentLogs, deploymentStatusEnum, logLevelEnum, previewEnvironments } from '../modules/db/drizzle/schema/deployment';
import { DockerService } from './docker.service';
import { StaticFileService } from './static-file.service';
import * as fs from 'fs/promises';
import * as path from 'path';
// Type aliases based on the actual schema
type DeploymentStatus = typeof deploymentStatusEnum.enumValues[number];
type LogLevel = typeof logLevelEnum.enumValues[number];
type SelectDeployment = typeof deployments.$inferSelect;
type InsertDeployment = typeof deployments.$inferInsert;
type SelectDeploymentLog = typeof deploymentLogs.$inferSelect;
type InsertDeploymentLog = typeof deploymentLogs.$inferInsert;
export interface CreateDeploymentData {
    serviceId: string;
    sourceType: 'github' | 'gitlab' | 'git' | 'upload' | 'custom';
    sourceConfig: {
        repositoryUrl?: string;
        branch?: string;
        commitSha?: string;
        pullRequestNumber?: number;
        fileName?: string;
        fileSize?: number;
        customData?: Record<string, any>;
    };
    triggeredBy?: string;
    environment?: 'production' | 'staging' | 'preview' | 'development';
    metadata?: Record<string, any>;
}
export interface DeploymentLogData {
    level: LogLevel;
    message: string;
    phase?: string;
    step?: string;
    service?: string;
    stage?: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

interface DeploymentConfig {
    deploymentId: string;
    serviceName: string;
    sourcePath: string;
    buildType?: string;
    environmentVariables?: Record<string, string>;
    healthCheckPath?: string;
    resourceLimits?: {
        memory?: string;
        cpu?: string;
        storage?: string;
    };
    // Static site specific
    outputDirectory?: string;
    projectId?: string;
    domain?: string;
    subdomain?: string;
    sslEnabled?: boolean;
    sourceConfig?: {
        filePath?: string;
        [key: string]: any;
    };
    // Docker specific
    dockerfilePath?: string;
    buildArgs?: Record<string, string>;
    port?: number;
    buildConfig?: {
        buildContext?: string;
        dockerfilePath?: string;
        buildArgs?: Record<string, string>;
        [key: string]: any;
    };
    // Node.js specific
    buildCommand?: string;
    startCommand?: string;
    installCommand?: string;
}

export interface DeploymentResult {
    deploymentId: string;
    containerIds: string[];
    status: 'success' | 'failed' | 'partial';
    domain?: string;
    healthCheckUrl?: string;
    message: string;
    metadata?: Record<string, any>;
}

export interface ContainerStatus {
    containerId: string;
    containerName: string;
    status: 'running' | 'stopped' | 'error';
    healthy: boolean;
    uptime?: number;
    metadata?: Record<string, any>;
}
@Injectable()
export class DeploymentService {
    private readonly logger = new Logger(DeploymentService.name);

    constructor(
        private readonly dockerService: DockerService,
        private readonly staticFileService: StaticFileService
    ) {}

    /**
     * Deploy a service based on its configuration
     */
    async deployService(config: DeploymentConfig): Promise<DeploymentResult> {
        const { deploymentId, buildType, serviceName } = config;
        
        this.logger.log(`Starting deployment ${deploymentId} for service ${serviceName} (type: ${buildType})`);
        
        // Update deployment status to building
        await this.updateDeploymentStatus(deploymentId, 'building');
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: `Starting ${buildType} deployment`,
            phase: 'build',
            step: 'initialize',
            service: 'deployment-service',
            stage: 'setup',
            timestamp: new Date()
        });

        try {
            let result: DeploymentResult;

            switch (buildType) {
                case 'static':
                    result = await this.deployStaticSite(config);
                    break;
                case 'docker':
                case 'dockerfile':
                    result = await this.deployDockerService(config);
                    break;
                case 'nodejs':
                    result = await this.deployNodejsService(config);
                    break;
                case 'python':
                    result = await this.deployPythonService(config);
                    break;
                default:
                    throw new Error(`Unsupported build type: ${buildType}`);
            }

            // Update deployment status based on result
            if (result.status === 'success') {
                await this.updateDeploymentStatus(deploymentId, 'success');
                await this.addDeploymentLog(deploymentId, {
                    level: 'info',
                    message: 'Deployment completed successfully',
                    phase: 'deployment',
                    step: 'completion',
                    service: 'deployment-service',
                    stage: 'success',
                    timestamp: new Date()
                });
            } else {
                await this.updateDeploymentStatus(deploymentId, 'failed');
                await this.addDeploymentLog(deploymentId, {
                    level: 'error',
                    message: `Deployment failed: ${result.message}`,
                    phase: 'deployment',
                    step: 'error',
                    service: 'deployment-service',
                    stage: 'error',
                    timestamp: new Date()
                });
            }

            return result;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Deployment ${deploymentId} failed:`, error);
            
            await this.updateDeploymentStatus(deploymentId, 'failed');
            await this.addDeploymentLog(deploymentId, {
                level: 'error',
                message: `Deployment failed: ${errorMsg}`,
                phase: 'deployment',
                step: 'error',
                service: 'deployment-service',
                stage: 'error',
                timestamp: new Date(),
                metadata: { errorStack: error instanceof Error ? error.stack : undefined }
            });

            return {
                deploymentId,
                containerIds: [],
                status: 'failed',
                message: errorMsg
            };
        }
    }

    /**
     * Deploy static files (HTML, CSS, JS, etc.)
     */
    public async deployStaticSite(config: DeploymentConfig): Promise<DeploymentResult> {
        const { deploymentId, serviceName, domain, subdomain } = config;
        
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: 'Deploying static site with nginx',
            phase: 'deployment',
            step: 'static-setup',
            service: 'static-file-service',
            timestamp: new Date()
        });

        // Determine sourcePath for static files (extracted files path)
        const sourcePath = config.sourceConfig?.filePath || config.sourcePath || undefined;
        // Deploy using project-level static file service
        const nginxInfo = await this.staticFileService.deployStaticFiles({
            serviceName,
            deploymentId,
            projectId: config.projectId,
            domain: domain || 'localhost',
            subdomain,
            sourcePath,
        } as any);

        // Update deployment record with project server container info
        await this.updateDeploymentContainer(deploymentId, nginxInfo.containerName, nginxInfo.imageUsed || `lighttpd:alpine`);

        const healthCheckUrl = `http://${nginxInfo.domain}/health`;
        
        // Verify deployment is healthy by checking the project server container and health endpoint
        const isHealthy = await this.verifyContainerHealth(nginxInfo.containerId, healthCheckUrl);
        
        return {
            deploymentId,
            containerIds: [nginxInfo.containerId],
            status: isHealthy ? 'success' : 'partial',
            domain: nginxInfo.domain,
            healthCheckUrl,
            message: isHealthy ? 'Static site deployed successfully' : 'Static site deployed but health check failed',
            metadata: {
                containerName: nginxInfo.containerName,
                serverImage: nginxInfo.imageUsed || 'rtsp/lighttpd',
            }
        };
    }

    /**
     * Deploy a Docker service using Dockerfile
     */
    public async deployDockerService(config: DeploymentConfig): Promise<DeploymentResult> {
        const { deploymentId, serviceName, sourcePath, environmentVariables } = config;
        
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: 'Building Docker image',
            phase: 'build',
            step: 'docker-build',
            service: 'docker-service',
            timestamp: new Date()
        });

        // Build Docker image from the prepared source path
        const imageTag = `${serviceName}:${deploymentId.substring(0, 8)}`;
        
        // Use the sourcePath provided by prepareSourceCode (contains cloned repo or extracted files)
        await this.dockerService.buildImage(sourcePath, imageTag);

        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: `Docker image built: ${imageTag}`,
            phase: 'build',
            step: 'image-ready',
            service: 'docker-service',
            timestamp: new Date()
        });

        // Create and start container
        const containerName = `${serviceName}-${deploymentId.substring(0, 8)}`;
        const ports = config.port ? { [config.port]: config.port.toString() } : {};
        
        const containerId = await this.dockerService.createAndStartContainer({
            image: imageTag,
            name: containerName,
            deploymentId,
            envVars: environmentVariables,
            ports
        });

        // Update deployment record
        await this.updateDeploymentContainer(deploymentId, containerName, imageTag);

        // Verify container health
        const healthCheckPath = config.healthCheckPath || '/health';
        const healthCheckUrl = config.port ? 
            `http://localhost:${config.port}${healthCheckPath}` : 
            `http://${containerName}${healthCheckPath}`;
        
        const isHealthy = await this.verifyContainerHealth(containerId, healthCheckUrl);

        return {
            deploymentId,
            containerIds: [containerId],
            status: isHealthy ? 'success' : 'partial',
            healthCheckUrl,
            message: isHealthy ? 'Docker service deployed successfully' : 'Docker service deployed but health check failed',
            metadata: {
                containerName,
                imageTag,
                port: config.port
            }
        };
    }

    /**
     * Deploy Node.js application using automatic Dockerfile generation
     */
    public async deployNodejsService(config: DeploymentConfig): Promise<DeploymentResult> {
        const { deploymentId, buildConfig } = config;
        
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: 'Generating Node.js Dockerfile',
            phase: 'build',
            step: 'dockerfile-generation',
            service: 'deployment-service',
            timestamp: new Date()
        });

        // Generate optimized Dockerfile for Node.js
        const dockerfile = this.generateNodejsDockerfile(buildConfig);
        const buildContext = buildConfig?.buildContext || './';
        
        // Write Dockerfile to build context
        await fs.writeFile(path.join(buildContext, 'Dockerfile'), dockerfile);

        // Continue with Docker deployment
        return this.deployDockerService({
            ...config,
            buildType: 'dockerfile',
            buildConfig: {
                ...buildConfig,
                dockerfilePath: 'Dockerfile'
            }
        });
    }

    /**
     * Deploy Python application using automatic Dockerfile generation
     */
    public async deployPythonService(config: DeploymentConfig): Promise<DeploymentResult> {
        const { deploymentId, buildConfig } = config;
        
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: 'Generating Python Dockerfile',
            phase: 'build',
            step: 'dockerfile-generation',
            service: 'deployment-service',
            timestamp: new Date()
        });

        // Generate optimized Dockerfile for Python
        const dockerfile = this.generatePythonDockerfile(buildConfig);
        const buildContext = buildConfig?.buildContext || './';
        
        // Write Dockerfile to build context
        await fs.writeFile(path.join(buildContext, 'Dockerfile'), dockerfile);

        // Continue with Docker deployment
        return this.deployDockerService({
            ...config,
            buildType: 'dockerfile',
            buildConfig: {
                ...buildConfig,
                dockerfilePath: 'Dockerfile'
            }
        });
    }

    /**
     * Get comprehensive status of a deployment including all containers
     */
    async getDeploymentContainerStatus(deploymentId: string): Promise<{
        deploymentId: string;
        status: string;
        containers: ContainerStatus[];
        healthStatus: 'healthy' | 'unhealthy' | 'partial' | 'unknown';
        lastChecked: Date;
    }> {
        // Get deployment from database
        const deployment = await this.getDeployment(deploymentId);

        // Get containers for this deployment
        const dockerContainers = await this.dockerService.listContainersByDeployment(deploymentId);
        
        const containers: ContainerStatus[] = await Promise.all(
            dockerContainers.map(async (container) => {
                const isHealthy = await this.dockerService.checkContainerHealth(container.id);
                const containerInfo = await this.dockerService.getContainerInfo(container.id);
                
                return {
                    containerId: container.id,
                    containerName: container.name,
                    status: container.status as 'running' | 'stopped' | 'error',
                    healthy: isHealthy,
                    uptime: containerInfo.State.StartedAt ? 
                        Date.now() - new Date(containerInfo.State.StartedAt).getTime() : undefined,
                    metadata: {
                        image: containerInfo.Config.Image,
                        ports: containerInfo.NetworkSettings.Ports,
                        restartCount: containerInfo.RestartCount
                    }
                };
            })
        );

        // Determine overall health status
        let healthStatus: 'healthy' | 'unhealthy' | 'partial' | 'unknown';
        const healthyContainers = containers.filter(c => c.healthy);

        if (containers.length === 0) {
            healthStatus = 'unknown';
        } else if (healthyContainers.length === containers.length) {
            healthStatus = 'healthy';
        } else if (healthyContainers.length === 0) {
            healthStatus = 'unhealthy';
        } else {
            healthStatus = 'partial';
        }

        return {
            deploymentId,
            status: deployment.status,
            containers,
            healthStatus,
            lastChecked: new Date()
        };
    }

    /**
     * Stop all containers for a deployment
     */
    async stopDeployment(deploymentId: string): Promise<void> {
        this.logger.log(`Stopping deployment ${deploymentId}`);
        
        await this.dockerService.stopContainersByDeployment(deploymentId);
        
        await this.updateDeploymentStatus(deploymentId, 'cancelled');
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: 'Deployment stopped',
            phase: 'management',
            step: 'stop-containers',
            service: 'deployment-service',
            stage: 'stopped',
            timestamp: new Date()
        });
    }

    /**
     * Remove deployment and all associated resources
     */
    async removeDeployment(deploymentId: string): Promise<void> {
        this.logger.log(`Removing deployment ${deploymentId}`);
        
        // Validate deployment exists
        await this.getDeployment(deploymentId);

        // Stop and remove containers
        const containers = await this.dockerService.listContainersByDeployment(deploymentId);
        for (const container of containers) {
            await this.dockerService.removeContainer(container.id);
        }

        // Remove deployment from database (logs will be cascade deleted)
        await db.delete(deployments).where(eq(deployments.id, deploymentId));
        
        this.logger.log(`Deployment ${deploymentId} removed successfully`);
    }

    /**
     * Verify container health using configured health check
     */
    private async verifyContainerHealth(containerId: string, healthCheckUrl?: string): Promise<boolean> {
        try {
            // First check if container is running
            const containerHealth = await this.dockerService.checkContainerHealth(containerId);
            if (!containerHealth) {
                return false;
            }

            // If health check URL is provided, test it
            if (healthCheckUrl) {
                // Wait a moment for the service to start
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Attempt HTTP health check
                try {
                    const response = await fetch(healthCheckUrl, { 
                        method: 'GET',
                        signal: AbortSignal.timeout(10000) // 10s timeout
                    });
                    return response.ok;
                } catch (error) {
                    this.logger.warn(`Health check failed for ${healthCheckUrl}:`, error);
                    return false;
                }
            }

            return true;
        } catch (error) {
            this.logger.error(`Error verifying container health ${containerId}:`, error);
            return false;
        }
    }

    /**
     * Generate optimized Dockerfile for Node.js applications
     */
    private generateNodejsDockerfile(buildConfig?: DeploymentConfig['buildConfig']): string {
        const nodeVersion = '18-alpine';
        const installCommand = buildConfig?.installCommand || 'npm install';
        const startCommand = buildConfig?.startCommand || 'npm start';
        const port = buildConfig?.port || 3000;

        return `
FROM node:${nodeVersion}

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN ${installCommand}

# Copy source code
COPY . .

# Build if needed (check for build script)
RUN if [ -f package.json ] && grep -q '"build"' package.json; then npm run build; fi

# Expose port
EXPOSE ${port}

# Add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD curl -f http://localhost:${port}${buildConfig?.healthCheckPath || '/health'} || exit 1

# Start application
CMD ["sh", "-c", "${startCommand}"]
        `.trim();
    }

    /**
     * Generate optimized Dockerfile for Python applications
     */
    private generatePythonDockerfile(buildConfig?: DeploymentConfig['buildConfig']): string {
        const pythonVersion = '3.11-alpine';
        const installCommand = buildConfig?.installCommand || 'pip install -r requirements.txt';
        const startCommand = buildConfig?.startCommand || 'python app.py';
        const port = buildConfig?.port || 8000;

        return `
FROM python:${pythonVersion}

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt ./

# Install dependencies
RUN ${installCommand}

# Copy source code
COPY . .

# Expose port
EXPOSE ${port}

# Add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD curl -f http://localhost:${port}${buildConfig?.healthCheckPath || '/health'} || exit 1

# Start application
CMD ["sh", "-c", "${startCommand}"]
        `.trim();
    }

    /**
     * Update deployment with container information
     */
    private async updateDeploymentContainer(
        deploymentId: string,
        containerName: string,
        containerImage: string
    ): Promise<void> {
        await db.update(deployments)
            .set({
                containerName,
                containerImage,
                updatedAt: new Date()
            })
            .where(eq(deployments.id, deploymentId));
    }
    async createDeployment(data: CreateDeploymentData): Promise<string> {
        this.logger.log(`Creating deployment for service ${data.serviceId}`);
        const insertData: InsertDeployment = {
            serviceId: data.serviceId,
            triggeredBy: data.triggeredBy || null,
            status: 'pending',
            environment: data.environment || 'production',
            sourceType: data.sourceType,
            sourceConfig: data.sourceConfig,
            metadata: data.metadata || {},
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const result = await db.insert(deployments).values(insertData).returning({ id: deployments.id });
        const deploymentId = result[0].id;
        // Add initial log
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: 'Deployment created and queued',
            phase: 'initialization',
            timestamp: new Date(),
            metadata: { sourceConfig: data.sourceConfig },
        });
        this.logger.log(`Deployment ${deploymentId} created successfully`);
        return deploymentId;
    }
    async getDeployment(deploymentId: string): Promise<SelectDeployment> {
        const result = await db
            .select()
            .from(deployments)
            .where(eq(deployments.id, deploymentId))
            .limit(1);
        if (!result.length) {
            throw new NotFoundException(`Deployment ${deploymentId} not found`);
        }
        return result[0];
    }
    async updateDeploymentStatus(deploymentId: string, status: DeploymentStatus): Promise<void> {
        this.logger.log(`Updating deployment ${deploymentId} status to ${status}`);
        const updateData: Partial<InsertDeployment> = {
            status,
            updatedAt: new Date(),
        };
        // Set timestamp based on status
        if (status === 'building') {
            updateData.buildStartedAt = new Date();
        }
        else if (status === 'deploying') {
            updateData.deployStartedAt = new Date();
        }
        else if (status === 'success') {
            updateData.deployCompletedAt = new Date();
        }
        await db
            .update(deployments)
            .set(updateData)
            .where(eq(deployments.id, deploymentId));
    }
    async updateDeploymentMetadata(deploymentId: string, metadata: Record<string, any>): Promise<void> {
        const deployment = await this.getDeployment(deploymentId);
        const updatedMetadata = { ...deployment.metadata, ...metadata };
        await db
            .update(deployments)
            .set({
            metadata: updatedMetadata,
            updatedAt: new Date(),
        })
            .where(eq(deployments.id, deploymentId));
    }
    async addDeploymentLog(deploymentId: string, logData: DeploymentLogData): Promise<void> {
        const insertData: InsertDeploymentLog = {
            deploymentId,
            level: logData.level,
            message: logData.message,
            phase: logData.phase || null,
            step: logData.step || null,
            service: logData.service || null,
            stage: logData.stage || null,
            timestamp: logData.timestamp,
            metadata: logData.metadata || {},
        };
        await db.insert(deploymentLogs).values(insertData);
    }
    async getDeploymentLogs(deploymentId: string, options?: {
        limit?: number;
        offset?: number;
        level?: LogLevel;
        phase?: string;
        service?: string;
    }): Promise<SelectDeploymentLog[]> {
        const query = db
            .select()
            .from(deploymentLogs)
            .where(eq(deploymentLogs.deploymentId, deploymentId))
            .orderBy(desc(deploymentLogs.timestamp));
        if (options?.limit) {
            return await query.limit(options.limit);
        }
        return await query;
    }
    async getServiceDeployments(serviceId: string, options?: {
        limit?: number;
        offset?: number;
        status?: DeploymentStatus;
        environment?: string;
    }): Promise<SelectDeployment[]> {
        const query = db
            .select()
            .from(deployments)
            .where(eq(deployments.serviceId, serviceId))
            .orderBy(desc(deployments.createdAt));
        if (options?.limit) {
            return await query.limit(options.limit);
        }
        return await query;
    }
    async getActiveDeployments(serviceId?: string): Promise<SelectDeployment[]> {
        const activeStatuses: DeploymentStatus[] = ['pending', 'queued', 'building', 'deploying'];
        const baseQuery = db
            .select()
            .from(deployments);
        const query = serviceId
            ? baseQuery.where(eq(deployments.serviceId, serviceId))
            : baseQuery;
        const results = await query.orderBy(desc(deployments.createdAt));
        return results.filter(deployment => activeStatuses.includes(deployment.status));
    }
    async getLastSuccessfulDeployment(serviceId: string): Promise<SelectDeployment | null> {
        const result = await db
            .select()
            .from(deployments)
            .where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'success')))
            .orderBy(desc(deployments.deployCompletedAt))
            .limit(1);
        return result.length ? result[0] : null;
    }
    async getDeploymentStats(serviceId: string): Promise<{
        total: number;
        success: number;
        failed: number;
        active: number;
    }> {
        const [totalResult, successResult, failedResult, activeResult] = await Promise.all([
            db.select({ count: count() }).from(deployments).where(eq(deployments.serviceId, serviceId)),
            db.select({ count: count() }).from(deployments).where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'success'))),
            db.select({ count: count() }).from(deployments).where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'failed'))),
            db.select({ count: count() }).from(deployments).where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'building'))),
        ]);
        return {
            total: totalResult[0].count,
            success: successResult[0].count,
            failed: failedResult[0].count,
            active: activeResult[0].count,
        };
    }
    async cancelDeployment(deploymentId: string): Promise<void> {
        const deployment = await this.getDeployment(deploymentId);
        if (!['pending', 'queued', 'building', 'deploying'].includes(deployment.status)) {
            throw new Error(`Cannot cancel deployment in status: ${deployment.status}`);
        }
        await this.updateDeploymentStatus(deploymentId, 'cancelled');
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: 'Deployment cancelled by user',
            phase: 'cancellation',
            timestamp: new Date(),
        });
        this.logger.log(`Deployment ${deploymentId} cancelled`);
    }
    async cleanupOldDeployments(olderThanDays: number = 30): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
        // First, get deployments to cleanup (completed statuses only)
        const results = await db
            .select()
            .from(deployments);
        const deploymentsToCleanup = results.filter(deployment => ['success', 'failed', 'cancelled'].includes(deployment.status) &&
            deployment.createdAt < cutoffDate);
        if (deploymentsToCleanup.length === 0) {
            return 0;
        }
        // Delete deployment logs first (foreign key constraint)
        for (const deployment of deploymentsToCleanup) {
            await db.delete(deploymentLogs).where(eq(deploymentLogs.deploymentId, deployment.id));
        }
        // Delete deployments
        for (const deployment of deploymentsToCleanup) {
            await db.delete(deployments).where(eq(deployments.id, deployment.id));
        }
        const deletedCount = deploymentsToCleanup.length;
        this.logger.log(`Cleaned up ${deletedCount} old deployments`);
        return deletedCount;
    }

    /**
     * Monitor the health of all containers for a specific deployment
     */
    async monitorDeploymentHealth(deploymentId: string): Promise<{
        deploymentId: string;
        status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
        containers: Array<{
            containerId: string;
            containerName: string;
            health: {
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
            };
        }>;
        httpHealthCheck?: {
            isHealthy: boolean;
            httpStatus?: number;
            responseTime?: number;
            error?: string;
        };
        lastChecked: Date;
    }> {
        try {
            // Get deployment info
            const [deployment] = await db
                .select()
                .from(deployments)
                .where(eq(deployments.id, deploymentId))
                .limit(1);

            if (!deployment) {
                throw new Error(`Deployment ${deploymentId} not found`);
            }

            // Monitor all containers for this deployment
            const containers = await this.dockerService.monitorContainersByDeployment(deploymentId);
            
            // Determine overall deployment health status
            let overallStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown' = 'unknown';
            
            if (containers.length === 0) {
                overallStatus = 'unknown';
            } else {
                const healthyContainers = containers.filter(c => c.health.isHealthy);
                
                if (healthyContainers.length === containers.length) {
                    overallStatus = 'healthy';
                } else if (healthyContainers.length > 0) {
                    overallStatus = 'degraded';
                } else {
                    overallStatus = 'unhealthy';
                }
            }

            const result = {
                deploymentId,
                status: overallStatus,
                containers,
                lastChecked: new Date(),
            };

            // Perform HTTP health check if configured
            if (deployment.healthCheckUrl && containers.length > 0) {
                const primaryContainer = containers[0];
                if (primaryContainer.health.isHealthy) {
                    try {
                        const healthCheck = await this.dockerService.performHealthCheck(
                            primaryContainer.containerId, 
                            deployment.healthCheckUrl,
                            30000 // Default timeout since healthCheckTimeout is not in schema
                        );
                        
                        (result as any).httpHealthCheck = {
                            isHealthy: healthCheck.isHealthy,
                            httpStatus: healthCheck.httpStatus,
                            responseTime: healthCheck.responseTime,
                            error: healthCheck.error,
                        };

                        // Update overall status based on HTTP health check
                        if (!healthCheck.isHealthy && overallStatus === 'healthy') {
                            overallStatus = 'degraded';
                        }
                    } catch (error) {
                        (result as any).httpHealthCheck = {
                            isHealthy: false,
                            error: error instanceof Error ? error.message : 'HTTP health check failed',
                        };
                        if (overallStatus === 'healthy') {
                            overallStatus = 'degraded';
                        }
                    }
                }
            }

            // Update deployment status in database
            await this.updateDeploymentHealthStatus(deploymentId, overallStatus, containers);

            return { ...result, status: overallStatus };
        }
        catch (error) {
            this.logger.error(`Failed to monitor deployment health for ${deploymentId}:`, error);
            return {
                deploymentId,
                status: 'unknown' as const,
                containers: [],
                lastChecked: new Date(),
            };
        }
    }

    /**
     * Update deployment status in database with health information
     */
    private async updateDeploymentHealthStatus(
        deploymentId: string, 
        status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown', 
        containers: Array<{ containerId: string; health: any }>
    ): Promise<void> {
        try {
            // Map health status to deployment status
            let deploymentStatus: 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled';
            switch (status) {
                case 'healthy':
                    deploymentStatus = 'success';
                    break;
                case 'degraded':
                case 'unhealthy':
                    deploymentStatus = 'failed';
                    break;
                default:
                    deploymentStatus = 'pending';
            }

            // Update deployment status
            await db
                .update(deployments)
                .set({
                    status: deploymentStatus,
                    updatedAt: new Date(),
                })
                .where(eq(deployments.id, deploymentId));

            // Log deployment status change
            await db.insert(deploymentLogs).values({
                id: crypto.randomUUID(),
                deploymentId,
                level: 'info',
                message: `Deployment health status updated to: ${status}`,
                phase: 'health-check',
                metadata: {
                    containerLogs: JSON.stringify({
                        containersCount: containers.length,
                        healthyContainers: containers.filter(c => c.health.isHealthy).length,
                        containers: containers.map(c => ({
                            id: c.containerId,
                            healthy: c.health.isHealthy,
                            status: c.health.status,
                            uptime: c.health.uptime,
                        })),
                    })
                },
                timestamp: new Date(),
            });
        }
        catch (error) {
            this.logger.error(`Failed to update deployment status for ${deploymentId}:`, error);
        }
    }

    /**
     * Get comprehensive deployment status including health metrics
     */
    async getDeploymentStatus(deploymentId: string): Promise<{
        deployment: any;
        health: Awaited<ReturnType<DeploymentService['monitorDeploymentHealth']>>;
        recentLogs: Array<{
            id: string;
            level: string;
            message: string;
            timestamp: Date;
            metadata?: any;
        }>;
    } | null> {
        try {
            // Get deployment info
            const [deployment] = await db
                .select()
                .from(deployments)
                .where(eq(deployments.id, deploymentId))
                .limit(1);

            if (!deployment) {
                return null;
            }

            // Get health status
            const health = await this.monitorDeploymentHealth(deploymentId);

            // Get recent logs (last 10)
            const recentLogs = await db
                .select()
                .from(deploymentLogs)
                .where(eq(deploymentLogs.deploymentId, deploymentId))
                .orderBy(deploymentLogs.timestamp)
                .limit(10);

            return {
                deployment,
                health,
                recentLogs,
            };
        }
        catch (error) {
            this.logger.error(`Failed to get deployment status for ${deploymentId}:`, error);
            return null;
        }
    }

    /**
     * Restart unhealthy containers for a deployment
     */
    async restartUnhealthyContainers(deploymentId: string): Promise<{
        success: boolean;
        restartedContainers: string[];
        errors: Array<{ containerId: string; error: string }>;
    }> {
        try {
            const health = await this.monitorDeploymentHealth(deploymentId);
            const unhealthyContainers = health.containers.filter(c => !c.health.isHealthy);
            
            const restartedContainers: string[] = [];
            const errors: Array<{ containerId: string; error: string }> = [];

            for (const container of unhealthyContainers) {
                try {
                    await this.dockerService.restartContainer(container.containerId);
                    restartedContainers.push(container.containerId);
                    
                    // Log restart action
                    await db.insert(deploymentLogs).values({
                        id: crypto.randomUUID(),
                        deploymentId,
                        level: 'info',
                        message: `Restarted unhealthy container ${container.containerId}`,
                        phase: 'recovery',
                        metadata: {
                            containerLogs: JSON.stringify({
                                containerId: container.containerId,
                                containerName: container.containerName,
                                previousStatus: container.health.status,
                            })
                        },
                        timestamp: new Date(),
                    });
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    errors.push({ containerId: container.containerId, error: errorMessage });
                    
                    // Log restart failure
                    await db.insert(deploymentLogs).values({
                        id: crypto.randomUUID(),
                        deploymentId,
                        level: 'error',
                        message: `Failed to restart container ${container.containerId}: ${errorMessage}`,
                        phase: 'recovery',
                        metadata: {
                            errorStack: JSON.stringify({
                                containerId: container.containerId,
                                error: errorMessage,
                            })
                        },
                        timestamp: new Date(),
                    });
                }
            }

            return {
                success: errors.length === 0,
                restartedContainers,
                errors,
            };
        }
        catch (error) {
            this.logger.error(`Failed to restart unhealthy containers for deployment ${deploymentId}:`, error);
            return {
                success: false,
                restartedContainers: [],
                errors: [{ containerId: 'unknown', error: error instanceof Error ? error.message : 'Unknown error' }],
            };
        }
    }

    /**
     * Get all running deployments (successful + active) for a service
     */
    async getRunningDeploymentsByService(serviceId: string): Promise<SelectDeployment[]> {
        const runningStatuses: DeploymentStatus[] = ['success', 'pending', 'queued', 'building', 'deploying'];
        
        const results = await db
            .select()
            .from(deployments)
            .where(eq(deployments.serviceId, serviceId))
            .orderBy(desc(deployments.createdAt));
        
        return results.filter(deployment => runningStatuses.includes(deployment.status));
    }

    /**
     * Get preview deployments by trigger information (branch/PR)
     */
    async getPreviewDeploymentsByTrigger(
        branchName?: string, 
        pullRequestNumber?: number
    ): Promise<Array<SelectDeployment & { previewEnvironment?: any }>> {
        if (!branchName && !pullRequestNumber) {
            return [];
        }

        // Query deployments with preview environment data
        const query = db
            .select({
                deployment: deployments,
                preview: previewEnvironments,
            })
            .from(deployments)
            .leftJoin(previewEnvironments, eq(deployments.id, previewEnvironments.deploymentId))
            .where(eq(deployments.environment, 'preview'))
            .orderBy(desc(deployments.createdAt));

        const results = await query;
        
        // Filter by trigger information
        return results
            .filter(result => {
                const deployment = result.deployment;
                const preview = result.preview;
                
                // Check source config for branch or PR info
                const sourceConfig = deployment.sourceConfig as any;
                const previewMetadata = preview?.metadata as any;
                
                // Match by branch name
                if (branchName) {
                    const deploymentBranch = sourceConfig?.branch;
                    const previewBranch = previewMetadata?.branchName;
                    if (deploymentBranch === branchName || previewBranch === branchName) {
                        return true;
                    }
                }
                
                // Match by PR number
                if (pullRequestNumber) {
                    const deploymentPR = sourceConfig?.pullRequestNumber;
                    if (deploymentPR === pullRequestNumber) {
                        return true;
                    }
                }
                
                return false;
            })
            .map(result => ({
                ...result.deployment,
                previewEnvironment: result.preview,
            }));
    }

    /**
     * Stop and cleanup previous deployments before creating a new one
     */
    async stopPreviousDeployments(
        serviceId: string, 
        environment: 'production' | 'staging' | 'preview' | 'development',
        triggerInfo?: { branchName?: string; pullRequestNumber?: number }
    ): Promise<{ stoppedDeployments: string[]; errors: string[] }> {
        const stoppedDeployments: string[] = [];
        const errors: string[] = [];

        try {
            let deploymentsToStop: SelectDeployment[] = [];

            if (environment === 'preview' && triggerInfo) {
                // For preview environments, only stop deployments with the same trigger
                const previewDeployments = await this.getPreviewDeploymentsByTrigger(
                    triggerInfo.branchName,
                    triggerInfo.pullRequestNumber
                );
                deploymentsToStop = previewDeployments.filter(d => 
                    ['success', 'pending', 'queued', 'building', 'deploying'].includes(d.status)
                );
            } else {
                // For production/staging/development, stop all running deployments for the service
                deploymentsToStop = await this.getRunningDeploymentsByService(serviceId);
                // Filter by environment if not production (production should stop all)
                if (environment !== 'production') {
                    deploymentsToStop = deploymentsToStop.filter(d => d.environment === environment);
                }
            }

            // Stop each deployment
            for (const deployment of deploymentsToStop) {
                try {
                    this.logger.log(`Stopping previous deployment ${deployment.id} for service ${serviceId}`);
                    
                    // Stop deployment containers
                    await this.stopDeployment(deployment.id);
                    
                    stoppedDeployments.push(deployment.id);
                    
                    this.logger.log(`Successfully stopped deployment ${deployment.id}`);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    errors.push(`Failed to stop deployment ${deployment.id}: ${errorMessage}`);
                    this.logger.error(`Failed to stop deployment ${deployment.id}:`, error);
                }
            }

            return { stoppedDeployments, errors };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`Failed to query previous deployments: ${errorMessage}`);
            this.logger.error('Failed to query previous deployments:', error);
            return { stoppedDeployments, errors };
        }
    }
}
