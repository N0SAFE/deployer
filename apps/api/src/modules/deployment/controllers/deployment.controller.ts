import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { deploymentContract } from '@repo/api-contracts';
import { DeploymentQueueService } from '../../jobs/services/deployment-queue.service';
import { DockerService } from '../../../core/services/docker.service';
import { ServiceRepository } from '../../service/repositories/service.repository';
import { ServiceService } from '../../service/services/service.service';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { DeploymentService } from '../../../core/services/deployment.service';
import { deployments, deploymentLogs } from '../../../core/modules/db/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
@Controller("other")
export class DeploymentController {
    private readonly logger = new Logger(DeploymentController.name);
    constructor(private readonly deploymentQueueService: DeploymentQueueService, private readonly dockerService: DockerService, private readonly serviceRepository: ServiceRepository, private readonly serviceService: ServiceService, private readonly databaseService: DatabaseService, private readonly deploymentService: DeploymentService) { }
    @Implement(deploymentContract.jobStatus)
    jobStatus() {
        return implement(deploymentContract.jobStatus).handler(async ({ input }) => {
            this.logger.log(`Getting job status for job: ${input.jobId}`);
            try {
                const job = await this.deploymentQueueService.getJobStatus(input.jobId);
                // Map Bull job state to contract status
                const statusMap: Record<string, 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'> = {
                    waiting: 'waiting',
                    active: 'active',
                    completed: 'completed',
                    failed: 'failed',
                    delayed: 'delayed',
                };
                const mappedStatus = statusMap[job.status] || 'waiting';
                return {
                    id: job.id,
                    status: mappedStatus,
                    progress: typeof job.progress === 'number' ? job.progress : 0,
                    data: job.data ?? {},
                    result: job.result ?? {},
                    failedReason: typeof job.error === 'string' ? job.error : undefined,
                    processedOn: job.data?.processedOn ?? undefined,
                    finishedOn: job.data?.finishedOn ?? undefined,
                    delay: job.data?.delay ?? undefined,
                    timestamp: job.data?.timestamp ?? new Date().toISOString(),
                };
            }
            catch (error) {
                this.logger.error(`Job status error: ${error}`);
                throw error;
            }
        });
    }

    @Implement(deploymentContract.getStatus)
    getStatus() {
        return implement(deploymentContract.getStatus).handler(async ({ input }) => {
            this.logger.log(`Getting status for deployment: ${input.deploymentId}`);
            try {
                // Get deployment from database
                const [deployment] = await this.databaseService.db
                    .select()
                    .from(deployments)
                    .where(eq(deployments.id, input.deploymentId))
                    .limit(1);
                if (!deployment) {
                    throw new Error(`Deployment ${input.deploymentId} not found`);
                }
                // Get container health status if deployment has containers
                let containerHealthy = false;
                if (deployment.status === 'success' && deployment.containerName) {
                    const containers = await this.dockerService.listContainersByDeployment(deployment.id);
                    if (containers.length > 0) {
                        containerHealthy = await this.dockerService.checkContainerHealth(containers[0].id);
                    }
                }
                return {
                    deploymentId: input.deploymentId,
                    status: deployment.status as 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled',
                    stage: this.mapStatusToStage(deployment.status),
                    progress: this.calculateProgress(deployment.status, containerHealthy),
                    startedAt: deployment.buildStartedAt || deployment.createdAt,
                    completedAt: deployment.deployCompletedAt || undefined,
                };
            }
            catch (error) {
                this.logger.error(`Error getting deployment status: ${error}`);
                throw error;
            }
        });
    }
    @Implement(deploymentContract.trigger)
    trigger() {
        return implement(deploymentContract.trigger).handler(async ({ input }) => {
            console.log(`🚀🚀🚀 TRIGGER START - Service ID: ${input.serviceId}`);
            this.logger.log(`Triggering deployment for service: ${input.serviceId}`);
            try {
                console.log(`🔍 Step 1: Testing Docker connection`);
                // Verify Docker connection first
                const dockerConnected = await this.dockerService.testConnection();
                if (!dockerConnected) {
                    throw new Error('Docker service is not available. Cannot trigger deployment.');
                }
                this.logger.log(`Docker connection successful`);
                
                console.log(`🔍 Step 2: Looking up service`);
                // Get service details
                this.logger.log(`Looking up service: ${input.serviceId}`);
                const service = await this.serviceRepository.findById(input.serviceId);
                console.log(`🔍 Step 3: Service lookup result - found: ${!!service}`);
                this.logger.log(`Service lookup result:`, { 
                    found: !!service, 
                    serviceId: service?.id, 
                    isActive: service?.isActive 
                });
                
                if (!service) {
                    throw new Error(`Service ${input.serviceId} not found`);
                }
                if (!service.isActive) {
                    throw new Error(`Service ${input.serviceId} is not active`);
                }
                
                console.log(`🔍 Step 4: About to log service config`);
                // Log service configuration for debugging - using console.log to ensure it shows up
                console.log(`=== SERVICE CONFIGURATION DEBUG ===`);
                console.log(`Service ID: ${input.serviceId}`);
                console.log(`Provider: ${service.provider}`);
                console.log(`Builder: ${service.builder}`);
                console.log(`Provider Config:`, service.providerConfig);
                console.log(`=== END SERVICE DEBUG ===`);
                
                // Also use logger
                this.logger.log(`Service configuration for ${input.serviceId}:`, {
                    provider: service.provider,
                    builder: service.builder,
                    providerConfig: service.providerConfig,
                });
                
                console.log(`=== SIMPLE SERVICE DEBUG ===`);
                console.log(`Provider: ${service.provider}`);
                console.log(`Builder: ${service.builder}`);
                console.log(`=== END SIMPLE DEBUG ===`);
                
                // Safely handle provider config to ensure it's serializable
                let safeProviderConfig: any = {};
                try {
                    if (service.providerConfig) {
                        // Create a clean object with only serializable properties
                        const config = typeof service.providerConfig === 'object' 
                            ? service.providerConfig
                            : JSON.parse(service.providerConfig as string);
                        
                        this.logger.log(`Parsed provider config:`, config);
                        
                        // Manually copy only safe properties to avoid serialization issues
                        safeProviderConfig = {};
                        for (const [key, value] of Object.entries(config)) {
                            if (value !== null && value !== undefined) {
                                // Only include primitive values and plain objects
                                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                                    safeProviderConfig[key] = value;
                                } else if (typeof value === 'object' && !Array.isArray(value)) {
                                    // For objects, try to JSON stringify/parse to ensure serializability
                                    try {
                                        safeProviderConfig[key] = JSON.parse(JSON.stringify(value));
                                    } catch {
                                        this.logger.warn(`Skipping non-serializable property ${key} in provider config`);
                                    }
                                } else if (Array.isArray(value)) {
                                    // For arrays, only include if all elements are serializable
                                    try {
                                        safeProviderConfig[key] = JSON.parse(JSON.stringify(value));
                                    } catch {
                                        this.logger.warn(`Skipping non-serializable array property ${key} in provider config`);
                                    }
                                }
                            }
                        }
                        
                        this.logger.log(`Safe provider config:`, safeProviderConfig);
                    } else {
                        this.logger.warn(`Service ${input.serviceId} has no provider config`);
                        console.log(`WARNING: Service ${input.serviceId} has no provider config`);
                    }
                } catch (configError) {
                    this.logger.warn(`Failed to parse provider config for service ${input.serviceId}:`, configError);
                    safeProviderConfig = {};
                }
                
                // Create deployment record
                const [deployment] = await this.databaseService.db
                    .insert(deployments)
                    .values({
                    serviceId: input.serviceId,
                    triggeredBy: 'user', // TODO: Get from auth context
                    status: 'queued',
                    environment: 'production',
                    sourceType: this.mapServiceProviderToSourceType(service.provider),
                    sourceConfig: safeProviderConfig,
                    metadata: {
                        stage: 'queued',
                        progress: 0,
                    },
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                    .returning();
                this.logger.log(`Created deployment record: ${deployment.id}`);
                
                // Add deployment log
                await this.serviceRepository.createDeploymentLog({
                    deploymentId: deployment.id,
                    level: 'info',
                    message: `Deployment triggered for service ${service.name}`,
                    phase: 'initialization',
                    step: 'trigger',
                    service: service.name,
                    stage: 'queued',
                    metadata: {
                        serviceId: input.serviceId,
                        triggeredBy: 'user',
                        provider: service.provider,
                        builder: service.builder,
                    },
                });
                
                // Safely handle environment variables
                let safeEnvironmentVariables: Record<string, string> = {};
                try {
                    if (service.environmentVariables) {
                        const envVars = typeof service.environmentVariables === 'object'
                            ? service.environmentVariables
                            : JSON.parse(service.environmentVariables as string);
                        
                        // Ensure all environment variables are strings
                        safeEnvironmentVariables = {};
                        for (const [key, value] of Object.entries(envVars)) {
                            if (value !== null && value !== undefined) {
                                // Convert all values to strings for environment variables
                                safeEnvironmentVariables[key] = String(value);
                            }
                        }
                    }
                } catch (envError) {
                    this.logger.warn(`Failed to parse environment variables for service ${input.serviceId}:`, envError);
                    safeEnvironmentVariables = {};
                }
                
                // Queue deployment job with sanitized data
                const sourceType = this.mapServiceProviderToSourceType(service.provider);
                let sourceConfig = {
                    type: sourceType,
                    ...safeProviderConfig,
                    envVars: safeEnvironmentVariables,
                };

                // Auto-fix common misconfiguration: git provider with static builder but no repository URL
                // OR manual provider that's incorrectly mapped to git type
                if (((sourceType === 'git' || sourceType === 'github' || sourceType === 'gitlab') && 
                     service.builder === 'static' && 
                     !sourceConfig.repositoryUrl) ||
                    (service.provider === 'manual' && sourceType === 'git')) {
                    
                    this.logger.warn(`Service ${input.serviceId} has provider '${service.provider}' with builder '${service.builder}' ` +
                                   `but sourceType is '${sourceType}'. Auto-converting to upload type for static file deployment.`);
                    
                    sourceConfig = {
                        type: 'upload',
                        envVars: safeEnvironmentVariables,
                        // For seeded static demo service, check if deploymentScript contains static files
                        ...(safeProviderConfig.deploymentScript ? {
                            staticContent: safeProviderConfig.deploymentScript,
                            contentType: 'embedded'
                        } : {}),
                        // Keep other provider config that might be useful
                        instructions: safeProviderConfig.instructions,
                    };
                }

                this.logger.log(`Final source config for deployment:`, sourceConfig);
                console.log(`=== FINAL SOURCE CONFIG ===`);
                console.log(JSON.stringify(sourceConfig, null, 2));
                console.log(`=== END SOURCE CONFIG ===`);

                // Validate required configuration based on provider type
                try {
                    this.validateProviderConfiguration(service.provider, service.builder, sourceConfig);
                } catch (validationError) {
                    this.logger.error(`Validation failed for service ${input.serviceId}:`, validationError);
                    
                    // If it's a git provider without repository URL, suggest changing to manual
                    if (validationError instanceof Error && validationError.message.includes('Repository URL is required')) {
                        const helpfulError = new Error(
                            `${validationError.message}\n\n` +
                            `💡 If you want to deploy static files without a git repository:\n` +
                            `   1. Change the service provider from '${service.provider}' to 'manual'\n` +
                            `   2. Use the file upload feature in the dashboard\n` +
                            `   3. The static builder works great with manual file uploads\n\n` +
                            `Or configure a repository URL in the service settings for git-based deployment.`
                        );
                        throw helpfulError;
                    }
                    throw validationError;
                }

                const jobData = {
                    deploymentId: deployment.id,
                    serviceId: input.serviceId,
                    projectId: service.projectId,
                    sourceConfig,
                };
                
                // Verify job data is serializable before queuing
                try {
                    JSON.stringify(jobData);
                } catch (serializationError) {
                    this.logger.error(`Job data is not serializable:`, serializationError);
                    throw new Error('Failed to prepare deployment job data - contains non-serializable properties');
                }
                
                const jobId = await this.deploymentQueueService.addDeploymentJob(jobData);
                this.logger.log(`Queued deployment job: ${jobId} for deployment: ${deployment.id}`);
                return {
                    deploymentId: deployment.id,
                    jobId,
                    status: 'queued',
                    message: 'Deployment has been queued successfully',
                };
            }
            catch (error) {
                this.logger.error(`Failed to trigger deployment for service ${input.serviceId}:`, error);
                // Create a serializable error object
                const serializableError = new Error(
                    error instanceof Error 
                        ? error.message 
                        : 'Unknown deployment error occurred'
                );
                throw serializableError;
            }
        });
    }
    @Implement(deploymentContract.cancel)
    cancel() {
        return implement(deploymentContract.cancel).handler(async ({ input }) => {
            this.logger.log(`Cancelling deployment: ${input.deploymentId}`);
            try {
                // Get deployment details
                const [deployment] = await this.databaseService.db
                    .select()
                    .from(deployments)
                    .where(eq(deployments.id, input.deploymentId))
                    .limit(1);
                if (!deployment) {
                    throw new Error(`Deployment ${input.deploymentId} not found`);
                }
                if (deployment.status === 'cancelled') {
                    return {
                        success: true,
                        message: 'Deployment was already cancelled',
                        deploymentId: input.deploymentId,
                    };
                }
                if (deployment.status === 'success' || deployment.status === 'failed') {
                    throw new Error(`Cannot cancel deployment with status: ${deployment.status}`);
                }
                // Stop any running containers for this deployment
                await this.dockerService.stopContainersByDeployment(input.deploymentId);
                this.logger.log(`Stopped containers for deployment: ${input.deploymentId}`);
                // Try to cancel the job if it's still queued/running
                try {
                    const jobs = await this.deploymentQueueService.getDeploymentJobs(input.deploymentId);
                    for (const job of jobs) {
                        if (job.data && ['waiting', 'active', 'delayed'].includes(job.opts?.jobId ? await job.getState() : 'completed')) {
                            await this.deploymentQueueService.cancelJob(job.id?.toString() || "unknown");
                            this.logger.log(`Cancelled job: ${job.id}`);
                        }
                    }
                }
                catch (jobError) {
                    this.logger.warn(`Failed to cancel job for deployment ${input.deploymentId}: ${jobError}`);
                    // Continue with deployment cancellation even if job cancellation fails
                }
                // Update deployment status to cancelled
                await this.databaseService.db
                    .update(deployments)
                    .set({
                    status: 'cancelled',
                    metadata: {
                        ...deployment.metadata as any,
                        cancelReason: 'user_requested',
                        cancelledAt: new Date().toISOString(),
                    },
                    updatedAt: new Date(),
                })
                    .where(eq(deployments.id, input.deploymentId));
                // Add cancellation log
                await this.serviceRepository.createDeploymentLog({
                    deploymentId: input.deploymentId,
                    level: 'info',
                    message: 'Deployment cancelled by user request',
                    phase: 'cancellation',
                    step: 'cancel',
                    stage: 'cancelled',
                    metadata: {
                        cancelReason: 'user_requested',
                        cancelledAt: new Date().toISOString(),
                    },
                });
                return {
                    success: true,
                    message: 'Deployment cancelled successfully',
                    deploymentId: input.deploymentId,
                };
            }
            catch (error) {
                this.logger.error(`Failed to cancel deployment ${input.deploymentId}:`, error);
                throw error;
            }
        });
    }
    @Implement(deploymentContract.rollback)
    rollback() {
        return implement(deploymentContract.rollback).handler(async ({ input }) => {
            this.logger.log(`Rolling back deployment: ${input.deploymentId} to target: ${input.targetDeploymentId}`);
            try {
                // Verify both deployments exist
                const [currentDeployment] = await this.databaseService.db
                    .select()
                    .from(deployments)
                    .where(eq(deployments.id, input.deploymentId))
                    .limit(1);
                const [targetDeployment] = await this.databaseService.db
                    .select()
                    .from(deployments)
                    .where(eq(deployments.id, input.targetDeploymentId))
                    .limit(1);
                if (!currentDeployment) {
                    throw new Error(`Current deployment ${input.deploymentId} not found`);
                }
                if (!targetDeployment) {
                    throw new Error(`Target deployment ${input.targetDeploymentId} not found`);
                }
                if (currentDeployment.serviceId !== targetDeployment.serviceId) {
                    throw new Error('Deployments must belong to the same service');
                }
                if (targetDeployment.status !== 'success') {
                    throw new Error(`Target deployment status is ${targetDeployment.status}, must be 'success'`);
                }
                // Queue rollback job
                const rollbackJobId = await this.deploymentQueueService.addRollbackJob({
                    deploymentId: input.deploymentId,
                    targetDeploymentId: input.targetDeploymentId,
                });
                // Add rollback initiation log
                await this.serviceRepository.createDeploymentLog({
                    deploymentId: input.deploymentId,
                    level: 'info',
                    message: `Rollback initiated to deployment ${input.targetDeploymentId}`,
                    phase: 'rollback',
                    step: 'initiate',
                    stage: 'rollback_queued',
                    metadata: {
                        targetDeploymentId: input.targetDeploymentId,
                        targetVersion: targetDeployment.metadata?.version || 'unknown',
                        rollbackJobId,
                    },
                });
                this.logger.log(`Rollback job queued: ${rollbackJobId}`);
                return {
                    rollbackJobId,
                    message: 'Rollback has been initiated successfully',
                };
            }
            catch (error) {
                this.logger.error(`Failed to initiate rollback:`, error);
                throw error;
            }
        });
    }
    @Implement(deploymentContract.getLogs)
    getLogs() {
        return implement(deploymentContract.getLogs).handler(async ({ input }) => {
            this.logger.log(`Getting logs for deployment: ${input.deploymentId}`);
            try {
                // Get deployment to verify it exists
                const [deployment] = await this.databaseService.db
                    .select()
                    .from(deployments)
                    .where(eq(deployments.id, input.deploymentId))
                    .limit(1);
                if (!deployment) {
                    throw new Error(`Deployment ${input.deploymentId} not found`);
                }
                // Get logs from database
                const logs = await this.serviceRepository.findDeploymentLogs(input.deploymentId, {}, // No filters for now, could be extended
                input.limit || 100, input.offset || 0);
                // Count total logs for pagination
                const totalLogsQuery = await this.databaseService.db
                    .select()
                    .from(deploymentLogs)
                    .where(eq(deploymentLogs.deploymentId, input.deploymentId));
                const total = totalLogsQuery.length;
                const formattedLogs = logs.map(log => ({
                    id: log.id,
                    timestamp: log.timestamp,
                    level: log.level as 'info' | 'warn' | 'error' | 'debug',
                    message: log.message,
                    service: log.service || 'deployment-service',
                    stage: log.stage || 'unknown',
                }));
                return {
                    logs: formattedLogs,
                    total,
                    hasMore: (input.offset || 0) + (input.limit || 100) < total,
                };
            }
            catch (error) {
                this.logger.error(`Error getting logs for deployment ${input.deploymentId}:`, error);
                throw error;
            }
        });
    }
    @Implement(deploymentContract.list)
    list() {
        return implement(deploymentContract.list).handler(async ({ input }) => {
            this.logger.log('Listing deployments');
            try {
                // Get deployments from database
                let allDeployments;
                if (input.serviceId && input.serviceId.trim() !== '') {
                    // Validate UUID format before querying
                    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                    if (!uuidRegex.test(input.serviceId)) {
                        throw new Error(`Invalid service ID format: ${input.serviceId}`);
                    }
                    
                    allDeployments = await this.databaseService.db
                        .select()
                        .from(deployments)
                        .where(eq(deployments.serviceId, input.serviceId))
                        .orderBy(desc(deployments.createdAt));
                }
                else {
                    allDeployments = await this.databaseService.db
                        .select()
                        .from(deployments)
                        .orderBy(desc(deployments.createdAt));
                }
                // Apply status filter
                let filteredDeployments = allDeployments;
                if (input.status) {
                    filteredDeployments = filteredDeployments.filter(d => d.status === input.status);
                }
                // Apply pagination
                const limit = input.limit || 20;
                const offset = input.offset || 0;
                const total = filteredDeployments.length;
                const paginatedDeployments = filteredDeployments.slice(offset, offset + limit);
                // Format deployments for response
                const formattedDeployments = paginatedDeployments.map(deployment => ({
                    id: deployment.id,
                    serviceId: deployment.serviceId,
                    status: deployment.status as 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled',
                    environment: deployment.environment as 'production' | 'staging' | 'preview' | 'development',
                    triggeredBy: deployment.triggeredBy || 'system',
                    createdAt: deployment.createdAt,
                    updatedAt: deployment.updatedAt,
                    metadata: deployment.metadata as any || {
                        version: 'unknown',
                        commitSha: 'unknown',
                        branch: 'main',
                    },
                }));
                return {
                    deployments: formattedDeployments,
                    total,
                    hasMore: offset + limit < total,
                };
            }
            catch (error) {
                this.logger.error('Error listing deployments:', error);
                throw error;
            }
        });
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

    /**
     * Helper method to map deployment status to stage
     */
    private mapStatusToStage(status: string): string {
        switch (status) {
            case 'queued': return 'queued';
            case 'building': return 'building';
            case 'deploying': return 'deploying';
            case 'success': return 'completed';
            case 'failed': return 'failed';
            case 'cancelled': return 'cancelled';
            default: return 'unknown';
        }
    }
    /**
     * Helper method to calculate deployment progress
     */
    private calculateProgress(status: string, containerHealthy: boolean): number {
        switch (status) {
            case 'queued': return 0;
            case 'building': return 25;
            case 'deploying': return 75;
            case 'success': return containerHealthy ? 100 : 90;
            case 'failed': return 0;
            case 'cancelled': return 0;
            default: return 0;
        }
    }
    /**
     * Helper method to map service provider to source type for deployments
     */
    private mapServiceProviderToSourceType(provider: string): 'github' | 'gitlab' | 'git' | 'upload' {
        console.log(`=== MAPPING PROVIDER TO SOURCE TYPE ===`);
        console.log(`Input provider: "${provider}"`);
        
        let result: 'github' | 'gitlab' | 'git' | 'upload';
        
        switch (provider) {
            case 'github': 
                result = 'github';
                break;
            case 'gitlab': 
                result = 'gitlab';
                break;
            case 'bitbucket':
            case 'gitea':
                result = 'git'; // Treat these as generic git
                break;
            case 'manual':
                result = 'upload'; // Manual always uses upload workflow
                break;
            case 's3_bucket':
                result = 'upload'; // S3 bucket uses upload workflow with S3 download
                break;
            case 'docker_registry':
                result = 'upload'; // Docker registry should be handled separately
                break;
            default: 
                result = 'git'; // Default fallback
                break;
        }
        
        console.log(`Mapped to source type: "${result}"`);
        console.log(`=== END MAPPING ===`);
        
        return result;
    }

    /**
     * Validate provider configuration based on provider and builder types
     */
    private validateProviderConfiguration(provider: string, builder: string, sourceConfig: any): void {
        switch (provider) {
            case 'github':
            case 'gitlab':
            case 'bitbucket':
            case 'gitea':
                // Git-based providers always need repository URL
                if (!sourceConfig.repositoryUrl) {
                    // Provide specific guidance based on the builder type
                    if (builder === 'static') {
                        throw new Error(
                            `Repository URL is required for ${provider} deployments, even with static builder. ` +
                            `If you want to deploy static files without a git repository, please change the provider to 'manual' ` +
                            `and use the file upload workflow instead.`
                        );
                    } else {
                        throw new Error(
                            `Repository URL is required for ${provider} deployments. ` +
                            `Please update the service configuration to include a valid repository URL, ` +
                            `or change the provider to 'manual' if you want to upload files directly.`
                        );
                    }
                }
                break;

            case 'docker_registry':
                // Docker registry needs registry URL, image name, and tag
                if (!sourceConfig.registryUrl) {
                    throw new Error(`Registry URL is required for Docker registry deployments.`);
                }
                if (!sourceConfig.imageName) {
                    throw new Error(`Image name is required for Docker registry deployments.`);
                }
                if (!sourceConfig.tag) {
                    throw new Error(`Image tag is required for Docker registry deployments.`);
                }
                break;

            case 's3_bucket':
                // S3 bucket needs bucket name, region, and credentials
                if (!sourceConfig.bucketName) {
                    throw new Error(`Bucket name is required for S3 bucket deployments.`);
                }
                if (!sourceConfig.region) {
                    throw new Error(`Region is required for S3 bucket deployments.`);
                }
                if (!sourceConfig.accessKeyId || !sourceConfig.secretAccessKey) {
                    throw new Error(`AWS credentials (accessKeyId and secretAccessKey) are required for S3 bucket deployments.`);
                }
                break;

            case 'manual':
                // Manual deployments don't need repository URL - they use uploaded files
                // The actual file upload should be handled through a separate upload workflow
                this.logger.log(`Manual deployment detected for ${builder} builder - expecting file upload workflow`);
                break;

            default:
                throw new Error(`Unknown provider type: ${provider}`);
        }

        // Validate builder-specific configuration
        this.validateBuilderConfiguration(builder, sourceConfig);
    }

    /**
     * Validate builder configuration
     */
    private validateBuilderConfiguration(builder: string, _sourceConfig: any): void {
        switch (builder) {
            case 'static':
                // Static sites don't need specific build configuration
                // Can work with uploads or simple git repos
                break;

            case 'dockerfile':
                // Dockerfile builder should have dockerfile path in builderConfig (not sourceConfig)
                // This validation might be handled elsewhere
                break;

            case 'nixpack':
            case 'railpack':
            case 'buildpack':
                // These builders might need build/start commands but they have defaults
                break;

            case 'docker_compose':
                // Docker compose might need compose file path
                break;

            default:
                throw new Error(`Unknown builder type: ${builder}`);
        }
    }

    @Implement(deploymentContract.listContainers)
    listContainers() {
        return implement(deploymentContract.listContainers).handler(async ({ input }) => {
            const { status, service, project, environment, limit = 50, offset = 0 } = input;

            // Get all deployments - we'll need to enhance this to get relations
            const allDeployments = await this.databaseService.db
                .select()
                .from(deployments)
                .orderBy(desc(deployments.createdAt));

            // Get containers from Docker
            const dockerContainers = await this.dockerService.listContainers({
                all: status === 'all',
            });

            // Combine deployment data with Docker container info
            const containers: Array<{
                containerId: string;
                containerName: string;
                deploymentId: string;
                serviceId: string;
                serviceName: string;
                projectId: string;
                projectName: string;
                environment: 'production' | 'staging' | 'preview' | 'development';
                status: 'running' | 'stopped' | 'failed' | 'starting' | 'stopping';
                health: {
                    isHealthy: boolean;
                    status: string;
                    uptime: number;
                    restartCount: number;
                    lastStarted: Date | null;
                    resources: {
                        cpuUsage?: number;
                        memoryUsage?: number;
                        memoryLimit?: number;
                    };
                };
                metadata: {
                    imageTag?: string;
                    ports?: Record<string, string>;
                    createdAt: Date;
                    triggeredBy?: string;
                    triggerType?: 'webhook' | 'manual' | 'api' | 'github' | 'gitlab';
                    triggerSource?: string;
                };
            }> = [];
            
            for (const deployment of allDeployments) {
                if (!deployment.containerName) continue;
                
                // Filter by service if specified
                if (service && deployment.serviceId !== service) continue;
                
                // Filter by environment if specified
                if (environment && deployment.environment !== environment) continue;
                
                const dockerContainer = dockerContainers.find(
                    (c) => c.Names[0] === `/${deployment.containerName}`
                );

                // Skip if status filter doesn't match
                if (status && status !== 'all') {
                    const containerState = dockerContainer?.State?.toLowerCase() || 'stopped';
                    if (status === 'running' && containerState !== 'running') continue;
                    if (status === 'stopped' && containerState !== 'exited') continue;
                    if (status === 'failed' && !containerState.includes('dead')) continue;
                }

                let containerHealth;
                try {
                    containerHealth = await this.dockerService.performHealthCheck(
                        deployment.containerName,
                        deployment.healthCheckUrl || undefined
                    );
                } catch (error) {
                    this.logger.error(`Health check failed for ${deployment.containerName}:`, error);
                    containerHealth = {
                        isHealthy: false,
                        containerHealth: {
                            isHealthy: false,
                            status: 'unhealthy',
                            uptime: 0,
                            restartCount: 0,
                            lastStarted: null,
                            resources: {
                                cpuUsage: 0,
                                memoryUsage: 0,
                                memoryLimit: 0,
                            },
                        },
                    };
                }

                containers.push({
                    containerId: dockerContainer?.Id || deployment.containerName,
                    containerName: deployment.containerName,
                    deploymentId: deployment.id,
                    serviceId: deployment.serviceId,
                    serviceName: 'Unknown', // Will be fetched separately if needed
                    projectId: project || '',
                    projectName: 'Unknown', // Will be fetched separately if needed
                    environment: deployment.environment,
                    status: dockerContainer?.State === 'running' ? 'running' : 
                           dockerContainer?.State === 'exited' ? 'stopped' : 'failed',
                    health: {
                        isHealthy: containerHealth.isHealthy,
                        status: containerHealth.containerHealth.status,
                        uptime: containerHealth.containerHealth.uptime || 0,
                        restartCount: containerHealth.containerHealth.restartCount || 0,
                        lastStarted: containerHealth.containerHealth.lastStarted || null,
                        resources: {
                            cpuUsage: containerHealth.containerHealth.resources?.cpuUsage,
                            memoryUsage: containerHealth.containerHealth.resources?.memoryUsage,
                            memoryLimit: containerHealth.containerHealth.resources?.memoryLimit,
                        },
                    },
                    metadata: {
                        imageTag: deployment.containerImage || undefined,
                        ports: undefined, // Will be filled from docker container ports
                        createdAt: deployment.createdAt,
                        triggeredBy: deployment.triggeredBy || undefined,
                        triggerType: deployment.sourceConfig?.pullRequestNumber ? 'github' : 'webhook',
                        triggerSource: deployment.sourceConfig?.branch || 
                                      deployment.sourceConfig?.repositoryUrl || undefined,
                    },
                });
            }

            // Apply pagination
            const paginatedContainers = containers.slice(offset, offset + limit);

            // Calculate summary stats
            const summary = {
                totalContainers: containers.length,
                runningContainers: containers.filter(c => c.status === 'running').length,
                stoppedContainers: containers.filter(c => c.status === 'stopped').length,
                failedContainers: containers.filter(c => c.status === 'failed').length,
                healthyContainers: containers.filter(c => c.health.isHealthy).length,
            };

            return {
                containers: paginatedContainers,
                pagination: {
                    total: containers.length,
                    limit,
                    offset,
                    hasMore: offset + limit < containers.length,
                },
                summary,
            };
        });
    }

    @Implement(deploymentContract.containerAction)
    containerAction() {
        return implement(deploymentContract.containerAction).handler(async ({ input }) => {
            const { containerId, action } = input;

            try {
                switch (action) {
                    case 'start':
                        // Use docker.getContainer().start() directly since there's no startContainer method
                        const startContainer = this.dockerService.getDockerClient().getContainer(containerId);
                        await startContainer.start();
                        break;
                    case 'stop':
                        await this.dockerService.stopContainer(containerId);
                        break;
                    case 'restart':
                        await this.dockerService.restartContainer(containerId);
                        break;
                    case 'remove':
                        await this.dockerService.removeContainer(containerId);
                        break;
                    default:
                        throw new Error(`Unknown action: ${action}`);
                }

                return {
                    containerId,
                    action,
                    success: true,
                    message: `Container ${action} completed successfully`,
                    timestamp: new Date(),
                };
            } catch (error) {
                this.logger.error(`Container action failed:`, error);
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
}
