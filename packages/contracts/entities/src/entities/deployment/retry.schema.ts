import z from "zod/v4";
import { deploymentQueueJobTypeSchema } from "./queue.schema";

export const deploymentRetryNodeTypeSchema = z.enum([
    "source",
    "build",
    "artifact",
    "deploy",
    "route",
    "health",
    "verify",
    "rollback",
    "cleanup",
]);
export type DeploymentRetryNodeType = z.infer<typeof deploymentRetryNodeTypeSchema>;

export const deploymentRetryTaskTypeSchema = z.enum([
    "execute",
    "validate",
    "monitor",
    "compensate",
]);
export type DeploymentRetryTaskType = z.infer<typeof deploymentRetryTaskTypeSchema>;

export const deploymentRetryBackoffStrategySchema = z.enum([
    "fixed",
    "linear",
    "exponential",
    "exponential_jitter",
]);
export type DeploymentRetryBackoffStrategy = z.infer<typeof deploymentRetryBackoffStrategySchema>;

export const deploymentRetryPolicySchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    jobType: deploymentQueueJobTypeSchema.optional(),
    nodeType: deploymentRetryNodeTypeSchema.optional(),
    taskType: deploymentRetryTaskTypeSchema.optional(),
    maxAttempts: z.number().int().min(1).max(20),
    strategy: deploymentRetryBackoffStrategySchema.default("exponential_jitter"),
    initialBackoffMs: z.number().int().min(0).max(600_000),
    maxBackoffMs: z.number().int().min(0).max(3_600_000),
    multiplier: z.number().min(1).max(10).default(2),
    jitterRatio: z.number().min(0).max(1).default(0.2),
    retryableErrorCodes: z.array(z.string()).default([]),
    nonRetryableErrorCodes: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type DeploymentRetryPolicy = z.infer<typeof deploymentRetryPolicySchema>;

export const deploymentRetryPolicyListInputSchema = z.object({
    jobType: deploymentQueueJobTypeSchema.optional(),
    nodeType: deploymentRetryNodeTypeSchema.optional(),
    taskType: deploymentRetryTaskTypeSchema.optional(),
    enabledOnly: z.boolean().default(true),
});
export type DeploymentRetryPolicyListInput = z.infer<typeof deploymentRetryPolicyListInputSchema>;

export const deploymentRetryPolicyCatalogResultSchema = z.object({
    policies: z.array(deploymentRetryPolicySchema),
});
export type DeploymentRetryPolicyCatalogResult = z.infer<typeof deploymentRetryPolicyCatalogResultSchema>;

export const deploymentRetryPolicyResolveInputSchema = z.object({
    jobType: deploymentQueueJobTypeSchema,
    nodeType: deploymentRetryNodeTypeSchema,
    taskType: deploymentRetryTaskTypeSchema,
    attempt: z.number().int().min(1),
    errorCode: z.string().optional(),
    at: z.string().optional(),
});
export type DeploymentRetryPolicyResolveInput = z.infer<typeof deploymentRetryPolicyResolveInputSchema>;

export const deploymentRetryPolicyResolveResultSchema = z.object({
    matched: z.boolean(),
    policy: deploymentRetryPolicySchema.nullable(),
    retryAllowed: z.boolean(),
    remainingAttempts: z.number().int().min(0),
    backoffMs: z.number().int().min(0).nullable(),
    nextRetryAt: z.string().nullable(),
    reason: z.string().nullable(),
});
export type DeploymentRetryPolicyResolveResult = z.infer<typeof deploymentRetryPolicyResolveResultSchema>;
