import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { deploymentContract } from '@repo/api-contracts';
import { DeploymentQueueService } from '../../jobs/services/deployment-queue.service';
import { WebSocketEventService } from '../services/websocket-event.service';
import { DockerService } from '../../../core/services/docker.service';
import { db } from '../../../core/modules/db/drizzle/index';
import { deployments, services, projects, deploymentLogs } from '../../../core/modules/db/drizzle/schema/deployment';
import { eq, desc, count, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
@Controller()
export class DeploymentController {
    private readonly logger = new Logger(DeploymentController.name);
    constructor(private readonly queueService: DeploymentQueueService, private readonly websocketService: WebSocketEventService, private readonly dockerService: DockerService) { }
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
            const { serviceId, environment, sourceType, sourceConfig } = input;
            this.logger.log(`Triggering deployment for service ${serviceId}`);
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
            const { project: projectData } = service[0];
            // Create deployment record
            const deploymentId = randomUUID();
            await db.insert(deployments).values({
                id: deploymentId,
                serviceId,
                triggeredBy: null, // Will be set to authenticated user ID in production
                status: 'pending',
                environment,
                sourceType,
                sourceConfig,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            // Log deployment initiation
            await this.addDeploymentLog(deploymentId, 'info', 'Deployment initiated - Docker connection verified', {
                phase: 'initialization',
                step: 'docker-connection-check',
                service: 'deployment-service',
                stage: 'setup',
            });
            // Map sourceType for job queue (filter out unsupported types)
            const jobSourceType = sourceType === 'custom' ? 'upload' : sourceType as 'github' | 'gitlab' | 'git' | 'upload';
            // Queue the deployment job
            const jobId = await this.queueService.addDeploymentJob({
                deploymentId,
                projectId: projectData.id,
                serviceId,
                sourceConfig: {
                    type: jobSourceType,
                    repositoryUrl: sourceConfig.repositoryUrl,
                    branch: sourceConfig.branch,
                    commitSha: sourceConfig.commitSha,
                    filePath: sourceConfig.fileName,
                },
            });
            // Emit WebSocket event
            this.websocketService.emitDeploymentStarted(deploymentId, projectData.id, serviceId);
            return {
                deploymentId,
                jobId,
                status: 'queued',
                message: 'Deployment has been queued and will start shortly',
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
