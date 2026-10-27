import z from "zod/v4";
import {
    deploymentExecutionProgressSchema,
    deploymentObservabilityContextSchema,
} from "./base.schema";

export const deploymentExecutionStateSchema = z.enum([
    "queued",
    "running",
    "cancellation_requested",
    "cancelled",
    "failed",
    "completed",
    "resumable",
    "resuming",
]);
export type DeploymentExecutionState = z.infer<typeof deploymentExecutionStateSchema>;

export const deploymentExecutionCheckpointSchema = z.object({
    id: z.uuid(),
    deploymentId: z.uuid(),
    runId: z.uuid(),
    planHash: z.string().nullable(),
    state: deploymentExecutionStateSchema,
    currentNodeId: z.string().nullable(),
    completedNodeIds: z.array(z.string()).default([]),
    pendingNodeIds: z.array(z.string()).default([]),
    failedNodeIds: z.array(z.string()).default([]),
    cancellationRequestedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    resumedFromRunId: z.uuid().nullable(),
    observability: deploymentObservabilityContextSchema.nullable(),
    progress: deploymentExecutionProgressSchema.nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type DeploymentExecutionCheckpoint = z.infer<typeof deploymentExecutionCheckpointSchema>;

export const deploymentExecutionCancelInputSchema = z.object({
    reason: z.string().min(1).optional(),
    force: z.boolean().default(false),
    gracefulTimeoutSec: z.number().int().min(0).max(3_600).default(120),
    requestedBy: z.string().min(1).optional(),
    observability: deploymentObservabilityContextSchema.optional(),
});
export type DeploymentExecutionCancelInput = z.infer<typeof deploymentExecutionCancelInputSchema>;

export const deploymentExecutionCancelResultSchema = z.object({
    accepted: z.boolean(),
    deploymentId: z.uuid(),
    runId: z.uuid().nullable(),
    state: deploymentExecutionStateSchema,
    checkpoint: deploymentExecutionCheckpointSchema.nullable(),
    message: z.string(),
});
export type DeploymentExecutionCancelResult = z.infer<typeof deploymentExecutionCancelResultSchema>;

export const deploymentExecutionResumeInputSchema = z.object({
    resumeFromRunId: z.uuid().optional(),
    resumeFromNodeId: z.string().optional(),
    strategy: z.enum(["from_last_checkpoint", "from_node", "restart_failed_branch"]).default("from_last_checkpoint"),
    requestedBy: z.string().min(1).optional(),
    reason: z.string().optional(),
    observability: deploymentObservabilityContextSchema.optional(),
});
export type DeploymentExecutionResumeInput = z.infer<typeof deploymentExecutionResumeInputSchema>;

export const deploymentExecutionResumeResultSchema = z.object({
    resumed: z.boolean(),
    deploymentId: z.uuid(),
    previousRunId: z.uuid().nullable(),
    runId: z.uuid(),
    state: deploymentExecutionStateSchema,
    checkpoint: deploymentExecutionCheckpointSchema,
    message: z.string(),
});
export type DeploymentExecutionResumeResult = z.infer<typeof deploymentExecutionResumeResultSchema>;

export const deploymentExecutionCheckpointByRunResultSchema = z.object({
    runId: z.uuid(),
    checkpoint: deploymentExecutionCheckpointSchema.nullable(),
});
export type DeploymentExecutionCheckpointByRunResult = z.infer<typeof deploymentExecutionCheckpointByRunResultSchema>;
