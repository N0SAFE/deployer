import z from "zod/v4";
import { deploymentEnvironmentSchema } from "@repo/contracts-common";
import {
    deploymentConnectivityStatusSchema,
    deploymentObservabilityContextSchema,
} from "./base.schema";

export const deploymentQueueJobTypeSchema = z.enum([
    "deploy",
    "rollback",
    "retry",
    "reconcile",
    "cleanup",
]);
export type DeploymentQueueJobType = z.infer<typeof deploymentQueueJobTypeSchema>;

export const deploymentQueueJobStatusSchema = z.enum([
    "queued",
    "claimed",
    "running",
    "succeeded",
    "failed",
    "cancelled",
]);
export type DeploymentQueueJobStatus = z.infer<typeof deploymentQueueJobStatusSchema>;

export const deploymentQueueJobPayloadSchema = z.object({
    deploymentId: z.uuid().optional(),
    runId: z.uuid().optional(),
    serviceId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    environment: deploymentEnvironmentSchema.optional(),
    observability: deploymentObservabilityContextSchema.optional(),
    context: z.record(z.string(), z.unknown()).default({}),
});
export type DeploymentQueueJobPayload = z.infer<typeof deploymentQueueJobPayloadSchema>;

export const deploymentQueueJobSchema = z.object({
    id: z.uuid(),
    type: deploymentQueueJobTypeSchema,
    status: deploymentQueueJobStatusSchema,
    idempotencyKey: z.string().min(1),
    workerId: z.string().nullable(),
    lockToken: z.string().nullable(),
    payload: deploymentQueueJobPayloadSchema,
    attempts: z.number().int().min(0),
    maxAttempts: z.number().int().min(1).max(20),
    availableAt: z.string(),
    lastHeartbeatAt: z.string().nullable(),
    leaseExpiresAt: z.string().nullable(),
    connectivityStatus: deploymentConnectivityStatusSchema.nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type DeploymentQueueJob = z.infer<typeof deploymentQueueJobSchema>;

export const deploymentQueueEnqueueInputSchema = z.object({
    type: deploymentQueueJobTypeSchema,
    idempotencyKey: z.string().min(1),
    payload: deploymentQueueJobPayloadSchema,
    maxAttempts: z.number().int().min(1).max(20).default(5),
    availableAt: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DeploymentQueueEnqueueInput = z.infer<typeof deploymentQueueEnqueueInputSchema>;

export const deploymentQueueEnqueueResultSchema = z.object({
    enqueued: z.boolean(),
    deduplicated: z.boolean(),
    job: deploymentQueueJobSchema,
});
export type DeploymentQueueEnqueueResult = z.infer<typeof deploymentQueueEnqueueResultSchema>;

export const deploymentQueueClaimInputSchema = z.object({
    workerId: z.string().min(1),
    workerConnectivityStatus: deploymentConnectivityStatusSchema.optional(),
    types: z.array(deploymentQueueJobTypeSchema).optional(),
    limit: z.number().int().min(1).max(100).default(1),
    leaseDurationSec: z.number().int().min(10).max(3600).default(120),
});
export type DeploymentQueueClaimInput = z.infer<typeof deploymentQueueClaimInputSchema>;

export const deploymentQueueClaimResultSchema = z.object({
    claimed: z.array(deploymentQueueJobSchema),
});
export type DeploymentQueueClaimResult = z.infer<typeof deploymentQueueClaimResultSchema>;

export const deploymentQueueHeartbeatInputSchema = z.object({
    workerId: z.string().min(1),
    lockToken: z.string().min(1),
    connectivityStatus: deploymentConnectivityStatusSchema.optional(),
    extendLeaseSec: z.number().int().min(10).max(3600).default(120),
});
export type DeploymentQueueHeartbeatInput = z.infer<typeof deploymentQueueHeartbeatInputSchema>;

export const deploymentQueueHeartbeatResultSchema = z.object({
    acknowledged: z.boolean(),
    leaseExpiresAt: z.string().nullable(),
    lastHeartbeatAt: z.string().nullable(),
    observedConnectivityStatus: deploymentConnectivityStatusSchema.nullable(),
    observedAt: z.string(),
});
export type DeploymentQueueHeartbeatResult = z.infer<typeof deploymentQueueHeartbeatResultSchema>;

export const deploymentQueueCompleteInputSchema = z.object({
    workerId: z.string().min(1),
    lockToken: z.string().min(1),
    result: z.record(z.string(), z.unknown()).optional(),
});
export type DeploymentQueueCompleteInput = z.infer<typeof deploymentQueueCompleteInputSchema>;

export const deploymentQueueFailInputSchema = z.object({
    workerId: z.string().min(1),
    lockToken: z.string().min(1),
    error: z.string().min(1),
    retryAt: z.string().optional(),
    retryable: z.boolean().default(true),
});
export type DeploymentQueueFailInput = z.infer<typeof deploymentQueueFailInputSchema>;

export const deploymentQueueTransitionResultSchema = z.object({
    updated: z.boolean(),
    job: deploymentQueueJobSchema,
});
export type DeploymentQueueTransitionResult = z.infer<typeof deploymentQueueTransitionResultSchema>;

export const deploymentQueueListInputSchema = z.object({
    type: deploymentQueueJobTypeSchema.optional(),
    status: deploymentQueueJobStatusSchema.optional(),
    workerId: z.string().optional(),
    deploymentId: z.uuid().optional(),
    serviceId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
});
export type DeploymentQueueListInput = z.infer<typeof deploymentQueueListInputSchema>;

export const deploymentQueueListResultSchema = z.object({
    items: z.array(deploymentQueueJobSchema),
    total: z.number().int().min(0),
    hasMore: z.boolean(),
});
export type DeploymentQueueListResult = z.infer<typeof deploymentQueueListResultSchema>;

export const deploymentDeadLetterReasonSchema = z.enum([
    "max_attempts_exceeded",
    "non_retryable_error",
    "manual_dead_letter",
    "expired",
    "poison_payload",
]);
export type DeploymentDeadLetterReason = z.infer<typeof deploymentDeadLetterReasonSchema>;

export const deploymentDeadLetterJobSchema = z.object({
    id: z.uuid(),
    originalJobId: z.uuid(),
    idempotencyKey: z.string().min(1),
    type: deploymentQueueJobTypeSchema,
    payload: deploymentQueueJobPayloadSchema,
    reason: deploymentDeadLetterReasonSchema,
    attempts: z.number().int().min(0),
    maxAttempts: z.number().int().min(1).max(20),
    lastError: z.string().nullable(),
    movedAt: z.string(),
    movedBy: z.string().nullable(),
    replayCount: z.number().int().min(0).default(0),
    lastReplayAt: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type DeploymentDeadLetterJob = z.infer<typeof deploymentDeadLetterJobSchema>;

export const deploymentDeadLetterListInputSchema = z.object({
    type: deploymentQueueJobTypeSchema.optional(),
    reason: deploymentDeadLetterReasonSchema.optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
});
export type DeploymentDeadLetterListInput = z.infer<typeof deploymentDeadLetterListInputSchema>;

export const deploymentDeadLetterListResultSchema = z.object({
    items: z.array(deploymentDeadLetterJobSchema),
    total: z.number().int().min(0),
    hasMore: z.boolean(),
});
export type DeploymentDeadLetterListResult = z.infer<typeof deploymentDeadLetterListResultSchema>;

export const deploymentDeadLetterReplayInputSchema = z.object({
    deadLetterJobId: z.uuid(),
    replayMode: z.enum(["same_payload", "patched_payload"]).default("same_payload"),
    payloadPatch: z.record(z.string(), z.unknown()).optional(),
    scheduledAt: z.string().optional(),
    requestedBy: z.string().optional(),
    reason: z.string().optional(),
});
export type DeploymentDeadLetterReplayInput = z.infer<typeof deploymentDeadLetterReplayInputSchema>;

export const deploymentDeadLetterReplayResultSchema = z.object({
    replayed: z.boolean(),
    deadLetterJobId: z.uuid(),
    replayJobId: z.uuid().nullable(),
    replayCount: z.number().int().min(0),
    message: z.string(),
});
export type DeploymentDeadLetterReplayResult = z.infer<typeof deploymentDeadLetterReplayResultSchema>;
