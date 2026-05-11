import z from "zod/v4";
import {
    deploymentEnvironmentSchema,
    deploymentPhaseSchema,
    deploymentStatusSchema,
    rollbackStatusSchema,
    sourceTypeSchema,
} from "@repo/contracts-common";

export {
    deploymentEnvironmentSchema,
    deploymentPhaseSchema,
    deploymentStatusSchema,
    rollbackStatusSchema,
    sourceTypeSchema,
} from "@repo/contracts-common";
export type {
    DeploymentEnvironment,
    DeploymentPhase,
    DeploymentStatus,
    RollbackStatus,
    SourceType,
} from "@repo/contracts-common";

export const deploymentObservabilityContextSchema = z.object({
    correlationId: z.string().min(1),
    traceId: z.string().min(1).optional(),
    spanId: z.string().min(1).optional(),
    parentSpanId: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
});
export type DeploymentObservabilityContext = z.infer<typeof deploymentObservabilityContextSchema>;

export const deploymentExecutionProgressSchema = z.object({
    overallPercent: z.number().int().min(0).max(100),
    phasePercent: z.number().int().min(0).max(100).optional(),
    totalNodes: z.number().int().min(0).optional(),
    completedNodes: z.number().int().min(0).optional(),
    activeNodeId: z.string().min(1).optional(),
    etaSeconds: z.number().int().min(0).optional(),
});
export type DeploymentExecutionProgress = z.infer<typeof deploymentExecutionProgressSchema>;

export const deploymentConnectivityStatusSchema = z.enum([
    "connected",
    "degraded",
    "reconnecting",
    "disconnected",
]);
export type DeploymentConnectivityStatus = z.infer<typeof deploymentConnectivityStatusSchema>;

export const deploymentSchema = z.object({
    id: z.uuid(),
    serviceId: z.uuid(),
    triggeredBy: z.string().nullable(),
    status: deploymentStatusSchema,
    environment: deploymentEnvironmentSchema,
    sourceType: sourceTypeSchema,
    sourceConfig: z
        .object({
            repositoryUrl: z.string().optional(),
            branch: z.string().optional(),
            commitSha: z.string().optional(),
            pullRequestNumber: z.number().int().positive().optional(),
            fileName: z.string().optional(),
            fileSize: z.number().optional(),
            customData: z.record(z.string(), z.unknown()).optional(),
        })
        .nullable(),
    containerName: z.string().nullable(),
    containerImage: z.string().nullable(),
    domainUrl: z.string().nullable(),
    healthCheckUrl: z.string().nullable(),
    errorMessage: z.string().nullable(),
    observability: deploymentObservabilityContextSchema.nullable(),
    progress: deploymentExecutionProgressSchema.nullable(),
    connectivityStatus: deploymentConnectivityStatusSchema.nullable(),
    buildStartedAt: z.string().nullable(),
    buildCompletedAt: z.string().nullable(),
    deployStartedAt: z.string().nullable(),
    deployCompletedAt: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

export const deploymentLogSchema = z.object({
    id: z.uuid(),
    deploymentId: z.uuid(),
    level: z.enum(["info", "warn", "error", "debug"]),
    message: z.string(),
    phase: z.string().nullable(),
    step: z.string().nullable(),
    service: z.string().nullable(),
    stage: z.string().nullable(),
    correlationId: z.string().nullable(),
    traceId: z.string().nullable(),
    spanId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    timestamp: z.string(),
});
export type DeploymentLog = z.infer<typeof deploymentLogSchema>;

export const deploymentStreamEventTypeSchema = z.enum([
    "deploymentTriggered",
    "statusChanged",
    "phaseUpdated",
    "logAppended",
    "deploymentCancelled",
    "rollbackStarted",
    "rollbackCompleted",
    "healthCheckUpdated",
    "domainRouteUpdated",
    "metricsSnapshot",
    "connectivityChanged",
    "progressSnapshot",
    "nodeLifecycle",
]);
export type DeploymentStreamEventType = z.infer<typeof deploymentStreamEventTypeSchema>;

export const deploymentStreamSchema = z.object({
    id: z.uuid(),
    coreStreamId: z.uuid().nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    isActive: z.boolean(),
    deploymentId: z.uuid().nullable(),
    serviceId: z.uuid().nullable(),
    projectId: z.uuid().nullable(),
    statusFilter: deploymentStatusSchema.nullable(),
    environmentFilter: deploymentEnvironmentSchema.nullable(),
    eventTypes: z.array(deploymentStreamEventTypeSchema).nullable(),
    replayDefault: z.boolean(),
    replayLimitDefault: z.number().int().min(1).max(500),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type DeploymentStream = z.infer<typeof deploymentStreamSchema>;

export const deploymentRollbackSchema = z.object({
    id: z.uuid(),
    fromDeploymentId: z.uuid(),
    toDeploymentId: z.uuid(),
    triggeredBy: z.string().nullable(),
    status: rollbackStatusSchema,
    reason: z.string().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    failedAt: z.string().nullable(),
    errorMessage: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type DeploymentRollback = z.infer<typeof deploymentRollbackSchema>;
