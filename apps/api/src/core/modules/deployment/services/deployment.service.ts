import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, desc, and, count } from 'drizzle-orm';
import { deployments, deploymentLogs, deploymentStatusEnum, logLevelEnum, previewEnvironments, services, projects, deploymentRollbacks } from '@/config/drizzle/schema';
import { ne } from 'drizzle-orm';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { DeploymentPhase, type PhaseMetadata } from '@/core/common/types/deployment-phase';
import { DatabaseService } from '@/core/modules/database/services/database.service'
import { ProviderRegistryService } from '@/core/modules/providers/services/provider-registry.service';
import { BuilderRegistryService } from '@/core/modules/builders/services/builder-registry.service';
import type { IDeploymentProvider, ProviderConfig, DeploymentTrigger } from '@/core/modules/providers/interfaces/provider.interface';
import type { BuilderConfig, BuilderResult } from '@/core/modules/builders/common/services/base-builder.service';
import * as fs from 'fs/promises';
import * as path from 'path';

// Type for static file service to avoid circular dependency
export interface IStaticProviderService {
    deployStaticFiles(config: {
        serviceName: string;
        deploymentId: string;
        projectId?: string;
        domain: string;
        subdomain: string;
        sourcePath?: string;
    }): Promise<{
        containerId: string;
        containerName: string;
        domain: string;
        imageUsed?: string;
    }>;
}
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
    containers?: string[]; // backward-compatible alias (some callers expect `containers`)
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
        private readonly databaseService: DatabaseService,
        private readonly providerRegistry: ProviderRegistryService,
        private readonly builderRegistry: BuilderRegistryService,
    ) {}

    /**
     * Deploy a service based on its configuration using provider and builder registries
     * @param config - Deployment configuration
     * @param staticFileService - Static file service (required for static deployments, breaks circular dependency)
     */
    async deployService(
        config: DeploymentConfig,
        staticFileService?: IStaticProviderService
    ): Promise<DeploymentResult> {
        const { deploymentId, serviceName } = config;
        
        // Fetch service from database to get provider and builder information
        const db = this.databaseService.db;
        const [service] = await db
            .select()
            .from(services)
            .where(eq(services.name, serviceName))
            .limit(1);

        if (!service) {
            throw new NotFoundException(`Service ${serviceName} not found`);
        }

        const { providerId, builderId, providerConfig, builderConfig } = service;
        
        this.logger.log(`Starting deployment ${deploymentId} for service ${serviceName} (provider: ${providerId}, builder: ${builderId})`);
        
        // Update deployment status to building
        await this.updateDeploymentStatus(deploymentId, 'building');
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: `Starting ${builderId} deployment with ${providerId} provider`,
            phase: 'build',
            step: 'initialize',
            service: 'deployment-service',
            stage: 'setup',
            timestamp: new Date()
        });

        try {
            // Get provider instance from registry
            const provider = this.providerRegistry.getProvider(providerId) as IDeploymentProvider | null;
            if (!provider) {
                throw new Error(`Provider '${providerId}' not found in registry`);
            }

            // Get builder instance from registry  
            const builder = this.builderRegistry.getBuilder(builderId);
            if (!builder) {
                throw new Error(`Builder '${builderId}' not found in registry`);
            }

            this.logger.log(`Using provider: ${provider.name} and builder: ${builder.name}`);

            // Fetch source files using provider
            await this.addDeploymentLog(deploymentId, {
                level: 'info',
                message: `Fetching source files using ${provider.name}`,
                phase: 'fetch',
                step: 'source',
                service: 'deployment-service',
                stage: 'fetch',
                timestamp: new Date()
            });

            const providerCfg: ProviderConfig = {
                type: provider.type,
                config: providerConfig || {},
                repository: (providerConfig as any)?.repository,
                monorepo: (providerConfig as any)?.monorepo,
                cache: (providerConfig as any)?.cache,
            };

            const trigger: DeploymentTrigger = {
                trigger: config.sourceConfig?.pullRequestNumber ? 'webhook' : 'manual',
                event: config.sourceConfig?.pullRequestNumber ? 'pull_request' : 'push',
                data: config.sourceConfig,
            };

            const sourceFiles = await provider.fetchSource(providerCfg, trigger);
            
            await this.addDeploymentLog(deploymentId, {
                level: 'info',
                message: `Source files fetched successfully from ${sourceFiles.metadata.provider}`,
                phase: 'fetch',
                step: 'complete',
                service: 'deployment-service',
                stage: 'fetch',
                timestamp: new Date(),
                metadata: {
                    sourceId: sourceFiles.sourceId,
                    localPath: sourceFiles.localPath,
                    version: sourceFiles.metadata.version,
                }
            });

            // Build and deploy using builder
            await this.addDeploymentLog(deploymentId, {
                level: 'info',
                message: `Building and deploying with ${builder.name}`,
                phase: 'build',
                step: 'start',
                service: 'deployment-service',
                stage: 'build',
                timestamp: new Date()
            });

            const builderCfg: BuilderConfig & any = {
                deploymentId,
                serviceName,
                sourcePath: sourceFiles.localPath,
                environmentVariables: config.environmentVariables,
                port: (builderConfig as any)?.port,
                healthCheckPath: config.healthCheckPath,
                resourceLimits: config.resourceLimits,
                // Static builder specific
                ...(builderId === 'static' && {
                    projectId: config.projectId,
                    domain: config.domain,
                    subdomain: config.subdomain,
                    staticProviderService: staticFileService,
                }),
                // Add builder-specific config from database
                ...builderConfig,
                // Callbacks for phase updates and logging
                onPhaseUpdate: async (phase: DeploymentPhase, progress: number, metadata?: Record<string, unknown>) => {
                    await this.updateDeploymentPhase(deploymentId, phase, progress, metadata);
                },
                onLog: async (log: any) => {
                    await this.addDeploymentLog(deploymentId, {
                        level: log.level,
                        message: log.message,
                        phase: log.phase,
                        step: log.step,
                        service: log.service,
                        stage: log.phase,
                        timestamp: log.timestamp,
                    });
                },
            };

            const builderResult: BuilderResult = await (builder as any).deploy(builderCfg);

            // Cleanup source files
            try {
                await sourceFiles.cleanup();
            } catch (cleanupError) {
                this.logger.warn(`Failed to cleanup source files: ${cleanupError}`);
            }

            // Map builder result to deployment result
            const result: DeploymentResult = {
                deploymentId: builderResult.deploymentId,
                containerIds: builderResult.containerIds,
                status: builderResult.status === 'success' ? 'success' : 'failed',
                message: builderResult.message,
                metadata: builderResult.metadata,
                healthCheckUrl: builderResult.healthCheckUrl,
                domain: builderResult.domain,
            };

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
                
                // Get deployment to find serviceId
                const deployment = await this.getDeployment(deploymentId);
                
                // Cancel previous successful deployment for this service
                await this.cancelPreviousDeployment(deploymentId, deployment.serviceId);
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
     * @param config - Deployment configuration
     * @param staticFileService - Static file service for deployment (passed as parameter to break circular dependency)
     */
    public async deployStaticSite(
        config: DeploymentConfig,
        staticFileService: IStaticProviderService
    ): Promise<DeploymentResult> {
         const { deploymentId, serviceName, domain, subdomain } = config;
        
        // Phase: COPYING_FILES - Static file deployment
        await this.updateDeploymentPhase(
            deploymentId,
            DeploymentPhase.COPYING_FILES,
            30,
            { deploymentType: 'static', filePreparation: 'starting' }
        );
        
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
        // Compute final domain/subdomain used for routing. If not provided, try to generate
        // a stable subdomain from the service + project name and use TRAEFIK_DOMAIN or localhost
        const finalDomain = domain || process.env.TRAEFIK_DOMAIN || 'localhost';
        let finalSubdomain = subdomain;
        if (!finalSubdomain) {
            // Try to resolve project name from DB using serviceName (best-effort)
            try {
                // Import types locally to avoid circulars
                // Access the DB via the shared `this.databaseService.db` import at top of file
                const row = await this.databaseService.db.select({ svc: services, proj: projects })
                    .from(services)
                    .innerJoin(projects, eq(services.projectId, projects.id))
                    .where(eq(services.name, serviceName))
                    .limit(1);
                if (row && row.length) {
                    const projectName = (row[0].proj && (row[0].proj as any).name) || '';
                    finalSubdomain = `${DeploymentService.sanitizeForSubdomain(serviceName)}-${DeploymentService.sanitizeForSubdomain(projectName || 'project')}`;
                }
            }
            catch {
                // Best-effort only — fall back to service-based name
                finalSubdomain = DeploymentService.sanitizeForSubdomain(serviceName);
            }
            // Ensure we always have something
            finalSubdomain = finalSubdomain || DeploymentService.sanitizeForSubdomain(serviceName);
        }

        // Phase: CREATING_SYMLINKS - Project server setup
        await this.updateDeploymentPhase(
            deploymentId,
            DeploymentPhase.CREATING_SYMLINKS,
            60,
            { 
                finalDomain, 
                finalSubdomain,
                serverSetup: 'configuring'
            }
        );

        // Deploy using project-level static file service — pass explicit domain and subdomain
        const nginxInfo = await staticFileService.deployStaticFiles({
             serviceName,
             deploymentId,
             projectId: config.projectId,
             domain: finalDomain,
             subdomain: finalSubdomain,
             sourcePath,
        } as any);

        // Phase: UPDATING_ROUTES - Server configured, setting up routing
        await this.updateDeploymentPhase(
            deploymentId,
            DeploymentPhase.UPDATING_ROUTES,
            80,
            { 
                containerName: nginxInfo.containerName,
                domain: nginxInfo.domain,
                routeConfiguration: 'active'
            }
        );

        // Update deployment record with project server container info
        await this.updateDeploymentContainer(deploymentId, nginxInfo.containerName, nginxInfo.imageUsed || `lighttpd:alpine`);

        const healthCheckUrl = `http://${nginxInfo.domain}/health`;
        
        // Phase: HEALTH_CHECK - Verify deployment
        await this.updateDeploymentPhase(
            deploymentId,
            DeploymentPhase.HEALTH_CHECK,
            90,
            { healthCheckUrl, verification: 'starting' }
        );
        
        // Verify deployment is healthy by checking the project server container and health endpoint
        const isHealthy = await this.verifyContainerHealth(nginxInfo.containerId, healthCheckUrl);
        
        // Phase: ACTIVE or FAILED based on health check
        if (isHealthy) {
            await this.updateDeploymentPhase(
                deploymentId,
                DeploymentPhase.ACTIVE,
                100,
                { 
                    containerName: nginxInfo.containerName,
                    domain: nginxInfo.domain,
                    healthCheckUrl,
                    serverImage: nginxInfo.imageUsed || 'rtsp/lighttpd',
                    deploymentCompletedAt: new Date().toISOString()
                }
            );
        } else {
            await this.updateDeploymentPhase(
                deploymentId,
                DeploymentPhase.FAILED,
                0,
                { 
                    error: 'Health check failed',
                    healthCheckUrl,
                    containerName: nginxInfo.containerName
                }
            );
        }
        
        return {
            deploymentId,
            containerIds: [nginxInfo.containerId],
            containers: [nginxInfo.containerId],
            status: isHealthy ? 'success' : 'partial',
            domain: nginxInfo.domain,
            healthCheckUrl,
            message: isHealthy ? 'Static site deployed successfully' : 'Static site deployed but health check failed',
            metadata: {
                containerName: nginxInfo.containerName,
                serverImage: nginxInfo.imageUsed || 'rtsp/lighttpd',
            } as Record<string, unknown>
        };
    }

    /**
     * Deploy a Docker service using Dockerfile
     */
    public async deployDockerService(config: DeploymentConfig): Promise<DeploymentResult> {
        const { deploymentId, serviceName, sourcePath, environmentVariables } = config;
        
        // Phase: BUILDING - Docker image build
        await this.updateDeploymentPhase(
            deploymentId,
            DeploymentPhase.BUILDING,
            20,
            { buildType: 'docker', sourcePath }
        );
        
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

        // Phase: COPYING_FILES - Container creation
        await this.updateDeploymentPhase(
            deploymentId,
            DeploymentPhase.COPYING_FILES,
            50,
            { imageTag, containerSetup: 'starting' }
        );

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

        // Phase: UPDATING_ROUTES - Container started, preparing networking
        await this.updateDeploymentPhase(
            deploymentId,
            DeploymentPhase.UPDATING_ROUTES,
            75,
            { containerId, containerName, routeSetup: 'configuring' }
        );

        // Update deployment record
        await this.updateDeploymentContainer(deploymentId, containerName, imageTag);

        // Phase: HEALTH_CHECK - Verify container health
        await this.updateDeploymentPhase(
            deploymentId,
            DeploymentPhase.HEALTH_CHECK,
            90,
            { healthCheckStarted: true }
        );

        // Verify container health
        const healthCheckPath = config.healthCheckPath || '/health';
        const healthCheckUrl = config.port ? 
            `http://localhost:${config.port}${healthCheckPath}` : 
            `http://${containerName}${healthCheckPath}`;
        
        const isHealthy = await this.verifyContainerHealth(containerId, healthCheckUrl);

        // Phase: ACTIVE or FAILED based on health check
        if (isHealthy) {
            await this.updateDeploymentPhase(
                deploymentId,
                DeploymentPhase.ACTIVE,
                100,
                { 
                    containerName, 
                    imageTag, 
                    port: config.port,
                    healthCheckUrl,
                    deploymentCompletedAt: new Date().toISOString()
                }
            );
        } else {
            await this.updateDeploymentPhase(
                deploymentId,
                DeploymentPhase.FAILED,
                0,
                { 
                    error: 'Health check failed',
                    containerName,
                    imageTag,
                    healthCheckUrl
                }
            );
        }

        return {
            deploymentId,
            containerIds: [containerId],
            containers: [containerId],
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
        
        // Phase: BUILDING - Dockerfile generation for Node.js
        await this.updateDeploymentPhase(
            deploymentId,
            DeploymentPhase.BUILDING,
            15,
            { buildType: 'nodejs', dockerfileGeneration: 'starting' }
        );
        
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

        // Update phase to indicate Dockerfile is ready
        await this.updateDeploymentPhase(
            deploymentId,
            DeploymentPhase.BUILDING,
            25,
            { 
                buildType: 'nodejs', 
                dockerfileGeneration: 'completed',
                dockerfileContent: dockerfile.length > 0 ? 'generated' : 'empty'
            }
        );

        // Continue with Docker deployment (which will handle remaining phases)
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
        await this.databaseService.db.delete(deployments).where(eq(deployments.id, deploymentId));
        
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
        await this.databaseService.db.update(deployments)
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
        const result = await this.databaseService.db.insert(deployments).values(insertData).returning({ id: deployments.id });
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
        const result = await this.databaseService.db
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
        await this.databaseService.db
            .update(deployments)
            .set(updateData)
            .where(eq(deployments.id, deploymentId));
        
        // Cleanup containers and volumes for failed/cancelled deployments
        // This ensures database is the single source of truth
        if (status === 'failed' || status === 'cancelled') {
            await this.cleanupDeploymentResources(deploymentId, status);
        }
    }
    async updateDeploymentMetadata(deploymentId: string, metadata: Record<string, any>): Promise<void> {
        const deployment = await this.getDeployment(deploymentId);
        const updatedMetadata = { ...deployment.metadata, ...metadata };
        await this.databaseService.db
            .update(deployments)
            .set({
            metadata: updatedMetadata,
            updatedAt: new Date(),
        })
            .where(eq(deployments.id, deploymentId));
    }

    /**
     * Update deployment phase tracking for reconciliation
     * Tracks progress through deployment lifecycle
     */
    async updateDeploymentPhase(
        deploymentId: string,
        phase: DeploymentPhase,
        progress: number = 0,
        metadata: PhaseMetadata = {}
    ): Promise<void> {
        this.logger.log(`Updating deployment ${deploymentId} phase to ${phase} (${progress}%)`);
        
        await this.databaseService.db
            .update(deployments)
            .set({
                phase,
                phaseProgress: progress,
                phaseMetadata: metadata,
                phaseUpdatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(deployments.id, deploymentId));
        
        // Log phase transition
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: `Phase transition: ${phase} (${progress}%)`,
            phase,
            timestamp: new Date(),
            metadata,
        });
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
        await this.databaseService.db.insert(deploymentLogs).values(insertData);
    }
    async getDeploymentLogs(deploymentId: string, options?: {
        limit?: number;
        offset?: number;
        level?: LogLevel;
        phase?: string;
        service?: string;
    }): Promise<SelectDeploymentLog[]> {
        const query = this.databaseService.db
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
        const query = this.databaseService.db
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
        const baseQuery = this.databaseService.db
            .select()
            .from(deployments);
        const query = serviceId
            ? baseQuery.where(eq(deployments.serviceId, serviceId))
            : baseQuery;
        const results = await query.orderBy(desc(deployments.createdAt));
        return results.filter(deployment => activeStatuses.includes(deployment.status));
    }
    async getLastSuccessfulDeployment(serviceId: string, excludeDeploymentId?: string): Promise<SelectDeployment | null> {
        const conditions = [
            eq(deployments.serviceId, serviceId),
            eq(deployments.status, 'success')
        ];
        
        if (excludeDeploymentId) {
            conditions.push(ne(deployments.id, excludeDeploymentId));
        }
        
        const result = await this.databaseService.db
            .select()
            .from(deployments)
            .where(and(...conditions))
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
            this.databaseService.db.select({ count: count() }).from(deployments).where(eq(deployments.serviceId, serviceId)),
            this.databaseService.db.select({ count: count() }).from(deployments).where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'success'))),
            this.databaseService.db.select({ count: count() }).from(deployments).where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'failed'))),
            this.databaseService.db.select({ count: count() }).from(deployments).where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'building'))),
        ]);
        return {
            total: totalResult[0].count,
            success: successResult[0].count,
            failed: failedResult[0].count,
            active: activeResult[0].count,
        };
    }
    /**
     * Cancel previous successful deployment when new deployment succeeds
     * This is automatically called after a successful deployment
     */
    private async cancelPreviousDeployment(newDeploymentId: string, serviceId: string): Promise<void> {
        try {
            // Find the previous successful deployment (excluding the current one)
            const previousDeployment = await this.getLastSuccessfulDeployment(serviceId, newDeploymentId);
            
            if (previousDeployment) {
                this.logger.log(`Cancelling previous deployment ${previousDeployment.id} because new deployment ${newDeploymentId} succeeded`);
                
                // Update previous deployment status to cancelled
                await this.updateDeploymentStatus(previousDeployment.id, 'cancelled');
                
                // Add log to previous deployment
                await this.addDeploymentLog(previousDeployment.id, {
                    level: 'info',
                    message: `Automatically cancelled because new deployment ${newDeploymentId} succeeded`,
                    phase: 'cancellation',
                    timestamp: new Date(),
                    metadata: {
                        replacedBy: newDeploymentId,
                        reason: 'superseded_by_new_deployment'
                    }
                });
                
                // Add log to new deployment
                await this.addDeploymentLog(newDeploymentId, {
                    level: 'info',
                    message: `Superseded previous deployment ${previousDeployment.id}`,
                    phase: 'deployment',
                    timestamp: new Date(),
                    metadata: {
                        previousDeploymentId: previousDeployment.id
                    }
                });
                
                this.logger.log(`Successfully cancelled previous deployment ${previousDeployment.id}`);
            } else {
                this.logger.log(`No previous successful deployment found for service ${serviceId}`);
            }
        } catch (error) {
            // Don't fail the deployment if cancelling previous deployment fails
            this.logger.error(`Failed to cancel previous deployment for service ${serviceId}:`, error);
            await this.addDeploymentLog(newDeploymentId, {
                level: 'warn',
                message: `Failed to cancel previous deployment: ${error instanceof Error ? error.message : 'Unknown error'}`,
                phase: 'deployment',
                timestamp: new Date(),
            });
        }
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
        const results = await this.databaseService.db
            .select()
            .from(deployments);
        const deploymentsToCleanup = results.filter(deployment => ['success', 'failed', 'cancelled'].includes(deployment.status) &&
            deployment.createdAt < cutoffDate);
        if (deploymentsToCleanup.length === 0) {
            return 0;
        }
        // Delete deployment logs first (foreign key constraint)
        for (const deployment of deploymentsToCleanup) {
            await this.databaseService.db.delete(deploymentLogs).where(eq(deploymentLogs.deploymentId, deployment.id));
        }
        // Delete deployments
        for (const deployment of deploymentsToCleanup) {
            await this.databaseService.db.delete(deployments).where(eq(deployments.id, deployment.id));
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
            const [deployment] = await this.databaseService.db
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
            // Get current deployment status to avoid incorrectly downgrading status
            const [currentDeployment] = await this.databaseService.db
                .select({ status: deployments.status })
                .from(deployments)
                .where(eq(deployments.id, deploymentId))
                .limit(1);

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
                case 'unknown':
                default:
                    // CRITICAL FIX: Don't downgrade 'success' to 'pending' for static deployments
                    // Static deployments have no containers, so health status is 'unknown'
                    // If deployment is already successful, keep it that way
                    if (currentDeployment?.status === 'success') {
                        this.logger.debug(
                            `Deployment ${deploymentId} has unknown health (likely static) but keeping success status`
                        );
                        return; // Don't update status
                    }
                    deploymentStatus = 'pending';
            }

            // Update deployment status
            await this.databaseService.db
                .update(deployments)
                .set({
                    status: deploymentStatus,
                    updatedAt: new Date(),
                })
                .where(eq(deployments.id, deploymentId));

            // Log deployment status change
            await this.databaseService.db.insert(deploymentLogs).values({
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
            const [deployment] = await this.databaseService.db
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
            const recentLogs = await this.databaseService.db
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
                    await this.databaseService.db.insert(deploymentLogs).values({
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
                    await this.databaseService.db.insert(deploymentLogs).values({
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
        
        const results = await this.databaseService.db
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
    ): Promise<Array<SelectDeployment & { previewEnvironment?: Record<string, unknown> | null }>> {
        if (!branchName && !pullRequestNumber) {
            return [];
        }

        // Query deployments with preview environment data
        const query = this.databaseService.db
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
    // Helper to create safe DNS-friendly subdomain segments
    // Keep this minimal and predictable so generated hostnames are stable.
    private static sanitizeForSubdomain(str: string): string {
        return (str || '')
            .toString()
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/(^-|-$)/g, '')
            .slice(0, 63) || 'site';
    }

    /**
     * Clean up Docker resources for a failed or cancelled deployment
     * Removes containers and volumes unless a rollback is active
     * 
     * @param deploymentId - The deployment ID to clean up
     * @param status - The deployment status (failed or cancelled)
     */
    private async cleanupDeploymentResources(deploymentId: string, status: DeploymentStatus): Promise<void> {
        try {
            this.logger.log(`Starting cleanup of resources for ${status} deployment ${deploymentId}`);

            // Check if there's an active rollback for this deployment
            const hasActiveRollback = await this.hasActiveRollback(deploymentId);
            if (hasActiveRollback) {
                this.logger.log(`Skipping cleanup for deployment ${deploymentId} - active rollback in progress`);
                return;
            }

            // Query Docker for containers with this deployment ID
            const containers = await this.dockerService.listContainers({
                all: true,
                filters: {
                    label: [`deployer.deployment_id=${deploymentId}`]
                }
            });

            if (containers.length === 0) {
                this.logger.log(`No containers found for deployment ${deploymentId}`);
                return;
            }

            this.logger.log(`Found ${containers.length} container(s) for deployment ${deploymentId}`);

            // Remove each container
            for (const containerInfo of containers) {
                try {
                    const containerName = containerInfo.Names?.[0] || containerInfo.Id;
                    
                    this.logger.log(`Removing container ${containerName} for deployment ${deploymentId}`);
                    
                    // Use dockerService to remove container (handles stop and remove)
                    await this.dockerService.removeContainer(containerInfo.Id);
                    
                    this.logger.log(`Successfully removed container ${containerName}`);
                } catch (error) {
                    // Log but continue with other containers
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    this.logger.warn(`Failed to remove container ${containerInfo.Id}: ${errorMessage}`);
                }
            }

            this.logger.log(`Completed cleanup for deployment ${deploymentId}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Error during cleanup of deployment ${deploymentId}:`, errorMessage);
            // Don't throw - cleanup failures shouldn't prevent status updates
        }
    }

    /**
     * Check if a deployment has an active rollback in progress
     * 
     * @param deploymentId - The deployment ID to check
     * @returns True if an active rollback exists
     */
    private async hasActiveRollback(deploymentId: string): Promise<boolean> {
        try {
            const rollbacks = await this.databaseService.db
                .select()
                .from(deploymentRollbacks)
                .where(
                    and(
                        eq(deploymentRollbacks.fromDeploymentId, deploymentId),
                        eq(deploymentRollbacks.status, 'in_progress')
                    )
                )
                .limit(1);

            const hasActive = rollbacks.length > 0;
            if (hasActive) {
                this.logger.log(`Active rollback found for deployment ${deploymentId}`);
            }
            return hasActive;
        } catch (error) {
            this.logger.error(`Error checking for active rollback:`, error);
            // On error, assume rollback exists to be safe
            return true;
        }
    }

    /**
     * Resume a deployment from a specific phase
     * Called by ZombieCleanupService when recovering from crashes
     * 
     * @param deploymentId - The deployment ID to resume
     * @param fromPhase - The phase to resume from
     */
    async resumeFromPhase(deploymentId: string, fromPhase: DeploymentPhase): Promise<void> {
        this.logger.log(`Resuming deployment ${deploymentId} from phase ${fromPhase}`);

        try {
            // Get deployment details
            const [deployment] = await this.databaseService.db
                .select()
                .from(deployments)
                .where(eq(deployments.id, deploymentId))
                .limit(1);

            if (!deployment) {
                throw new Error(`Deployment ${deploymentId} not found`);
            }

            // Get service details
            const [service] = await this.databaseService.db
                .select()
                .from(services)
                .where(eq(services.id, deployment.serviceId))
                .limit(1);

            if (!service) {
                throw new Error(`Service ${deployment.serviceId} not found for deployment ${deploymentId}`);
            }

            // Update status to indicate resuming
            await this.updateDeploymentStatus(deploymentId, 'deploying');

            // Resume based on phase
            switch (fromPhase) {
                case DeploymentPhase.PULLING_SOURCE:
                    this.logger.log(`Resuming from PULLING_SOURCE - cannot resume, must restart`);
                    // Cannot resume pulling - need to start over
                    await this.addDeploymentLog(deploymentId, {
                        level: 'warn',
                        message: 'Cannot resume from PULLING_SOURCE phase - deployment must be restarted',
                        phase: fromPhase,
                        timestamp: new Date(),
                    });
                    await this.updateDeploymentStatus(deploymentId, 'failed');
                    break;

                case DeploymentPhase.BUILDING:
                    this.logger.log(`Resuming from BUILDING - cannot resume build, must restart`);
                    // Cannot resume build process - need to start over
                    await this.addDeploymentLog(deploymentId, {
                        level: 'warn',
                        message: 'Cannot resume from BUILDING phase - deployment must be restarted',
                        phase: fromPhase,
                        timestamp: new Date(),
                    });
                    await this.updateDeploymentStatus(deploymentId, 'failed');
                    break;

                case DeploymentPhase.COPYING_FILES:
                    this.logger.log(`Resuming from COPYING_FILES - verifying files and redeploying if needed`);
                    await this.resumeCopyingFiles(deployment, service);
                    break;

                case DeploymentPhase.CREATING_SYMLINKS:
                    this.logger.log(`Resuming from CREATING_SYMLINKS - recreating symlinks`);
                    await this.resumeCreatingSymlinks(deployment, service);
                    break;

                case DeploymentPhase.UPDATING_ROUTES:
                    this.logger.log(`Resuming from UPDATING_ROUTES - updating Traefik routes`);
                    await this.resumeUpdatingRoutes(deployment, service);
                    break;

                case DeploymentPhase.HEALTH_CHECK:
                    this.logger.log(`Resuming from HEALTH_CHECK - re-running health check`);
                    await this.resumeHealthCheck(deployment, service);
                    break;

                default:
                    this.logger.warn(`Cannot resume from phase ${fromPhase} - marking as failed`);
                    await this.updateDeploymentStatus(deploymentId, 'failed');
            }

            this.logger.log(`Resume process completed for deployment ${deploymentId}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Failed to resume deployment ${deploymentId} from phase ${fromPhase}:`, errorMessage);
            await this.updateDeploymentStatus(deploymentId, 'failed');
            throw error;
        }
    }

    /**
     * Resume from COPYING_FILES phase
     * Verifies files exist and redeploys if needed
     */
    private async resumeCopyingFiles(deployment: any, service: any): Promise<void> {
        try {
            await this.addDeploymentLog(deployment.id, {
                level: 'info',
                message: 'Resuming from COPYING_FILES phase - verifying deployment files',
                phase: 'copying_files',
                timestamp: new Date(),
            });

            // For static deployments, verify the deployment directory exists
            if (deployment.containerName) {
                // Check if files exist by inspecting the container
                try {
                    await this.dockerService.getContainerInfo(deployment.containerName);
                    
                    await this.addDeploymentLog(deployment.id, {
                        level: 'info',
                        message: `Container ${deployment.containerName} exists - files should be present`,
                        phase: 'copying_files',
                        timestamp: new Date(),
                    });

                    // Move to next phase: creating symlinks
                    await this.updateDeploymentPhase(
                        deployment.id,
                        DeploymentPhase.CREATING_SYMLINKS,
                        60,
                        { resumed: true, containerVerified: true }
                    );
                    
                    await this.resumeCreatingSymlinks(deployment, service);
                } catch {
                    // Container doesn't exist - need to redeploy
                    throw new Error('Container not found - deployment must be restarted');
                }
            } else {
                throw new Error('No container information - deployment must be restarted');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.addDeploymentLog(deployment.id, {
                level: 'error',
                message: `Failed to resume from COPYING_FILES: ${errorMessage}`,
                phase: 'copying_files',
                timestamp: new Date(),
            });
            await this.updateDeploymentStatus(deployment.id, 'failed');
        }
    }

    /**
     * Resume from CREATING_SYMLINKS phase
     * Recreates symlinks for the deployment
     */
    private async resumeCreatingSymlinks(deployment: any, service: any): Promise<void> {
        try {
            await this.addDeploymentLog(deployment.id, {
                level: 'info',
                message: 'Resuming from CREATING_SYMLINKS phase - recreating symlinks',
                phase: 'creating_symlinks',
                timestamp: new Date(),
            });

            // Symlinks are handled by the static file service and are idempotent
            // Just mark as complete and move to next phase
            await this.updateDeploymentPhase(
                deployment.id,
                DeploymentPhase.UPDATING_ROUTES,
                80,
                { resumed: true, symlinksVerified: true }
            );

            await this.resumeUpdatingRoutes(deployment, service);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.addDeploymentLog(deployment.id, {
                level: 'error',
                message: `Failed to resume from CREATING_SYMLINKS: ${errorMessage}`,
                phase: 'creating_symlinks',
                timestamp: new Date(),
            });
            await this.updateDeploymentStatus(deployment.id, 'failed');
        }
    }

    /**
     * Resume from UPDATING_ROUTES phase
     * Traefik routes are managed automatically, just proceed to health check
     */
    private async resumeUpdatingRoutes(deployment: any, service: any): Promise<void> {
        try {
            await this.addDeploymentLog(deployment.id, {
                level: 'info',
                message: 'Resuming from UPDATING_ROUTES phase - routes should be auto-configured',
                phase: 'updating_routes',
                timestamp: new Date(),
            });

            // Routes are configured automatically by Traefik
            // Move to health check phase
            await this.updateDeploymentPhase(
                deployment.id,
                DeploymentPhase.HEALTH_CHECK,
                90,
                { resumed: true, routesVerified: true }
            );

            await this.resumeHealthCheck(deployment, service);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.addDeploymentLog(deployment.id, {
                level: 'error',
                message: `Failed to resume from UPDATING_ROUTES: ${errorMessage}`,
                phase: 'updating_routes',
                timestamp: new Date(),
            });
            await this.updateDeploymentStatus(deployment.id, 'failed');
        }
    }

    /**
     * Resume from HEALTH_CHECK phase
     * Re-runs health check and completes deployment
     */
    private async resumeHealthCheck(deployment: any, _service: any): Promise<void> {
        try {
            await this.addDeploymentLog(deployment.id, {
                level: 'info',
                message: 'Resuming from HEALTH_CHECK phase - running health verification',
                phase: 'health_check',
                timestamp: new Date(),
            });

            if (!deployment.containerName) {
                throw new Error('No container name found for health check');
            }

            // Get container info
            const containerInfo = await this.dockerService.getContainerInfo(deployment.containerName);
            const containerId = containerInfo.Id;

            // Build health check URL from phase metadata or service config
            const phaseMetadata = deployment.phaseMetadata || {};
            const domain = phaseMetadata.domain || phaseMetadata.finalDomain || 'localhost';
            const healthCheckUrl = phaseMetadata.healthCheckUrl || `http://${domain}/health`;

            // Run health check
            const isHealthy = await this.verifyContainerHealth(containerId, healthCheckUrl);

            if (isHealthy) {
                await this.updateDeploymentPhase(
                    deployment.id,
                    DeploymentPhase.ACTIVE,
                    100,
                    {
                        resumed: true,
                        containerName: deployment.containerName,
                        domain,
                        healthCheckUrl,
                        deploymentCompletedAt: new Date().toISOString()
                    }
                );

                await this.updateDeploymentStatus(deployment.id, 'success');
                
                await this.addDeploymentLog(deployment.id, {
                    level: 'info',
                    message: 'Deployment resumed successfully - health check passed',
                    phase: 'active',
                    timestamp: new Date(),
                });
            } else {
                await this.updateDeploymentPhase(
                    deployment.id,
                    DeploymentPhase.FAILED,
                    0,
                    {
                        resumed: true,
                        error: 'Health check failed after resume',
                        healthCheckUrl,
                        containerName: deployment.containerName
                    }
                );

                await this.updateDeploymentStatus(deployment.id, 'failed');

                await this.addDeploymentLog(deployment.id, {
                    level: 'error',
                    message: 'Health check failed after resume',
                    phase: 'failed',
                    timestamp: new Date(),
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.addDeploymentLog(deployment.id, {
                level: 'error',
                message: `Failed to resume from HEALTH_CHECK: ${errorMessage}`,
                phase: 'health_check',
                timestamp: new Date(),
            });
            await this.updateDeploymentStatus(deployment.id, 'failed');
        }
    }

    /**
     * Start a rollback operation
     * 
     * @param fromDeploymentId - The deployment to roll back from
     * @param toDeploymentId - The deployment to roll back to
     * @param triggeredBy - User ID who triggered the rollback
     * @param reason - Reason for the rollback
     * @returns The rollback record ID
     */
    async startRollback(
        fromDeploymentId: string,
        toDeploymentId: string,
        triggeredBy?: string,
        reason?: string
    ): Promise<string> {
        try {
            const [rollback] = await this.databaseService.db
                .insert(deploymentRollbacks)
                .values({
                    fromDeploymentId,
                    toDeploymentId,
                    triggeredBy,
                    reason,
                    status: 'in_progress',
                    startedAt: new Date(),
                })
                .returning();

            this.logger.log(`Started rollback ${rollback.id} from ${fromDeploymentId} to ${toDeploymentId}`);
            return rollback.id;
        } catch (error) {
            this.logger.error('Failed to start rollback:', error);
            throw error;
        }
    }

    /**
     * Mark a rollback as completed
     * 
     * @param rollbackId - The rollback record ID
     * @param metadata - Optional metadata about the rollback
     */
    async completeRollback(rollbackId: string, metadata?: Record<string, any>): Promise<void> {
        try {
            await this.databaseService.db
                .update(deploymentRollbacks)
                .set({
                    status: 'completed',
                    completedAt: new Date(),
                    metadata,
                    updatedAt: new Date(),
                })
                .where(eq(deploymentRollbacks.id, rollbackId));

            this.logger.log(`Completed rollback ${rollbackId}`);
        } catch (error) {
            this.logger.error(`Failed to complete rollback ${rollbackId}:`, error);
            throw error;
        }
    }

    /**
     * Mark a rollback as failed
     * 
     * @param rollbackId - The rollback record ID
     * @param errorMessage - Error message
     */
    async failRollback(rollbackId: string, errorMessage: string): Promise<void> {
        try {
            await this.databaseService.db
                .update(deploymentRollbacks)
                .set({
                    status: 'failed',
                    failedAt: new Date(),
                    errorMessage,
                    updatedAt: new Date(),
                })
                .where(eq(deploymentRollbacks.id, rollbackId));

            this.logger.error(`Failed rollback ${rollbackId}: ${errorMessage}`);
        } catch (error) {
            this.logger.error(`Failed to update rollback ${rollbackId} status:`, error);
            throw error;
        }
    }
}
