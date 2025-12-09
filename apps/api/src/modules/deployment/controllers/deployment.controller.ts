import { Controller, Logger } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { deploymentContract } from "@repo/api-contracts";
import type { Job } from "bull";
import { DeploymentQueueService } from '@/core/modules/orchestration';
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { DeploymentService } from "@/core/modules/deployment/services/deployment.service";
import { DeploymentCleanupService } from "@/core/modules/deployment/services/deployment-cleanup.service";
import { ServiceService } from "@/core/modules/service/services/service.service";
import { DeploymentAdapter } from "../adapters/deployment-adapter.service";
import type { DeploymentJobData } from "@/core/modules/orchestration/types/deployment-job.types";
// TODO: REFACTOR - Controller should not access database directly (violates Service-Adapter pattern)
// Import temporarily to fix compilation errors - needs proper refactor to use repository/service layer
import { DatabaseService } from "@/core/modules/database/services/database.service";
import { deployments, deploymentLogs, services } from "@/config/drizzle/schema";
import { eq, desc, and, or, type InferSelectModel } from "drizzle-orm";

// TODO: Move to proper type file
interface DeploymentSourceConfig {
    repositoryUrl?: string;
    branch?: string;
    commitSha?: string;
    pullRequestNumber?: number;
    fileName?: string;
    fileSize?: number;
    customData?: Record<string, unknown>;
}

interface DeploymentMetadata {
    buildLogs?: string;
    buildDuration?: number;
    deployDuration?: number;
    resourceUsage?: Record<string, unknown>;
    stage?: string;
    progress?: number;
    cancelReason?: string;
    cancelledAt?: Date;
    version?: string;
    branch?: string;
    pr?: number;
    customName?: string;
}

// Type for job status response data
interface JobStatusData {
    processedOn?: number | string;
    finishedOn?: number | string;
    timestamp?: number | string;
    delay?: number;
}

// Type for provider configuration
interface ProviderConfig {
    deploymentScript?: string;
    instructions?: string;
}

// Type matching Drizzle schema's sourceConfig field
interface DeploymentSourceConfig {
    repositoryUrl?: string;
    branch?: string;
    commitSha?: string;
    pullRequestNumber?: number;
    fileName?: string;
    fileSize?: number;
    customData?: Record<string, unknown>;
}

// Type for validation source config
interface ValidationSourceConfig {
    repositoryUrl?: string;
    registryUrl?: string;
    imageName?: string;
    tag?: string;
    bucketName?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
}

// Type for container health status from dockerService.performHealthCheck
interface ContainerHealthStatus {
    isHealthy: boolean;
    httpStatus?: number;
    responseTime?: number;
    error?: string;
    containerHealth: {
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
    };
}

// Infer deployment row type from Drizzle schema
type DeploymentRow = InferSelectModel<typeof deployments>;

@Controller("other")
export class DeploymentController {
    private readonly logger = new Logger(DeploymentController.name);

    constructor(
        // TODO: REFACTOR - Remove DatabaseService from controller (violates Service-Adapter pattern)
        private readonly databaseService: DatabaseService,
        private readonly deploymentQueueService: DeploymentQueueService,
        private readonly dockerService: DockerService,
        private readonly deploymentService: DeploymentService,
        private readonly deploymentCleanupService: DeploymentCleanupService,
        private readonly serviceService: ServiceService,
        private readonly deploymentAdapter: DeploymentAdapter
    ) {}
    @Implement(deploymentContract.jobStatus)
    jobStatus() {
        return implement(deploymentContract.jobStatus).handler(async ({ input }) => {
            this.logger.log(`Getting job status for job: ${input.jobId}`);
            try {
                const job = await this.deploymentQueueService.getJobStatus(input.jobId);
                // Map Bull job state to contract status
                const statusMap: Record<string, "waiting" | "active" | "completed" | "failed" | "delayed"> = {
                    waiting: "waiting",
                    active: "active",
                    completed: "completed",
                    failed: "failed",
                    delayed: "delayed",
                };
                const mappedStatus = statusMap[job.status] ?? "waiting";
                // Type-safe access to job data
                const jobData = (job.data ?? {}) as JobStatusData;
                // Normalize date-like fields to Date objects for contract compatibility
                const processedOn = jobData.processedOn ? new Date(jobData.processedOn) : undefined;
                const finishedOn = jobData.finishedOn ? new Date(jobData.finishedOn) : undefined;
                const timestamp = jobData.timestamp ? new Date(jobData.timestamp) : new Date();

                return {
                    id: job.id,
                    status: mappedStatus,
                    progress: typeof job.progress === "number" ? job.progress : 0,
                    data: jobData as Record<string, unknown>,
                    result: (job.result ?? {}) as Record<string, unknown>,
                    failedReason: typeof job.error === "string" ? job.error : undefined,
                    processedOn,
                    finishedOn,
                    delay: jobData.delay ?? undefined,
                    timestamp,
                };
            } catch (error) {
                this.logger.error(`Job status error: ${String(error)}`);
                throw error;
            }
        });
    }

    @Implement(deploymentContract.getStatus)
    getStatus() {
        return implement(deploymentContract.getStatus).handler(async ({ input }) => {
            this.logger.log(`Getting status for deployment: ${input.deploymentId}`);
            try {
                // ✅ Use service layer instead of direct database access
                const deployment = await this.deploymentService.getDeployment(input.deploymentId);

                // Get container health status if deployment has containers
                let containerHealthy: "healthy" | "unhealthy" | "starting" = "unhealthy";
                if (deployment.status === "success" && deployment.containerName) {
                    const containers = await this.dockerService.listContainersByDeployment(deployment.id);
                    if (containers[0]) {
                        const isHealthy = await this.dockerService.checkContainerHealth(containers[0].id);
                        containerHealthy = isHealthy ? "healthy" : "unhealthy";
                    }
                }

                // ✅ Use adapter for transformation
                return this.deploymentAdapter.adaptDeploymentToStatusContract(
                    deployment,
                    containerHealthy,
                    deployment.triggeredBy ?? "system",
                    deployment.sourceType as "github" | "gitlab" | "git" | "upload" | "docker-image" | "custom"
                );
            } catch (error) {
                this.logger.error(`Get status error: ${String(error)}`);
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
                    throw new Error("Docker service is not available. Cannot trigger deployment.");
                }
                this.logger.log(`Docker connection successful`);

                console.log(`🔍 Step 2: Looking up service`);
                // Get service details
                this.logger.log(`Looking up service: ${input.serviceId}`);
                const service = await this.serviceService.getService(input.serviceId);
                console.log(`🔍 Step 3: Service lookup result - found: ${String(Boolean(service))}`);
                this.logger.log(`Service lookup result:`, {
                    found: !!service,
                    serviceId: service.id,
                    isActive: service.isActive,
                });

                if (!service.isActive) {
                    throw new Error(`Service ${input.serviceId} is not active`);
                }

                console.log(`🔍 Step 4: About to log service config`);
                // Log service configuration for debugging - using console.log to ensure it shows up
                console.log(`=== SERVICE CONFIGURATION DEBUG ===`);
                console.log(`Service ID: ${input.serviceId}`);
                console.log(`Provider: ${service.providerId}`);
                console.log(`Builder: ${service.builderId}`);
                console.log(`Provider Config:`, service.providerConfig);
                console.log(`=== END SERVICE DEBUG ===`);

                // Also use logger
                this.logger.log(`Service configuration for ${input.serviceId}:`, {
                    provider: service.providerId,
                    builder: service.builderId,
                    providerConfig: service.providerConfig,
                });

                console.log(`=== SIMPLE SERVICE DEBUG ===`);
                console.log(`Provider: ${service.providerId}`);
                console.log(`Builder: ${service.builderId}`);
                console.log(`=== END SIMPLE DEBUG ===`);

                // Safely handle provider config to ensure it's serializable
                let safeProviderConfig: ProviderConfig = {};
                try {
                    if (service.providerConfig) {
                        // Create a clean object with only serializable properties
                        const rawConfig = service.providerConfig;
                        const config: Record<string, unknown> = typeof rawConfig === "object"
                            ? rawConfig as Record<string, unknown>
                            : JSON.parse(String(rawConfig)) as Record<string, unknown>;

                        this.logger.log(`Parsed provider config:`, config);

                        // Manually copy only safe properties to avoid serialization issues
                        safeProviderConfig = {};
                        for (const [key, value] of Object.entries(config)) {
                            if (value !== null && value !== undefined) {
                                // Only include primitive values and plain objects
                                if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                                    safeProviderConfig[key] = value;
                                } else if (typeof value === "object" && !Array.isArray(value)) {
                                    // For objects, try to JSON stringify/parse to ensure serializability
                                    try {
                                        safeProviderConfig[key] = JSON.parse(JSON.stringify(value)) as unknown;
                                    } catch {
                                        this.logger.warn(`Skipping non-serializable property ${key} in provider config`);
                                    }
                                } else if (Array.isArray(value)) {
                                    // For arrays, only include if all elements are serializable
                                    try {
                                        safeProviderConfig[key] = JSON.parse(JSON.stringify(value)) as unknown;
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
                        triggeredBy: "user", // TODO: Get from auth context
                        status: "queued",
                        environment: "production",
                        sourceType: this.mapServiceProviderToSourceType(service.providerId),
                        sourceConfig: safeProviderConfig as DeploymentSourceConfig,
                        metadata: {
                            stage: "queued",
                            progress: 0,
                        },
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning();

                if (!deployment) {
                    throw new Error(`Failed to create deployment record for service ${input.serviceId}`);
                }

                this.logger.log(`Created deployment record: ${deployment.id}`);

                // Add deployment log
                await this.serviceService.addServiceLog(input.serviceId, deployment.id, {
                    level: "info",
                    message: `Deployment triggered for service ${service.name}`,
                    phase: "initialization",
                    step: "trigger",
                    stage: "queued",
                    metadata: {
                        serviceId: input.serviceId,
                        triggeredBy: "user",
                        provider: service.providerId,
                        builder: service.builderId,
                    },
                });

                // Safely handle environment variables
                let safeEnvironmentVariables: Record<string, string> = {};
                try {
                    if (service.environmentVariables) {
                        const rawEnvVars = service.environmentVariables;
                        const envVars: Record<string, unknown> = typeof rawEnvVars === "object"
                            ? rawEnvVars as Record<string, unknown>
                            : JSON.parse(String(rawEnvVars)) as Record<string, unknown>;

                        // Ensure all environment variables are strings
                        safeEnvironmentVariables = {};
                        for (const [key, value] of Object.entries(envVars)) {
                            if (value !== null && value !== undefined) {
                                // Convert all values to strings for environment variables
                                // Use JSON.stringify for objects to avoid [object Object]
                                if (typeof value === "object") {
                                    safeEnvironmentVariables[key] = JSON.stringify(value);
                                } else {
                                    safeEnvironmentVariables[key] = String(value as string | number | boolean);
                                }
                            }
                        }
                    }
                } catch (envError) {
                    this.logger.warn(`Failed to parse environment variables for service ${input.serviceId}:`, envError);
                    safeEnvironmentVariables = {};
                }

                // Queue deployment job with sanitized data
                // Prefer explicit values from the request when provided; otherwise infer from service provider
                const sourceType = input.sourceType ?? this.mapServiceProviderToSourceType(service.providerId);
                const requestSourceConfig = input.sourceConfig as DeploymentSourceConfig | undefined;
                let sourceConfig = requestSourceConfig ? ({ ...requestSourceConfig } as Record<string, unknown>) : ({ type: sourceType, ...safeProviderConfig } as Record<string, unknown>);
                // Ensure the type field is always present
                sourceConfig.type ??= sourceType;
                
                // Merge sanitized envVars into the sourceConfig (request values are kept when present)
                sourceConfig.envVars = {
                    ...(safeEnvironmentVariables),
                    ...(sourceConfig.envVars ?? {}),
                };

                // Auto-fix common misconfiguration: git provider with static builder but no repository URL
                // OR manual provider that's incorrectly mapped to git type
                if (
                    ((sourceType === "git" || sourceType === "github" || sourceType === "gitlab") && service.builderId === "static" && !sourceConfig.repositoryUrl) ||
                    (service.providerId === "manual" && sourceType === "git")
                ) {
                    this.logger.warn(
                        `Service ${input.serviceId} has provider '${service.providerId}' with builder '${service.builderId}' ` +
                            `but sourceType is '${sourceType}'. Auto-converting to upload type for static file deployment.`
                    );

                    sourceConfig = {
                        type: "upload",
                        envVars: safeEnvironmentVariables,
                        // For seeded static demo service, check if deploymentScript contains static files
                        ...(safeProviderConfig.deploymentScript
                            ? {
                                  staticContent: safeProviderConfig.deploymentScript,
                                  contentType: "embedded",
                              }
                            : {}),
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
                    this.validateProviderConfiguration(service.providerId, service.builderId, sourceConfig as ValidationSourceConfig);
                } catch (validationError) {
                    this.logger.error(`Validation failed for service ${input.serviceId}:`, validationError);

                    // If it's a git provider without repository URL, suggest changing to manual
                    if (validationError instanceof Error && validationError.message.includes("Repository URL is required")) {
                        const helpfulError = new Error(
                            `${validationError.message}\n\n` +
                                `💡 If you want to deploy static files without a git repository:\n` +
                                `   1. Change the service provider from '${service.providerId}' to 'manual'\n` +
                                `   2. Use the file upload feature in the dashboard\n` +
                                `   3. The static builder works great with manual file uploads\n\n` +
                                `Or configure a repository URL in the service settings for git-based deployment.`
                        );
                        throw helpfulError;
                    }
                    throw validationError;
                }

                const jobData: DeploymentJobData = {
                    deploymentId: deployment.id,
                    serviceId: input.serviceId,
                    projectId: service.projectId,
                    sourceConfig: sourceConfig as DeploymentJobData["sourceConfig"],
                };

                // Verify job data is serializable before queuing
                try {
                    JSON.stringify(jobData);
                } catch (serializationError) {
                    this.logger.error(`Job data is not serializable:`, serializationError);
                    throw new Error("Failed to prepare deployment job data - contains non-serializable properties");
                }

                const jobId = await this.deploymentQueueService.addDeploymentJob(jobData);
                this.logger.log(`Queued deployment job: ${jobId} for deployment: ${deployment.id}`);
                return {
                    deploymentId: deployment.id,
                    jobId,
                    status: "queued",
                    message: "Deployment has been queued successfully",
                };
            } catch (error) {
                this.logger.error(`Failed to trigger deployment for service ${input.serviceId}:`, error);
                // Create a serializable error object
                const serializableError = new Error(error instanceof Error ? error.message : "Unknown deployment error occurred");
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
                const [deployment] = await this.databaseService.db.select().from(deployments).where(eq(deployments.id, input.deploymentId)).limit(1);
                if (!deployment) {
                    throw new Error(`Deployment ${input.deploymentId} not found`);
                }
                if (deployment.status === "cancelled") {
                    return {
                        success: true,
                        message: "Deployment was already cancelled",
                        deploymentId: input.deploymentId,
                        cancelledAt: deployment.metadata?.cancelledAt ?? deployment.updatedAt,
                    };
                }
                if (deployment.status === "success" || deployment.status === "failed") {
                    throw new Error(`Cannot cancel deployment with status: ${deployment.status}`);
                }
                // Stop any running containers for this deployment
                await this.dockerService.stopContainersByDeployment(input.deploymentId);
                this.logger.log(`Stopped containers for deployment: ${input.deploymentId}`);
                // Try to cancel the job if it's still queued/running
                try {
                    const jobs = await this.deploymentQueueService.getDeploymentJobs(input.deploymentId) as Job<DeploymentJobData>[];
                    for (const job of jobs) {
                        const jobState = job.opts.jobId ? await job.getState() : "completed";
                        if (["waiting", "active", "delayed"].includes(jobState)) {
                            await this.deploymentQueueService.cancelJob(String(job.id));
                            this.logger.log(`Cancelled job: ${String(job.id)}`);
                        }
                    }
                } catch (jobError) {
                    this.logger.warn(`Failed to cancel job for deployment ${input.deploymentId}: ${String(jobError)}`);
                    // Continue with deployment cancellation even if job cancellation fails
                }
                // Update deployment status to cancelled
                await this.databaseService.db
                    .update(deployments)
                    .set({
                        status: "cancelled",
                        metadata: {
                            ...(deployment.metadata as DeploymentMetadata),
                            cancelReason: "user_requested",
                            cancelledAt: new Date(),
                        } as DeploymentMetadata,
                        updatedAt: new Date(),
                    })
                    .where(eq(deployments.id, input.deploymentId));
                // Add cancellation log
                // Get service for the deployment to add log
                const [cancelDeployment] = await this.databaseService.db.select({ serviceId: deployments.serviceId }).from(deployments).where(eq(deployments.id, input.deploymentId)).limit(1);
                if (cancelDeployment) {
                    await this.serviceService.addServiceLog(cancelDeployment.serviceId, input.deploymentId, {
                        level: "info",
                        message: "Deployment cancelled by user request",
                        phase: "cancellation",
                        step: "cancel",
                        stage: "cancelled",
                        metadata: {
                            cancelReason: "user_requested",
                            cancelledAt: new Date().toISOString(),
                        },
                    });
                }
                return {
                    success: true,
                    message: "Deployment cancelled successfully",
                    deploymentId: input.deploymentId,
                    cancelledAt: new Date(),
                };
            } catch (error) {
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
                const [currentDeployment] = await this.databaseService.db.select().from(deployments).where(eq(deployments.id, input.deploymentId)).limit(1);
                const [targetDeployment] = await this.databaseService.db.select().from(deployments).where(eq(deployments.id, input.targetDeploymentId)).limit(1);
                if (!currentDeployment) {
                    throw new Error(`Current deployment ${input.deploymentId} not found`);
                }
                if (!targetDeployment) {
                    throw new Error(`Target deployment ${input.targetDeploymentId} not found`);
                }
                if (currentDeployment.serviceId !== targetDeployment.serviceId) {
                    throw new Error("Deployments must belong to the same service");
                }
                if (targetDeployment.status !== "success") {
                    throw new Error(`Target deployment status is ${targetDeployment.status}, must be 'success'`);
                }

                // Create a rollback deployment record so we have an auditable rollback instance
                const [rollbackDeployment] = await this.databaseService.db
                    .insert(deployments)
                    .values({
                        serviceId: currentDeployment.serviceId,
                        triggeredBy: "system",
                        status: "queued",
                        environment: currentDeployment.environment,
                        sourceType: currentDeployment.sourceType,
                        sourceConfig: targetDeployment.sourceConfig,
                        metadata: {
                            stage: "rollback_queued",
                            targetDeploymentId: input.targetDeploymentId,
                            rollbackFrom: input.deploymentId,
                        } as DeploymentMetadata,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning();

                if (!rollbackDeployment) {
                    throw new Error('Failed to create rollback deployment record');
                }

                // Queue rollback job referencing the rollback deployment
                const rollbackJobId = await this.deploymentQueueService.addRollbackJob({
                    deploymentId: rollbackDeployment.id,
                    targetDeploymentId: input.targetDeploymentId,
                });
                // Add rollback initiation log against rollback deployment
                await this.serviceService.addServiceLog(rollbackDeployment.serviceId, rollbackDeployment.id, {
                    level: "info",
                    message: `Rollback initiated to deployment ${input.targetDeploymentId}`,
                    phase: "rollback",
                    step: "initiate",
                    stage: "rollback_queued",
                    metadata: {
                        targetDeploymentId: input.targetDeploymentId,
                        targetVersion: targetDeployment.metadata?.version ?? "unknown",
                        rollbackJobId,
                    },
                });
                this.logger.log(`Rollback job queued: ${rollbackJobId}`);
                return {
                    rollbackJobId,
                    rollbackDeploymentId: rollbackDeployment.id,
                    message: "Rollback has been initiated successfully",
                };
            } catch (error) {
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
                const [deployment] = await this.databaseService.db.select().from(deployments).where(eq(deployments.id, input.deploymentId)).limit(1);
                if (!deployment) {
                    throw new Error(`Deployment ${input.deploymentId} not found`);
                }
                // Get logs from database
                const logs = await this.databaseService.db
                    .select()
                    .from(deploymentLogs)
                    .where(eq(deploymentLogs.deploymentId, input.deploymentId))
                    .orderBy(desc(deploymentLogs.timestamp))
                    .limit(input.limit || 100)
                    .offset(input.offset || 0);
                // Count total logs for pagination
                const totalLogsQuery = await this.databaseService.db.select().from(deploymentLogs).where(eq(deploymentLogs.deploymentId, input.deploymentId));
                const total = totalLogsQuery.length;
                const formattedLogs = logs.map((log) => ({
                    id: log.id,
                    timestamp: log.timestamp,
                    level: log.level,
                    message: log.message,
                    service: log.service ?? "deployment-service",
                    stage: log.stage ?? "unknown",
                }));
                return {
                    logs: formattedLogs,
                    total,
                    hasMore: (input.offset || 0) + (input.limit || 100) < total,
                };
            } catch (error) {
                this.logger.error(`Error getting logs for deployment ${input.deploymentId}:`, error);
                throw error;
            }
        });
    }
    @Implement(deploymentContract.list)
    list() {
        return implement(deploymentContract.list).handler(async ({ input }) => {
            this.logger.log("Listing deployments");
            try {
                // Get deployments from database
                let allDeployments: DeploymentRow[];
                if (input.serviceId && input.serviceId.trim() !== "") {
                    // Validate UUID format before querying
                    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                    if (!uuidRegex.test(input.serviceId)) {
                        throw new Error(`Invalid service ID format: ${input.serviceId}`);
                    }

                    allDeployments = await this.databaseService.db.select().from(deployments).where(eq(deployments.serviceId, input.serviceId)).orderBy(desc(deployments.createdAt));
                } else {
                    allDeployments = await this.databaseService.db.select().from(deployments).orderBy(desc(deployments.createdAt));
                }
                // Apply status filter
                let filteredDeployments: DeploymentRow[] = allDeployments;
                if (input.status) {
                    filteredDeployments = filteredDeployments.filter((d) => d.status === input.status);
                }
                // Apply pagination
                const limit = input.limit || 20;
                const offset = input.offset || 0;
                const total = filteredDeployments.length;
                const paginatedDeployments = filteredDeployments.slice(offset, offset + limit);
                // Format deployments for response
                const formattedDeployments = paginatedDeployments.map((deployment) => ({
                    deploymentId: deployment.id,
                    serviceId: deployment.serviceId,
                    status: deployment.status as "queued" | "building" | "deploying" | "success" | "failed" | "cancelled",
                    environment: deployment.environment,
                    sourceType: deployment.sourceType,
                    triggeredBy: deployment.triggeredBy ?? "system",
                    createdAt: deployment.createdAt,
                    updatedAt: deployment.updatedAt,
                    metadata: deployment.metadata as DeploymentMetadata,
                    deployedBy: deployment.triggeredBy ?? "system",
                }));
                return {
                    deployments: formattedDeployments,
                    total,
                    hasMore: offset + limit < total,
                    filters: {
                        environment: input.environment,
                        status: input.status,
                        sourceType: input.sourceType,
                    },
                };
            } catch (error) {
                this.logger.error("Error listing deployments:", error);
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
            } catch (error) {
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
            } catch (error) {
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
            } catch (error) {
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
            case "queued":
                return "queued";
            case "building":
                return "building";
            case "deploying":
                return "deploying";
            case "success":
                return "completed";
            case "failed":
                return "failed";
            case "cancelled":
                return "cancelled";
            default:
                return "unknown";
        }
    }
    /**
     * Helper method to calculate deployment progress
     */
    private calculateProgress(status: string, containerHealthy: boolean): number {
        switch (status) {
            case "queued":
                return 0;
            case "building":
                return 25;
            case "deploying":
                return 75;
            case "success":
                return containerHealthy ? 100 : 90;
            case "failed":
                return 0;
            case "cancelled":
                return 0;
            default:
                return 0;
        }
    }
    /**
     * Helper method to map service provider to source type for deployments
     */
    private mapServiceProviderToSourceType(provider: string): "github" | "gitlab" | "git" | "upload" {
        console.log(`=== MAPPING PROVIDER TO SOURCE TYPE ===`);
        console.log(`Input provider: "${provider}"`);

        let result: "github" | "gitlab" | "git" | "upload";

        switch (provider) {
            case "github":
                result = "github";
                break;
            case "gitlab":
                result = "gitlab";
                break;
            case "bitbucket":
            case "gitea":
                result = "git"; // Treat these as generic git
                break;
            case "manual":
                result = "upload"; // Manual always uses upload workflow
                break;
            case "s3_bucket":
                result = "upload"; // S3 bucket uses upload workflow with S3 download
                break;
            case "docker_registry":
                result = "upload"; // Docker registry should be handled separately
                break;
            default:
                result = "git"; // Default fallback
                break;
        }

        console.log(`Mapped to source type: "${result}"`);
        console.log(`=== END MAPPING ===`);

        return result;
    }

    /**
     * Validate provider configuration based on provider and builder types
     */
    private validateProviderConfiguration(provider: string, builder: string, sourceConfig: ValidationSourceConfig): void {
        switch (provider) {
            case "github":
            case "gitlab":
            case "bitbucket":
            case "gitea":
                // Git-based providers always need repository URL
                if (!sourceConfig.repositoryUrl) {
                    // Provide specific guidance based on the builder type
                    if (builder === "static") {
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

            case "docker_registry":
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

            case "s3_bucket":
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

            case "manual":
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
            case "static":
                // Static sites don't need specific build configuration
                // Can work with uploads or simple git repos
                break;

            case "dockerfile":
                // Dockerfile builder should have dockerfile path in builderConfig (not sourceConfig)
                // This validation might be handled elsewhere
                break;

            case "nixpack":
            case "railpack":
            case "buildpack":
                // These builders might need build/start commands but they have defaults
                break;

            case "docker_compose":
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
            const allDeployments = await this.databaseService.db.select().from(deployments).orderBy(desc(deployments.createdAt));

            // Get containers from Docker
            const dockerContainers = await this.dockerService.listContainers({
                all: status === "all",
            });

            // Combine deployment data with Docker container info
            const containers: {
                containerId: string;
                containerName: string;
                deploymentId: string;
                serviceId: string;
                serviceName: string;
                projectId: string;
                projectName: string;
                environment: "production" | "staging" | "preview" | "development";
                status: "running" | "stopped" | "failed" | "starting" | "stopping";
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
                    triggerType?: "webhook" | "manual" | "api" | "github" | "gitlab";
                    triggerSource?: string;
                };
            }[] = [];

            for (const deployment of allDeployments) {
                if (!deployment.containerName) continue;
                const containerName = deployment.containerName; // Store in const for type narrowing

                // Filter by service if specified
                if (service && deployment.serviceId !== service) continue;

                // Filter by environment if specified
                if (environment && deployment.environment !== environment) continue;

                const dockerContainer = dockerContainers.find((c) => c.Names[0] === `/${containerName}`);

                // Skip if status filter doesn't match
                if (status && status !== "all") {
                    const containerState = dockerContainer?.State.toLowerCase() ?? "stopped";
                    if (status === "running" && containerState !== "running") continue;
                    if (status === "stopped" && containerState !== "exited") continue;
                    if (status === "failed" && !containerState.includes("dead")) continue;
                }

                let containerHealth: ContainerHealthStatus;
                try {
                    containerHealth = await this.dockerService.performHealthCheck(containerName, deployment.healthCheckUrl ?? undefined);
                } catch (error) {
                    this.logger.error(`Health check failed for ${containerName}:`, error);
                    containerHealth = {
                        isHealthy: false,
                        containerHealth: {
                            isHealthy: false,
                            status: "unhealthy",
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
                    containerId: dockerContainer?.Id ?? containerName,
                    containerName: containerName,
                    deploymentId: deployment.id,
                    serviceId: deployment.serviceId,
                    serviceName: "Unknown", // Will be fetched separately if needed
                    projectId: project ?? "",
                    projectName: "Unknown", // Will be fetched separately if needed
                    environment: deployment.environment,
                    status: dockerContainer?.State === "running" ? "running" : dockerContainer?.State === "exited" ? "stopped" : "failed",
                    health: {
                        isHealthy: containerHealth.isHealthy,
                        status: containerHealth.containerHealth.status,
                        uptime: containerHealth.containerHealth.uptime,
                        restartCount: containerHealth.containerHealth.restartCount,
                        lastStarted: containerHealth.containerHealth.lastStarted,
                        resources: {
                            cpuUsage: containerHealth.containerHealth.resources.cpuUsage,
                            memoryUsage: containerHealth.containerHealth.resources.memoryUsage,
                            memoryLimit: containerHealth.containerHealth.resources.memoryLimit,
                        },
                    },
                    metadata: {
                        imageTag: deployment.containerImage ?? undefined,
                        ports: undefined, // Will be filled from docker container ports
                        createdAt: deployment.createdAt,
                        triggeredBy: deployment.triggeredBy ?? undefined,
                        triggerType: deployment.sourceConfig?.pullRequestNumber ? "github" : "webhook",
                        triggerSource: deployment.sourceConfig?.branch ?? deployment.sourceConfig?.repositoryUrl ?? undefined,
                    },
                });
            }

            // Apply pagination
            const paginatedContainers = containers.slice(offset, offset + limit);

            // Calculate summary stats
            const summary = {
                totalContainers: containers.length,
                runningContainers: containers.filter((c) => c.status === "running").length,
                stoppedContainers: containers.filter((c) => c.status === "stopped").length,
                failedContainers: containers.filter((c) => c.status === "failed").length,
                healthyContainers: containers.filter((c) => c.health.isHealthy).length,
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
                    case "start": {
                        // Use docker.getContainer().start() directly since there's no startContainer method
                        const startContainer = this.dockerService.getDockerClient().getContainer(containerId);
                        await startContainer.start();
                        break;
                    }
                    case "stop":
                        await this.dockerService.stopContainer(containerId);
                        break;
                    case "restart":
                        await this.dockerService.restartContainer(containerId);
                        break;
                    case "remove":
                        await this.dockerService.removeContainer(containerId);
                        break;
                    default:
                        throw new Error(`Unknown action: ${String(action)}`);
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
                    message: error instanceof Error ? error.message : "Unknown error",
                    timestamp: new Date(),
                };
            }
        });
    }

    @Implement(deploymentContract.getRollbackHistory)
    getRollbackHistory() {
        return implement(deploymentContract.getRollbackHistory).handler(async ({ input }) => {
            this.logger.log(`Getting rollback history for service: ${input.serviceId}`);

            try {
                // Get service configuration
                const service = await this.serviceService.getService(input.serviceId);

                const maxRetention = service.deploymentRetention?.maxSuccessfulDeployments ?? 5;

                // Get successful deployments ordered by creation date (newest first)
                const successfulDeployments = await this.databaseService.db
                    .select({
                        id: deployments.id,
                        createdAt: deployments.createdAt,
                        updatedAt: deployments.updatedAt,
                        containerName: deployments.containerName,
                        containerImage: deployments.containerImage,
                        domainUrl: deployments.domainUrl,
                        metadata: deployments.metadata,
                        sourceConfig: deployments.sourceConfig,
                        status: deployments.status,
                    })
                    .from(deployments)
                    .where(and(eq(deployments.serviceId, input.serviceId), or(eq(deployments.status, "success"), eq(deployments.status, "cancelled"))))
                    .orderBy(desc(deployments.createdAt));

                // Filter to only keep the ones within retention policy
                const availableDeployments = successfulDeployments.slice(0, maxRetention);

                // Get current active deployment (latest successful one)
                const currentDeploymentId = successfulDeployments[0]?.id ?? null;

                return {
                    serviceId: input.serviceId,
                    maxRetention,
                    availableDeployments: availableDeployments.map((d) => ({
                        id: d.id,
                        status: d.status,
                        createdAt: d.createdAt,
                        updatedAt: d.updatedAt,
                        containerName: d.containerName,
                        containerImage: d.containerImage,
                        domainUrl: d.domainUrl,
                        metadata: d.metadata
                            ? {
                                  version: d.metadata.version,
                                  branch: d.metadata.branch,
                                  commitSha: d.sourceConfig?.commitSha,
                              }
                            : undefined,
                        sourceConfig: d.sourceConfig
                            ? {
                                  repositoryUrl: d.sourceConfig.repositoryUrl,
                                  branch: d.sourceConfig.branch,
                                  commitSha: d.sourceConfig.commitSha,
                              }
                            : undefined,
                    })),
                    currentDeploymentId,
                };
            } catch (error) {
                this.logger.error(`Failed to get rollback history: ${String(error)}`);
                throw error;
            }
        });
    }

    @Implement(deploymentContract.previewCleanup)
    previewCleanup() {
        return implement(deploymentContract.previewCleanup).handler(async ({ input }) => {
            this.logger.log(`Previewing cleanup for service: ${input.serviceId}`);

            try {
                const preview = await this.deploymentCleanupService.previewCleanup(input.serviceId);

                return {
                    serviceId: input.serviceId,
                    willDelete: preview.willDelete,
                    willKeep: preview.willKeep,
                    deploymentsToDelete: preview.deploymentsToDelete,
                    deploymentsToKeep: preview.deploymentsToKeep,
                };
            } catch (error) {
                this.logger.error(`Failed to preview cleanup: ${String(error)}`);
                throw error;
            }
        });
    }

    @Implement(deploymentContract.triggerCleanup)
    triggerCleanup() {
        return implement(deploymentContract.triggerCleanup).handler(async ({ input }) => {
            this.logger.log(`Triggering cleanup for service: ${input.serviceId}`);

            try {
                const result = await this.deploymentCleanupService.cleanupOldDeployments(input.serviceId);

                return {
                    success: true,
                    serviceId: result.serviceId,
                    deletedCount: result.deletedCount,
                    deletedDeployments: result.deletedDeployments,
                    keptCount: result.keptCount,
                    message: result.message,
                };
            } catch (error) {
                const err = error as Error;
                this.logger.error(`Failed to trigger cleanup: ${err.message}`, err.stack);
                throw error;
            }
        });
    }

    @Implement(deploymentContract.updateRetentionPolicy)
    updateRetentionPolicy() {
        return implement(deploymentContract.updateRetentionPolicy).handler(async ({ input }) => {
            this.logger.log(`Updating retention policy for service: ${input.serviceId}`);

            try {
                // Get current service
                const service = await this.serviceService.getService(input.serviceId);

                // Merge with existing retention policy
                const currentPolicy = service.deploymentRetention ?? {
                    maxSuccessfulDeployments: 5,
                    keepArtifacts: true,
                    autoCleanup: true,
                };

                const newPolicy = {
                    maxSuccessfulDeployments: input.maxSuccessfulDeployments ?? currentPolicy.maxSuccessfulDeployments ?? 5,
                    keepArtifacts: input.keepArtifacts ?? currentPolicy.keepArtifacts ?? true,
                    autoCleanup: input.autoCleanup ?? currentPolicy.autoCleanup ?? true,
                };

                // Update service
                await this.databaseService.db
                    .update(services)
                    .set({
                        deploymentRetention: newPolicy,
                        updatedAt: new Date(),
                    })
                    .where(eq(services.id, input.serviceId));

                this.logger.log(`Updated retention policy for service ${input.serviceId}: ${JSON.stringify(newPolicy)}`);

                return {
                    success: true,
                    serviceId: input.serviceId,
                    retentionPolicy: newPolicy,
                    message: "Retention policy updated successfully",
                };
            } catch (error) {
                const err = error as Error;
                this.logger.error(`Failed to update retention policy: ${err.message}`, err.stack);
                throw error;
            }
        });
    }
}
