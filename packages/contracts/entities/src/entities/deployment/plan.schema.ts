import z from "zod/v4";
import { deploymentEnvironmentSchema } from "@repo/contracts-common";
import {
    deploymentExecutionProgressSchema,
    deploymentObservabilityContextSchema,
} from "./base.schema";

export const deploymentPlanNodeSchema = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    label: z.string().min(1),
    dependsOn: z.array(z.string()).default([]),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type DeploymentPlanNode = z.infer<typeof deploymentPlanNodeSchema>;

export const deploymentPlanEdgeSchema = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    kind: z.enum(["dependency", "rollback", "retry", "gate"]).default("dependency"),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type DeploymentPlanEdge = z.infer<typeof deploymentPlanEdgeSchema>;

export const deploymentCompiledPlanSnapshotSchema = z.object({
    id: z.uuid(),
    deploymentId: z.uuid(),
    runId: z.uuid(),
    planHash: z.string().min(1),
    compilerVersion: z.string().min(1),
    immutable: z.literal(true),
    context: z.record(z.string(), z.unknown()).nullable(),
    nodes: z.array(deploymentPlanNodeSchema),
    edges: z.array(deploymentPlanEdgeSchema),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
});
export type DeploymentCompiledPlanSnapshot = z.infer<typeof deploymentCompiledPlanSnapshotSchema>;

export const deploymentCreateCompiledPlanSnapshotInputSchema = z.object({
    deploymentId: z.uuid(),
    runId: z.uuid(),
    planHash: z.string().min(1),
    compilerVersion: z.string().min(1),
    context: z.record(z.string(), z.unknown()).optional(),
    nodes: z.array(deploymentPlanNodeSchema),
    edges: z.array(deploymentPlanEdgeSchema),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DeploymentCreateCompiledPlanSnapshotInput = z.infer<typeof deploymentCreateCompiledPlanSnapshotInputSchema>;

export const deploymentCreateCompiledPlanSnapshotResultSchema = z.object({
    persisted: z.boolean(),
    snapshot: deploymentCompiledPlanSnapshotSchema,
});
export type DeploymentCreateCompiledPlanSnapshotResult = z.infer<typeof deploymentCreateCompiledPlanSnapshotResultSchema>;

export const deploymentListCompiledPlanSnapshotsResultSchema = z.object({
    deploymentId: z.uuid(),
    snapshots: z.array(deploymentCompiledPlanSnapshotSchema),
});
export type DeploymentListCompiledPlanSnapshotsResult = z.infer<typeof deploymentListCompiledPlanSnapshotsResultSchema>;

export const deploymentCompiledPlanSnapshotByRunResultSchema = z.object({
    runId: z.uuid(),
    snapshot: deploymentCompiledPlanSnapshotSchema.nullable(),
});
export type DeploymentCompiledPlanSnapshotByRunResult = z.infer<typeof deploymentCompiledPlanSnapshotByRunResultSchema>;

export const deploymentPlanCompilerTemplateRefsSchema = z.object({
    providerTemplateId: z.uuid().optional(),
    buildTemplateId: z.uuid().optional(),
    deployTemplateId: z.uuid().optional(),
    routeTemplateId: z.uuid().optional(),
    previewTemplateId: z.uuid().optional(),
    dependencyTemplateId: z.uuid().optional(),
});
export type DeploymentPlanCompilerTemplateRefs = z.infer<typeof deploymentPlanCompilerTemplateRefsSchema>;

export const deploymentPlanCompileInputSchema = z.object({
    deploymentId: z.uuid().optional(),
    runId: z.uuid().optional(),
    serviceId: z.uuid(),
    projectId: z.uuid(),
    environment: deploymentEnvironmentSchema,
    templateRefs: deploymentPlanCompilerTemplateRefsSchema,
    context: z.record(z.string(), z.unknown()).default({}),
    observability: deploymentObservabilityContextSchema.optional(),
    deterministicSeed: z.string().optional(),
    includeRollbackEdges: z.boolean().default(true),
    strict: z.boolean().default(true),
});
export type DeploymentPlanCompileInput = z.infer<typeof deploymentPlanCompileInputSchema>;

export const deploymentCompiledPlanSchema = z.object({
    planHash: z.string().min(1),
    compilerVersion: z.string().min(1),
    deterministic: z.boolean(),
    nodes: z.array(deploymentPlanNodeSchema),
    edges: z.array(deploymentPlanEdgeSchema),
    progress: deploymentExecutionProgressSchema.nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type DeploymentCompiledPlan = z.infer<typeof deploymentCompiledPlanSchema>;

export const deploymentRollbackTriggerSchema = z.enum([
    "node_failure",
    "health_gate_failure",
    "timeout",
    "manual",
    "policy",
]);
export type DeploymentRollbackTrigger = z.infer<typeof deploymentRollbackTriggerSchema>;

export const deploymentRollbackEdgeSchema = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    kind: z.literal("rollback"),
    trigger: deploymentRollbackTriggerSchema,
    compensationNodeId: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type DeploymentRollbackEdge = z.infer<typeof deploymentRollbackEdgeSchema>;

export const deploymentCompiledRollbackGraphSchema = z.object({
    planHash: z.string().min(1),
    rollbackEdges: z.array(deploymentRollbackEdgeSchema),
    rollbackCoverage: z.object({
        totalNodes: z.number().int().min(0),
        protectedNodes: z.number().int().min(0),
        uncoveredNodes: z.number().int().min(0),
    }),
    issues: z
        .array(
            z.object({
                code: z.string().min(1),
                message: z.string().min(1),
                severity: z.enum(["error", "warning", "info"]),
                nodeId: z.string().optional(),
            }),
        )
        .default([]),
});
export type DeploymentCompiledRollbackGraph = z.infer<typeof deploymentCompiledRollbackGraphSchema>;

export const deploymentCompileRollbackEdgesInputSchema = z.object({
    plan: deploymentCompiledPlanSchema,
    strict: z.boolean().default(true),
    includePolicyTriggers: z.boolean().default(true),
});
export type DeploymentCompileRollbackEdgesInput = z.infer<typeof deploymentCompileRollbackEdgesInputSchema>;

export const deploymentCompileRollbackEdgesResultSchema = z.object({
    compiled: z.boolean(),
    graph: deploymentCompiledRollbackGraphSchema,
});
export type DeploymentCompileRollbackEdgesResult = z.infer<typeof deploymentCompileRollbackEdgesResultSchema>;

export const deploymentPlanCompileResultSchema = z.object({
    compiled: z.boolean(),
    plan: deploymentCompiledPlanSchema.optional(),
    observability: deploymentObservabilityContextSchema.optional(),
    issues: z
        .array(
            z.object({
                code: z.string().min(1),
                message: z.string().min(1),
                severity: z.enum(["error", "warning", "info"]),
                path: z.array(z.union([z.string(), z.number()])).default([]),
            }),
        )
        .default([]),
});
export type DeploymentPlanCompileResult = z.infer<typeof deploymentPlanCompileResultSchema>;
