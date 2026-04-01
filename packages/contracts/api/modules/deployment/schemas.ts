import z from "zod/v4";
import { templateKindSchema, templateScopeSchema, templateVersionSchema } from "@repo/contracts-entities";
import {
    DEPLOYMENT_ENVIRONMENT_VALUES,
    DEPLOYMENT_PHASE_VALUES,
    DEPLOYMENT_STATUS_VALUES,
    ROLLBACK_STATUS_VALUES,
    SOURCE_TYPE_VALUES,
} from "@repo/contracts-common";

export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUS_VALUES);

export const deploymentPhaseSchema = z.enum(DEPLOYMENT_PHASE_VALUES);
export type DeploymentPhase = z.infer<typeof deploymentPhaseSchema>;

export const rollbackStatusSchema = z.enum(ROLLBACK_STATUS_VALUES);
export type RollbackStatus = z.infer<typeof rollbackStatusSchema>;
export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;

export const deploymentEnvironmentSchema = z.enum(DEPLOYMENT_ENVIRONMENT_VALUES);
export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>;

export const sourceTypeSchema = z.enum(SOURCE_TYPE_VALUES);
export type SourceType = z.infer<typeof sourceTypeSchema>;

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

export const deploymentTemplateProvenanceSourceSchema = z.enum(["template", "inlineOverride", "runtimeDefault"]);
export type DeploymentTemplateProvenanceSource = z.infer<typeof deploymentTemplateProvenanceSourceSchema>;

export const deploymentTemplateProvenanceLayerSchema = z.enum(["global", "provider", "project", "environment", "run"]);
export type DeploymentTemplateProvenanceLayer = z.infer<typeof deploymentTemplateProvenanceLayerSchema>;

export const deploymentTemplateProvenanceEntrySchema = z.object({
    kind: templateKindSchema,
    templateId: z.uuid(),
    version: templateVersionSchema,
    scope: templateScopeSchema,
    source: deploymentTemplateProvenanceSourceSchema,
    appliedLayer: deploymentTemplateProvenanceLayerSchema,
    resolvedFromLayers: z.array(deploymentTemplateProvenanceLayerSchema).default([]),
    overridePatch: z.record(z.string(), z.unknown()).nullable(),
    digest: z.string().nullable(),
});
export type DeploymentTemplateProvenanceEntry = z.infer<typeof deploymentTemplateProvenanceEntrySchema>;

export const deploymentTemplateProvenanceSchema = z.object({
    id: z.uuid(),
    deploymentId: z.uuid(),
    runId: z.uuid().nullable(),
    planHash: z.string().nullable(),
    templates: z.array(deploymentTemplateProvenanceEntrySchema),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    capturedAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type DeploymentTemplateProvenance = z.infer<typeof deploymentTemplateProvenanceSchema>;

export const deploymentTemplateProvenanceUpsertInputSchema = z.object({
    deploymentId: z.uuid(),
    runId: z.uuid().optional(),
    planHash: z.string().optional(),
    templates: z.array(deploymentTemplateProvenanceEntrySchema).min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DeploymentTemplateProvenanceUpsertInput = z.infer<typeof deploymentTemplateProvenanceUpsertInputSchema>;

export const deploymentTemplateProvenanceUpsertResultSchema = z.object({
    persisted: z.boolean(),
    provenance: deploymentTemplateProvenanceSchema,
});
export type DeploymentTemplateProvenanceUpsertResult = z.infer<typeof deploymentTemplateProvenanceUpsertResultSchema>;

export const deploymentTemplateProvenanceByRunResultSchema = z.object({
    runId: z.uuid(),
    records: z.array(deploymentTemplateProvenanceSchema),
});
export type DeploymentTemplateProvenanceByRunResult = z.infer<typeof deploymentTemplateProvenanceByRunResultSchema>;

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

export const deploymentPhaseGuardSchema = z.enum([
    "requiresCompiledPlan",
    "requiresHealthyDependencies",
    "requiresRouteSync",
    "requiresActiveLease",
    "requiresNoCancellation",
]);
export type DeploymentPhaseGuard = z.infer<typeof deploymentPhaseGuardSchema>;

export const deploymentPhaseTransitionSchema = z.object({
    from: deploymentPhaseSchema,
    to: deploymentPhaseSchema,
    allowed: z.boolean(),
    guards: z.array(deploymentPhaseGuardSchema).default([]),
    reason: z.string().nullable(),
});
export type DeploymentPhaseTransition = z.infer<typeof deploymentPhaseTransitionSchema>;

export const deploymentPhaseViolationSchema = z.object({
    guard: deploymentPhaseGuardSchema,
    message: z.string().min(1),
    severity: z.enum(["error", "warning"]).default("error"),
});
export type DeploymentPhaseViolation = z.infer<typeof deploymentPhaseViolationSchema>;

export const deploymentPhaseTransitionValidationInputSchema = z.object({
    deploymentId: z.uuid(),
    runId: z.uuid().optional(),
    currentPhase: deploymentPhaseSchema,
    targetPhase: deploymentPhaseSchema,
    context: z.record(z.string(), z.unknown()).default({}),
});
export type DeploymentPhaseTransitionValidationInput = z.infer<
    typeof deploymentPhaseTransitionValidationInputSchema
>;

export const deploymentPhaseTransitionValidationResultSchema = z.object({
    valid: z.boolean(),
    transition: deploymentPhaseTransitionSchema,
    violations: z.array(deploymentPhaseViolationSchema).default([]),
});
export type DeploymentPhaseTransitionValidationResult = z.infer<
    typeof deploymentPhaseTransitionValidationResultSchema
>;

export const deploymentPhaseTransitionApplyInputSchema = deploymentPhaseTransitionValidationInputSchema.extend({
    force: z.boolean().default(false),
    actorId: z.string().optional(),
});
export type DeploymentPhaseTransitionApplyInput = z.infer<typeof deploymentPhaseTransitionApplyInputSchema>;

export const deploymentPhaseTransitionApplyResultSchema = z.object({
    applied: z.boolean(),
    deploymentId: z.uuid(),
    previousPhase: deploymentPhaseSchema,
    currentPhase: deploymentPhaseSchema,
    transition: deploymentPhaseTransitionSchema,
    violations: z.array(deploymentPhaseViolationSchema).default([]),
});
export type DeploymentPhaseTransitionApplyResult = z.infer<typeof deploymentPhaseTransitionApplyResultSchema>;

export const deploymentPhaseTransitionsCatalogSchema = z.object({
    transitions: z.array(deploymentPhaseTransitionSchema),
});
export type DeploymentPhaseTransitionsCatalog = z.infer<typeof deploymentPhaseTransitionsCatalogSchema>;

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
