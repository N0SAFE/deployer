import z from "zod/v4";
import { deploymentPhaseSchema } from "@repo/contracts-common";
import {
    deploymentConnectivityStatusSchema,
    deploymentExecutionProgressSchema,
    deploymentObservabilityContextSchema,
} from "./base.schema";
import { deploymentExecutionStateSchema } from "./execution.schema";

export const deploymentNodeLifecycleEventTypeSchema = z.enum([
    "start",
    "success",
    "fail",
    "retry",
    "rollback",
]);
export type DeploymentNodeLifecycleEventType = z.infer<typeof deploymentNodeLifecycleEventTypeSchema>;

export const deploymentNodeLifecycleEventSchema = z.object({
    id: z.uuid(),
    deploymentId: z.uuid(),
    runId: z.uuid(),
    nodeId: z.string().min(1),
    nodeType: z.string().min(1),
    type: deploymentNodeLifecycleEventTypeSchema,
    sequence: z.number().int().min(0),
    attempt: z.number().int().min(1).default(1),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    state: deploymentExecutionStateSchema.optional(),
    phase: deploymentPhaseSchema.optional(),
    progress: deploymentExecutionProgressSchema.nullable(),
    observability: deploymentObservabilityContextSchema.nullable(),
    connectivityStatus: deploymentConnectivityStatusSchema.nullable(),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    rollbackToNodeId: z.string().nullable(),
    durationMs: z.number().int().min(0).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    emittedAt: z.string(),
});
export type DeploymentNodeLifecycleEvent = z.infer<typeof deploymentNodeLifecycleEventSchema>;

export const deploymentNodeLifecycleEventEmitInputSchema = z.object({
    deploymentId: z.uuid(),
    runId: z.uuid(),
    nodeId: z.string().min(1),
    nodeType: z.string().min(1),
    type: deploymentNodeLifecycleEventTypeSchema,
    sequence: z.number().int().min(0),
    attempt: z.number().int().min(1).default(1),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    state: deploymentExecutionStateSchema.optional(),
    phase: deploymentPhaseSchema.optional(),
    progress: deploymentExecutionProgressSchema.optional(),
    observability: deploymentObservabilityContextSchema.optional(),
    connectivityStatus: deploymentConnectivityStatusSchema.optional(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    rollbackToNodeId: z.string().optional(),
    durationMs: z.number().int().min(0).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    emittedAt: z.string().optional(),
});
export type DeploymentNodeLifecycleEventEmitInput = z.infer<typeof deploymentNodeLifecycleEventEmitInputSchema>;

export const deploymentNodeLifecycleEventEmitResultSchema = z.object({
    emitted: z.boolean(),
    event: deploymentNodeLifecycleEventSchema,
});
export type DeploymentNodeLifecycleEventEmitResult = z.infer<typeof deploymentNodeLifecycleEventEmitResultSchema>;

export const deploymentNodeLifecycleEventListInputSchema = z.object({
    deploymentId: z.uuid().optional(),
    runId: z.uuid().optional(),
    nodeId: z.string().optional(),
    type: deploymentNodeLifecycleEventTypeSchema.optional(),
    fromSequence: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(500).default(100),
});
export type DeploymentNodeLifecycleEventListInput = z.infer<typeof deploymentNodeLifecycleEventListInputSchema>;

export const deploymentNodeLifecycleEventListResultSchema = z.object({
    events: z.array(deploymentNodeLifecycleEventSchema),
    hasMore: z.boolean(),
    nextFromSequence: z.number().int().min(0).nullable(),
});
export type DeploymentNodeLifecycleEventListResult = z.infer<typeof deploymentNodeLifecycleEventListResultSchema>;
