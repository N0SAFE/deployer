import { Controller, Get, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { deploymentContract } from '@repo/api-contracts';
import type { ContainerInfo } from '@repo/api-contracts/modules/deployment/listContainers';
import { DeploymentQueueService } from '../../jobs/services/deployment-queue.service';
import { WebSocketEventService } from '../services/websocket-event.service';
import { DockerService } from '../../../core/services/docker.service';
import { DeploymentService } from '../../../core/services/deployment.service';
import { db } from '../../../core/modules/db/drizzle/index';
import { deployments, services, projects, deploymentLogs } from '../../../core/modules/db/drizzle/schema/deployment';
import { eq, desc, count, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { Public } from '@/modules/auth/decorators/decorators';
@Controller()
export class DeploymentController {
    private readonly logger = new Logger(DeploymentController.name);
    constructor(
        private readonly queueService: DeploymentQueueService, 
        private readonly websocketService: WebSocketEventService, 
        private readonly dockerService: DockerService,
        private readonly deploymentService: DeploymentService
    ) { }

    @Public()
    @Get('test')
    test () {
        console.log('get for route test')
        this.queueService.test();
    }
    @Implement(deploymentContract.getStatus)
    getDeploymentStatus() {
        return implement(deploymentContract.getStatus).handler(async ({ input }) => {
            const { deploymentId } = input;
            this.logger.log(`Getting status for deployment ${deploymentId}`);
            const deployment = await db.select()
                .from(deployments)
                .where(eq(deployments.id, deploymentId))
                .limit(1);
            if (!deployment.length) {
                throw new Error(`Deployment ${deploymentId} not found`);
            }
            const deploymentData = deployment[0];
            // If deployment is successful, verify containers are still running
            if (deploymentData.status === 'success') {
                try {
                    const containers = await this.dockerService.listContainersByDeployment(deploymentId);
                    let runningContainers = 0;
                    let healthyContainers = 0;
                    for (const container of containers) {
                        if (container.status === 'running') {
                            runningContainers++;
                            const isHealthy = await this.dockerService.checkContainerHealth(container.id);
                            if (isHealthy) {
                                healthyContainers++;
                            }
                        }
                    }
                    // If no containers are running for a successful deployment, mark as degraded
                    if (containers.length > 0 && runningContainers === 0) {
                        this.logger.warn(`Deployment ${deploymentId} marked as success but no containers are running`);
                        // Log this discovery
                        await db.insert(deploymentLogs).values({
                            deploymentId,
                            level: 'warn',
                            message: 'Deployment marked as success but no containers are running - potential system issue',
                            phase: 'monitoring',
                            step: 'health-check',
                            service: 'docker-service',
                            stage: 'validation',
                            timestamp: new Date(),
                        });
                    }
                    this.logger.debug(`Deployment ${deploymentId}: ${runningContainers}/${containers.length} running, ${healthyContainers}/${containers.length} healthy`);
                }
                catch (error) {
                    this.logger.warn(`Failed to check container status for deployment ${deploymentId}: ${error}`);
                }
            }
            return {
                deploymentId: deploymentData.id,
                status: deploymentData.status,
                stage: deploymentData.metadata?.stage || undefined,
                progress: deploymentData.metadata?.progress || undefined,
                startedAt: deploymentData.createdAt,
                completedAt: deploymentData.updatedAt,
            };
        });
    }
    @Implement(deploymentContract.trigger)
    triggerDeployment() {
        return implement(deploymentContract.trigger).handler(async ({ input }) => {
            console.log(`🔥🔥🔥 WEBSOCKET CONTROLLER - TRIGGER INPUT:`, JSON.stringify(input, null, 2));
            const { serviceId, environment, environmentVariables } = input;
            // sourceType and sourceConfig will be determined from the service's database configuration
            let { sourceType, sourceConfig } = input;
            
            console.log(`🔥🔥🔥 WEBSOCKET CONTROLLER - Extracted values:`, { serviceId, environment, sourceType, sourceConfig });
            this.logger.log(`Triggering deployment for service ${serviceId}, environment: ${environment}`);
            
            // Test Docker connection first
            const dockerConnected = await this.dockerService.testConnection();
            if (!dockerConnected) {
                throw new Error('Docker service is not available. Please ensure Docker is running and accessible.');
            }

            // Get service and project information
            const service = await db.select({
                service: services,
                project: projects,
            })
                .from(services)
                .innerJoin(projects, eq(services.projectId, projects.id))
                .where(eq(services.id, serviceId))
                .limit(1);

            if (!service.length) {
                throw new Error(`Service ${serviceId} not found`);
            }

            const { service: serviceData, project: projectData } = service[0];

            // Determine sourceType and sourceConfig from service configuration if not provided
            if (!sourceType || !sourceConfig) {
                console.log(`🔥🔥🔥 WEBSOCKET CONTROLLER - Determining source config from service:`, {
                    provider: serviceData.provider,
                    builder: serviceData.builder,
                    providerConfig: serviceData.providerConfig
                });

                // Map service provider/builder to deployment source type
                if (serviceData.provider === 'manual' && serviceData.builder === 'static') {
                    // Static files with manual upload
                    sourceType = 'upload';
                    // Put the embedded content into customData so it conforms to the allowed sourceConfig shape
                    sourceConfig = {
                        customData: {
                            embeddedContent: serviceData.providerConfig?.deploymentScript || undefined,
                        },
                    };
                } else if (serviceData.provider === 'github') {
                    sourceType = 'github';
                    sourceConfig = {
                        repositoryUrl: serviceData.providerConfig?.repositoryUrl || '',
                        branch: serviceData.providerConfig?.branch || 'main'
                    };
                } else if (serviceData.provider === 'gitlab') {
                    sourceType = 'gitlab';
                    sourceConfig = {
                        repositoryUrl: serviceData.providerConfig?.repositoryUrl || '',
                        branch: serviceData.providerConfig?.branch || 'main'
                    };
                } else {
                    // Default fallback - this handles git provider or other cases
                    sourceType = 'git';
                    sourceConfig = {
                        repositoryUrl: serviceData.providerConfig?.repositoryUrl || '',
                        branch: serviceData.providerConfig?.branch || 'main'
                    };
                }

                console.log(`🔥🔥🔥 WEBSOCKET CONTROLLER - Determined source config:`, { sourceType, sourceConfig });
            }

            // Stop previous deployments before creating new one
            this.logger.log(`Checking for existing deployments to stop for service ${serviceId}`);
            
            const triggerInfo = {
                branchName: sourceConfig?.branch || 'main',
                pullRequestNumber: sourceConfig?.pullRequestNumber || undefined,
            };

            const stopResult = await this.deploymentService.stopPreviousDeployments(
                serviceId,
                environment,
                environment === 'preview' ? triggerInfo : undefined
            );

            if (stopResult.stoppedDeployments.length > 0) {
                this.logger.log(`Stopped ${stopResult.stoppedDeployments.length} previous deployments: ${stopResult.stoppedDeployments.join(', ')}`);
            }

            if (stopResult.errors.length > 0) {
                this.logger.warn(`Errors stopping previous deployments: ${stopResult.errors.join('; ')}`);
            }

            // Create deployment record
            const deploymentId = randomUUID();
            await db.insert(deployments).values({
                id: deploymentId,
                serviceId,
                triggeredBy: null, // Will be set to authenticated user ID in production
                status: 'pending',
                environment,
                sourceType: sourceType!, // sourceType is guaranteed to be set at this point
                sourceConfig,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Log deployment initiation with cleanup info
            const cleanupMessage = stopResult.stoppedDeployments.length > 0 
                ? `Deployment initiated - Stopped ${stopResult.stoppedDeployments.length} previous deployments - Docker connection verified`
                : 'Deployment initiated - No previous deployments to stop - Docker connection verified';

            await this.addDeploymentLog(deploymentId, 'info', cleanupMessage, {
                phase: 'initialization',
                step: 'deployment-uniqueness-check',
                service: 'deployment-service',
                stage: 'setup',
                metadata: {
                    stoppedDeployments: stopResult.stoppedDeployments,
                    stopErrors: stopResult.errors,
                    environment,
                    triggerInfo: environment === 'preview' ? triggerInfo : undefined,
                },
            });

            // Map sourceType for job queue (filter out unsupported types)
            const jobSourceType = sourceType === 'custom' ? 'upload' : sourceType as 'github' | 'gitlab' | 'git' | 'upload';
            console.log(`🔥🔥🔥 WEBSOCKET CONTROLLER - Source type mapping:`, { 
                originalSourceType: sourceType, 
                jobSourceType,
                sourceConfig: sourceConfig 
            });

            // Build job-level sourceConfig including image/pull settings from provider/builder config
            const svcProviderCfg: any = serviceData.providerConfig || {};
            const svcBuilderCfg: any = serviceData.builderConfig || {};

            // Queue the deployment job
            const jobId = await this.queueService.addDeploymentJob({
                deploymentId,
                projectId: projectData.id,
                serviceId,
                sourceConfig: {
                    type: jobSourceType,
                    repositoryUrl: sourceConfig?.repositoryUrl,
                    branch: sourceConfig?.branch,
                    commitSha: sourceConfig?.commitSha,
                    filePath: sourceConfig?.fileName,
                    fileName: sourceConfig?.fileName,
                    fileSize: sourceConfig?.fileSize,
                    // Pass through customData (contains embeddedContent for seeded static sites)
                    customData: sourceConfig?.customData,
                    envVars: environmentVariables || sourceConfig?.customData?.envVars || undefined,
                    // Image and pull policy options (optional)
                    image: svcProviderCfg.staticImage || svcProviderCfg.image || svcBuilderCfg.staticImage || svcBuilderCfg.image || undefined,
                    imagePullPolicy: svcProviderCfg.imagePullPolicy || svcBuilderCfg.imagePullPolicy || undefined,
                    registryAuth: svcProviderCfg.registryAuth || svcBuilderCfg.registryAuth || undefined,
                },
            });

            // Emit WebSocket event
            this.websocketService.emitDeploymentStarted(deploymentId, projectData.id, serviceId);

            return {
                deploymentId,
                jobId,
                status: 'queued',
                message: stopResult.stoppedDeployments.length > 0 
                    ? `Deployment has been queued and will start shortly. Stopped ${stopResult.stoppedDeployments.length} previous deployments.`
                    : 'Deployment has been queued and will start shortly',
                metadata: {
                    stoppedPreviousDeployments: stopResult.stoppedDeployments.length,
                    cleanupErrors: stopResult.errors.length,
                },
            };
        });
    }
    @Implement(deploymentContract.cancel)
    cancelDeployment() {
        return implement(deploymentContract.cancel).handler(async ({ input }) => {
            const { deploymentId, reason } = input;
            this.logger.log(`Cancelling deployment ${deploymentId}`);
            // Get deployment info before cancellation
            const deployment = await db.select({
                deployment: deployments,
                service: services,
                project: projects,
            })
                .from(deployments)
                .innerJoin(services, eq(deployments.serviceId, services.id))
                .innerJoin(projects, eq(services.projectId, projects.id))
                .where(eq(deployments.id, deploymentId))
                .limit(1);
            if (!deployment.length) {
                throw new Error(`Deployment ${deploymentId} not found`);
            }
            const { project, service: serviceData, deployment: deploymentData } = deployment[0];
            // Stop any running containers for this deployment
            try {
                await this.dockerService.stopContainersByDeployment(deploymentId);
                this.logger.log(`Stopped containers for deployment ${deploymentId}`);
                // Log the container stop action
                await db.insert(deploymentLogs).values({
                    deploymentId,
                    level: 'info',
                    message: 'Containers stopped during deployment cancellation',
                    phase: 'cancellation',
                    step: 'stop-containers',
                    service: 'docker-service',
                    stage: 'cleanup',
                    timestamp: new Date(),
                });
            }
            catch (error) {
                this.logger.warn(`Failed to stop containers for deployment ${deploymentId}: ${error}`);
                // Log the error but don't fail the cancellation
                await db.insert(deploymentLogs).values({
                    deploymentId,
                    level: 'warn',
                    message: `Warning: Could not stop containers during cancellation: ${error}`,
                    phase: 'cancellation',
                    step: 'stop-containers',
                    service: 'docker-service',
                    stage: 'cleanup',
                    timestamp: new Date(),
                });
            }
            // Update deployment status
            await db.update(deployments)
                .set({
                status: 'cancelled',
                metadata: {
                    ...deploymentData.metadata,
                    cancelReason: reason,
                    cancelledAt: new Date(),
                },
                updatedAt: new Date(),
            })
                .where(eq(deployments.id, deploymentId));
            // Log cancellation completion
            await db.insert(deploymentLogs).values({
                deploymentId,
                level: 'info',
                message: `Deployment cancelled: ${reason || 'No reason provided'}`,
                phase: 'cancellation',
                step: 'update-status',
                service: 'deployment-service',
                stage: 'completion',
                timestamp: new Date(),
            });
            // Emit WebSocket event
            this.websocketService.emitDeploymentCancelled(deploymentId, project.id, serviceData.id, reason);
            return {
                success: true,
                message: 'Deployment cancelled successfully',
            };
        });
    }
    @Implement(deploymentContract.rollback)
    rollbackDeployment() {
        return implement(deploymentContract.rollback).handler(async ({ input }) => {
            const { deploymentId, targetDeploymentId } = input;
            this.logger.log(`Rolling back deployment ${deploymentId} to ${targetDeploymentId}`);
            // Validate both deployments exist and are for the same service
            const deploymentsQuery = await db.select()
                .from(deployments)
                .where(eq(deployments.id, deploymentId));
            const targetDeploymentQuery = await db.select()
                .from(deployments)
                .where(eq(deployments.id, targetDeploymentId));
            if (!deploymentsQuery.length) {
                throw new Error(`Deployment ${deploymentId} not found`);
            }
            if (!targetDeploymentQuery.length) {
                throw new Error(`Target deployment ${targetDeploymentId} not found`);
            }
            const currentDeployment = deploymentsQuery[0];
            const targetDeployment = targetDeploymentQuery[0];
            if (currentDeployment.serviceId !== targetDeployment.serviceId) {
                throw new Error('Cannot rollback to deployment from different service');
            }
            if (targetDeployment.status !== 'success') {
                throw new Error('Target deployment must have successful status');
            }
            // Log rollback initiation
            await db.insert(deploymentLogs).values({
                deploymentId,
                level: 'info',
                message: `Starting rollback from deployment ${deploymentId} to ${targetDeploymentId}`,
                phase: 'rollback',
                step: 'initiate',
                service: 'deployment-service',
                stage: 'initialization',
                timestamp: new Date(),
            });
            try {
                // Stop current deployment containers
                await this.dockerService.stopContainersByDeployment(deploymentId);
                await db.insert(deploymentLogs).values({
                    deploymentId,
                    level: 'info',
                    message: 'Stopped current deployment containers',
                    phase: 'rollback',
                    step: 'stop-current',
                    service: 'docker-service',
                    stage: 'cleanup',
                    timestamp: new Date(),
                });
                // Start target deployment containers
                await this.dockerService.startContainersByDeployment(targetDeploymentId);
                await db.insert(deploymentLogs).values({
                    deploymentId,
                    level: 'info',
                    message: `Started target deployment containers (${targetDeploymentId})`,
                    phase: 'rollback',
                    step: 'start-target',
                    service: 'docker-service',
                    stage: 'deployment',
                    timestamp: new Date(),
                });
                // Verify target containers are healthy
                const containers = await this.dockerService.listContainersByDeployment(targetDeploymentId);
                let healthyContainers = 0;
                for (const container of containers) {
                    const isHealthy = await this.dockerService.checkContainerHealth(container.id);
                    if (isHealthy) {
                        healthyContainers++;
                    }
                }
                await db.insert(deploymentLogs).values({
                    deploymentId,
                    level: 'info',
                    message: `Health check completed: ${healthyContainers}/${containers.length} containers healthy`,
                    phase: 'rollback',
                    step: 'health-check',
                    service: 'docker-service',
                    stage: 'validation',
                    timestamp: new Date(),
                });
                // Update deployment statuses
                await db.update(deployments)
                    .set({
                    status: 'cancelled',
                    metadata: {
                        ...currentDeployment.metadata,
                        stage: 'cancelled',
                        progress: 0,
                        cancelReason: 'Manual rollback initiated',
                    },
                    updatedAt: new Date(),
                })
                    .where(eq(deployments.id, deploymentId));
                await db.update(deployments)
                    .set({
                    status: 'success',
                    metadata: {
                        ...targetDeployment.metadata,
                        stage: 'completed',
                        progress: 100,
                    },
                    updatedAt: new Date(),
                })
                    .where(eq(deployments.id, targetDeploymentId));
                // Queue rollback job for any additional orchestration
                const rollbackJobId = await this.queueService.addRollbackJob({
                    deploymentId,
                    targetDeploymentId,
                });
                await db.insert(deploymentLogs).values({
                    deploymentId,
                    level: 'info',
                    message: `Rollback completed successfully - Job ${rollbackJobId} queued for final orchestration`,
                    phase: 'rollback',
                    step: 'completion',
                    service: 'deployment-service',
                    stage: 'completion',
                    timestamp: new Date(),
                });
                return {
                    rollbackJobId,
                    message: 'Rollback completed successfully',
                };
            }
            catch (error) {
                const err = error as Error;
                this.logger.error(`Rollback failed: ${err.message}`, err);
                await db.insert(deploymentLogs).values({
                    deploymentId,
                    level: 'error',
                    message: `Rollback failed: ${err.message}`,
                    phase: 'rollback',
                    step: 'error',
                    service: 'docker-service',
                    stage: 'error',
                    metadata: {
                        errorStack: err.stack,
                    },
                    timestamp: new Date(),
                });
                throw error;
            }
        });
    }
    @Implement(deploymentContract.getLogs)
    getDeploymentLogs() {
        return implement(deploymentContract.getLogs).handler(async ({ input }) => {
            const { deploymentId, limit, offset } = input;
            this.logger.log(`Getting logs for deployment ${deploymentId}`);
            // Get logs from deploymentLogs table
            const logs = await db.select()
                .from(deploymentLogs)
                .where(eq(deploymentLogs.deploymentId, deploymentId))
                .orderBy(desc(deploymentLogs.timestamp))
                .limit(limit)
                .offset(offset);
            // Get total count
            const totalResult = await db.select({ count: count() })
                .from(deploymentLogs)
                .where(eq(deploymentLogs.deploymentId, deploymentId));
            const total = totalResult[0]?.count || 0;
            const hasMore = offset + limit < total;
            return {
                logs: logs.map(log => ({
                    id: log.id,
                    timestamp: log.timestamp,
                    level: log.level,
                    message: log.message,
                    service: log.service ?? undefined,
                    stage: log.stage ?? undefined,
                })),
                total,
                hasMore,
            };
        });
    }
    @Implement(deploymentContract.list)
    listDeployments() {
        return implement(deploymentContract.list).handler(async ({ input }) => {
            const { serviceId, limit, offset, status } = input;
            this.logger.log(`Listing deployments${serviceId ? ` for service ${serviceId}` : ''}`);
            
            // Get deployments from database
            let deploymentList;
            let totalResult;
            
            if (serviceId && serviceId.trim() !== '') {
                // Validate UUID format before querying
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                if (!uuidRegex.test(serviceId)) {
                    throw new Error(`Invalid service ID format: ${serviceId}`);
                }
                
                if (status) {
                    deploymentList = await db.select()
                        .from(deployments)
                        .where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, status)))
                        .orderBy(desc(deployments.createdAt))
                        .limit(limit)
                        .offset(offset);
                    
                    totalResult = await db.select({ count: count() })
                        .from(deployments)
                        .where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, status)));
                } else {
                    deploymentList = await db.select()
                        .from(deployments)
                        .where(eq(deployments.serviceId, serviceId))
                        .orderBy(desc(deployments.createdAt))
                        .limit(limit)
                        .offset(offset);
                    
                    totalResult = await db.select({ count: count() })
                        .from(deployments)
                        .where(eq(deployments.serviceId, serviceId));
                }
            } else {
                if (status) {
                    deploymentList = await db.select()
                        .from(deployments)
                        .where(eq(deployments.status, status))
                        .orderBy(desc(deployments.createdAt))
                        .limit(limit)
                        .offset(offset);
                    
                    totalResult = await db.select({ count: count() })
                        .from(deployments)
                        .where(eq(deployments.status, status));
                } else {
                    deploymentList = await db.select()
                        .from(deployments)
                        .orderBy(desc(deployments.createdAt))
                        .limit(limit)
                        .offset(offset);
                    
                    totalResult = await db.select({ count: count() })
                        .from(deployments);
                }
            }
            
            const total = totalResult[0]?.count || 0;
            const hasMore = offset + limit < total;
            
            return {
                deployments: deploymentList.map(deployment => ({
                    id: deployment.id,
                    serviceId: deployment.serviceId,
                    status: deployment.status,
                    environment: deployment.environment,
                    triggeredBy: deployment.triggeredBy,
                    createdAt: deployment.createdAt,
                    updatedAt: deployment.updatedAt,
                    metadata: deployment.metadata ?? undefined,
                })),
                total,
                hasMore,
            };
        });
    }
    /**
     * Helper method to get deployment container status
     */
    async getDeploymentContainerStatus(deploymentId: string): Promise<{
        totalContainers: number;
        runningContainers: number;
        healthyContainers: number;
        containers: Array<{
            id: string;
            name: string;
            status: string;
            healthy: boolean;
        }>;
    }> {
        try {
            const containers = await this.dockerService.listContainersByDeployment(deploymentId);
            let runningContainers = 0;
            let healthyContainers = 0;
            const containerDetails = await Promise.all(containers.map(async (container) => {
                const isRunning = container.status === 'running';
                const isHealthy = isRunning ? await this.dockerService.checkContainerHealth(container.id) : false;
                if (isRunning)
                    runningContainers++;
                if (isHealthy)
                    healthyContainers++;
                return {
                    id: container.id,
                    name: container.name,
                    status: container.status,
                    healthy: isHealthy,
                };
            }));
            return {
                totalContainers: containers.length,
                runningContainers,
                healthyContainers,
                containers: containerDetails,
            };
        }
        catch (error) {
            this.logger.error(`Failed to get container status for deployment ${deploymentId}:`, error);
            return {
                totalContainers: 0,
                runningContainers: 0,
                healthyContainers: 0,
                containers: [],
            };
        }
    }

    @Implement(deploymentContract.health)
    health() {
        return implement(deploymentContract.health).handler(async ({ input }) => {
            this.logger.log(`Getting health status for deployment: ${input.deploymentId}`);
            
            try {
                const healthStatus = await this.deploymentService.monitorDeploymentHealth(input.deploymentId);
                return healthStatus;
            }
            catch (error) {
                this.logger.error(`Error getting health status for deployment ${input.deploymentId}:`, error);
                throw error;
            }
        });
    }

    @Implement(deploymentContract.detailedStatus)
    detailedStatus() {
        return implement(deploymentContract.detailedStatus).handler(async ({ input }) => {
            this.logger.log(`Getting detailed status for deployment: ${input.deploymentId}`);
            
            try {
                const deploymentStatus = await this.deploymentService.getDeploymentStatus(input.deploymentId);
                return deploymentStatus;
            }
            catch (error) {
                this.logger.error(`Error getting detailed status for deployment ${input.deploymentId}:`, error);
                throw error;
            }
        });
    }

    @Implement(deploymentContract.restartUnhealthy)
    restartUnhealthy() {
        return implement(deploymentContract.restartUnhealthy).handler(async ({ input }) => {
            this.logger.log(`Restarting unhealthy containers for deployment: ${input.deploymentId}`);
            
            try {
                const restartResult = await this.deploymentService.restartUnhealthyContainers(input.deploymentId);
                return restartResult;
            }
            catch (error) {
                this.logger.error(`Error restarting unhealthy containers for deployment ${input.deploymentId}:`, error);
                throw error;
            }
        });
    }

    @Implement(deploymentContract.listContainers)
    listContainers() {
        return implement(deploymentContract.listContainers).handler(async ({ input }) => {
            this.logger.log(`Listing containers with filters:`, input);
            
            try {
                // Get all deployments with their associated containers
                const query = db
                    .select({
                        deployment: deployments,
                        service: services,
                        project: projects
                    })
                    .from(deployments)
                    .leftJoin(services, eq(deployments.serviceId, services.id))
                    .leftJoin(projects, eq(services.projectId, projects.id))
                    .where(and(
                        input.status && input.status !== 'all' ? eq(deployments.status, input.status as any) : undefined,
                        input.service ? eq(services.name, input.service) : undefined,
                        input.project ? eq(projects.name, input.project) : undefined,
                        input.environment ? eq(deployments.environment, input.environment) : undefined
                    ))
                    .orderBy(desc(deployments.createdAt));

                const results = await query.limit(input.limit || 50).offset(input.offset || 0);
                
                // Get container information for each deployment
                const containers: ContainerInfo[] = [];
                const containerStats = { running: 0, stopped: 0, failed: 0, healthy: 0 };
                
                for (const result of results) {
                    const deployment = result.deployment;
                    const service = result.service;
                    const project = result.project;
                    
                    if (!service || !project || !deployment.containerName) continue;
                    
                    try {
                        // Get Docker container info
                        const containerInfo = await this.dockerService.getContainerInfo(deployment.containerName);
                        
                        // Simple health status based on container state
                        const isHealthy = containerInfo.State.Running && containerInfo.State.Health?.Status === 'healthy';
                        const healthStatus = {
                            isHealthy,
                            status: containerInfo.State.Health?.Status || (containerInfo.State.Running ? 'running' : 'stopped'),
                            uptime: containerInfo.State.Running ? Math.floor((new Date().getTime() - new Date(containerInfo.State.StartedAt).getTime()) / 1000) : 0,
                            resources: {
                                cpuUsage: undefined,
                                memoryUsage: undefined,
                                memoryLimit: undefined,
                            },
                        };
                        
                        // Determine container status
                        let status: 'running' | 'stopped' | 'failed' | 'starting' | 'stopping' = 'stopped';
                        if (containerInfo.State.Running) {
                            status = 'running';
                            containerStats.running++;
                        } else if (containerInfo.State.ExitCode !== 0) {
                            status = 'failed';
                            containerStats.failed++;
                        } else {
                            status = 'stopped';
                            containerStats.stopped++;
                        }
                        
                        if (healthStatus.isHealthy) {
                            containerStats.healthy++;
                        }
                        
                        containers.push({
                            containerId: containerInfo.Id,
                            containerName: deployment.containerName,
                            deploymentId: deployment.id,
                            serviceId: service.id,
                            serviceName: service.name,
                            projectId: project.id,
                            projectName: project.name,
                            environment: deployment.environment,
                            status,
                            health: {
                                isHealthy: healthStatus.isHealthy,
                                status: healthStatus.status,
                                uptime: healthStatus.uptime,
                                restartCount: containerInfo.RestartCount || 0,
                                lastStarted: containerInfo.State.StartedAt ? new Date(containerInfo.State.StartedAt) : null,
                                resources: {
                                    cpuUsage: healthStatus.resources?.cpuUsage,
                                    memoryUsage: healthStatus.resources?.memoryUsage,
                                    memoryLimit: healthStatus.resources?.memoryLimit,
                                },
                            },
                            metadata: {
                                imageTag: deployment.containerImage || undefined,
                                ports: undefined, // Port info not stored in deployment table
                                createdAt: deployment.createdAt,
                                triggeredBy: deployment.triggeredBy || undefined,
                                triggerType: (deployment.sourceConfig as any)?.triggerType || 'manual',
                                triggerSource: (deployment.sourceConfig as any)?.repositoryUrl || undefined,
                            },
                        });
                    } catch (containerError) {
                        this.logger.warn(`Failed to get info for container ${deployment.containerName}:`, containerError);
                        // Add container with failed status if Docker container doesn't exist
                        containers.push({
                            containerId: deployment.containerName || 'unknown',
                            containerName: deployment.containerName || 'unknown',
                            deploymentId: deployment.id,
                            serviceId: service.id,
                            serviceName: service.name,
                            projectId: project.id,
                            projectName: project.name,
                            environment: deployment.environment,
                            status: 'failed' as const,
                            health: {
                                isHealthy: false,
                                status: 'container not found',
                                uptime: 0,
                                restartCount: 0,
                                lastStarted: null,
                                resources: {},
                            },
                            metadata: {
                                imageTag: deployment.containerImage || undefined,
                                ports: undefined, // Port info not stored in deployment table
                                createdAt: deployment.createdAt,
                                triggeredBy: deployment.triggeredBy || undefined,
                                triggerType: (deployment.sourceConfig as any)?.triggerType || 'manual',
                                triggerSource: (deployment.sourceConfig as any)?.repositoryUrl || undefined,
                            },
                        });
                        containerStats.failed++;
                    }
                }
                
                // Get total count for pagination
                const totalQuery = db
                    .select({ count: count() })
                    .from(deployments)
                    .leftJoin(services, eq(deployments.serviceId, services.id))
                    .leftJoin(projects, eq(services.projectId, projects.id))
                    .where(and(
                        input.status && input.status !== 'all' ? eq(deployments.status, input.status as any) : undefined,
                        input.service ? eq(services.name, input.service) : undefined,
                        input.project ? eq(projects.name, input.project) : undefined,
                        input.environment ? eq(deployments.environment, input.environment) : undefined
                    ));
                
                const [totalResult] = await totalQuery;
                const total = totalResult?.count || 0;
                
                return {
                    containers,
                    pagination: {
                        total,
                        limit: input.limit || 50,
                        offset: input.offset || 0,
                        hasMore: (input.offset || 0) + containers.length < total,
                    },
                    summary: {
                        totalContainers: containers.length,
                        runningContainers: containerStats.running,
                        stoppedContainers: containerStats.stopped,
                        failedContainers: containerStats.failed,
                        healthyContainers: containerStats.healthy,
                    },
                };
            } catch (error) {
                this.logger.error('Error listing containers:', error);
                throw error;
            }
        });
    }

    @Implement(deploymentContract.containerAction)
    containerAction() {
        return implement(deploymentContract.containerAction).handler(async ({ input }) => {
            const { containerId, action } = input;
            this.logger.log(`Performing action ${action} on container ${containerId}`);
            
            try {
                let success = false;
                let message = '';
                
                // Get container instance from Docker
                const container = (this.dockerService as any).docker.getContainer(containerId);
                
                switch (action) {
                    case 'start':
                        await container.start();
                        success = true;
                        message = 'Container started successfully';
                        break;
                    case 'stop':
                        await container.stop();
                        success = true;
                        message = 'Container stopped successfully';
                        break;
                    case 'restart':
                        await container.restart();
                        success = true;
                        message = 'Container restarted successfully';
                        break;
                    case 'remove':
                        await container.remove({ force: true });
                        success = true;
                        message = 'Container removed successfully';
                        break;
                    default:
                        throw new Error(`Unknown action: ${action}`);
                }
                
                return {
                    containerId,
                    action,
                    success,
                    message,
                    timestamp: new Date(),
                };
            } catch (error) {
                this.logger.error(`Error performing action ${action} on container ${containerId}:`, error);
                return {
                    containerId,
                    action,
                    success: false,
                    message: error instanceof Error ? error.message : 'Unknown error',
                    timestamp: new Date(),
                };
            }
        });
    }

    /**
     * Helper method to add deployment logs with consistent structure
     */
    private async addDeploymentLog(deploymentId: string, level: 'info' | 'warn' | 'error', message: string, options: {
        phase?: string;
        step?: string;
        service?: string;
        stage?: string;
        metadata?: Record<string, any>;
    } = {}): Promise<void> {
        await db.insert(deploymentLogs).values({
            deploymentId,
            level,
            message,
            phase: options.phase || null,
            step: options.step || null,
            service: options.service || null,
            stage: options.stage || null,
            metadata: options.metadata || {},
            timestamp: new Date(),
        });
    }
}
