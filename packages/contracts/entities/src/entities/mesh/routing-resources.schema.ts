import z from "zod/v4";
import {
    meshMembershipSnapshotSchema,
    meshNodeRoleSchema,
} from "./topology.schema";

export const meshResourceKindSchema = z.enum(["deployment", "stream", "log", "queue", "topic"]);
export type MeshResourceKind = z.infer<typeof meshResourceKindSchema>;

export const meshDirectProtocolSchema = z.enum(["http", "https", "ws", "wss", "sse"]);
export type MeshDirectProtocol = z.infer<typeof meshDirectProtocolSchema>;

export const meshOrganizationScopeSchema = z.object({
    organizationId: z.uuid().nullable().optional(),
});
export type MeshOrganizationScope = z.infer<typeof meshOrganizationScopeSchema>;

export const meshOrganizationCandidateScopeSchema = meshOrganizationScopeSchema.extend({
    includeCandidates: z.boolean().default(true),
});
export type MeshOrganizationCandidateScope = z.infer<typeof meshOrganizationCandidateScopeSchema>;

export const meshStreamReplayQuerySchema = z.object({
    replay: z.coerce.boolean().default(true),
    replayLimit: z.coerce.number().int().min(1).max(500).default(1),
});
export type MeshStreamReplayQuery = z.infer<typeof meshStreamReplayQuerySchema>;

export const meshStreamRoutePlanInputSchema = meshOrganizationCandidateScopeSchema.extend({
    streamId: z.uuid(),
    desiredBranches: z.coerce.number().int().min(1).max(6).default(1),
});
export type MeshStreamRoutePlanInput = z.infer<typeof meshStreamRoutePlanInputSchema>;

export const meshStreamRoutePlanBranchSchema = z.object({
    ownerNodeId: z.uuid(),
    ownerServerUrl: z.string().url(),
    endpointPath: z.string().min(1),
    protocol: meshDirectProtocolSchema,
    priority: z.number().int().min(1),
    estimatedWeight: z.number().min(0),
});
export type MeshStreamRoutePlanBranch = z.infer<typeof meshStreamRoutePlanBranchSchema>;

export const meshStreamRoutePlanResultSchema = z.object({
    streamId: z.uuid(),
    selected: z.array(meshStreamRoutePlanBranchSchema),
    candidates: z.array(meshStreamRoutePlanBranchSchema),
});
export type MeshStreamRoutePlanResult = z.infer<typeof meshStreamRoutePlanResultSchema>;

export const meshRuntimeStreamQuerySchema = meshStreamReplayQuerySchema.extend({
    replayLimit: z.coerce.number().int().min(1).max(1_000).default(100),
});
export type MeshRuntimeStreamQuery = z.infer<typeof meshRuntimeStreamQuerySchema>;

export const meshTopologyStreamQuerySchema = meshRuntimeStreamQuerySchema.extend({
    replay: z.coerce.boolean().default(true),
    includeEdges: z.coerce.boolean().default(true),
    includeNodes: z.coerce.boolean().default(true),
});
export type MeshTopologyStreamQuery = z.infer<typeof meshTopologyStreamQuerySchema>;

export const meshTopologyStreamInputSchema = meshOrganizationScopeSchema.extend(meshTopologyStreamQuerySchema.shape);
export type MeshTopologyStreamInput = z.infer<typeof meshTopologyStreamInputSchema>;

export const meshMembershipReconcileInputSchema = z.object({
    organizationId: z.uuid().nullable().optional(),
    snapshot: meshMembershipSnapshotSchema,
    sourceNodeId: z.uuid(),
    dryRun: z.boolean().default(false),
});
export type MeshMembershipReconcileInput = z.infer<typeof meshMembershipReconcileInputSchema>;

export const meshMembershipReconcileResultSchema = z.object({
    mergedNodes: z.number().int().min(0),
    mergedConnections: z.number().int().min(0),
    mergedSessions: z.number().int().min(0),
    skippedStale: z.number().int().min(0),
    version: z.number().int().min(0),
});
export type MeshMembershipReconcileResult = z.infer<typeof meshMembershipReconcileResultSchema>;

export const meshResourceLocationSchema = z.object({
    organizationId: z.uuid().nullable().optional(),
    kind: meshResourceKindSchema,
    key: z.string().min(1),
    ownerNodeId: z.uuid(),
    ownerServerUrl: z.string().url(),
    endpointPath: z.string().min(1),
    endpointMethod: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    protocol: meshDirectProtocolSchema,
    persistentConnectionRequired: z.boolean().default(false),
    abortEndpointPath: z.string().min(1).optional(),
    priority: z.number().int().min(1).default(100),
    version: z.number().int().min(0).default(1),
    updatedAt: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type MeshResourceLocation = z.infer<typeof meshResourceLocationSchema>;

export const meshResourceLookupInputSchema = meshOrganizationCandidateScopeSchema.extend({
    kind: meshResourceKindSchema,
    key: z.string().min(1),
});
export type MeshResourceLookupInput = z.infer<typeof meshResourceLookupInputSchema>;

export const meshResourceLookupResultSchema = z.object({
    found: z.boolean(),
    query: meshResourceLookupInputSchema,
    primary: meshResourceLocationSchema.nullable(),
    candidates: z.array(meshResourceLocationSchema),
});
export type MeshResourceLookupResult = z.infer<typeof meshResourceLookupResultSchema>;

export const meshResourceIndexUpsertInputSchema = z.object({
    organizationId: z.uuid().nullable().optional(),
    sourceNodeId: z.uuid(),
    resources: z.array(meshResourceLocationSchema).min(1),
    replaceExistingForSource: z.boolean().default(false),
});
export type MeshResourceIndexUpsertInput = z.infer<typeof meshResourceIndexUpsertInputSchema>;

export const meshResourceIndexUpsertResultSchema = z.object({
    accepted: z.boolean(),
    sourceNodeId: z.uuid(),
    upserted: z.number().int().min(0),
    replaced: z.number().int().min(0),
});
export type MeshResourceIndexUpsertResult = z.infer<typeof meshResourceIndexUpsertResultSchema>;

export const meshQueuePartitionPlanInputSchema = meshOrganizationCandidateScopeSchema.extend({
    queue: z.string().min(1),
    partitionKey: z.string().min(1),
    leaseHolderNodeId: z.uuid().nullable().optional(),
    leaseExpiresAt: z.string().nullable().optional(),
});
export type MeshQueuePartitionPlanInput = z.infer<typeof meshQueuePartitionPlanInputSchema>;

export const meshQueuePartitionPlanCandidateSchema = z.object({
    nodeId: z.uuid(),
    ownerServerUrl: z.string().url().nullable(),
    score: z.number().int().min(0),
    role: meshNodeRoleSchema,
    local: z.boolean(),
});
export type MeshQueuePartitionPlanCandidate = z.infer<typeof meshQueuePartitionPlanCandidateSchema>;

export const meshQueuePartitionPlanResultSchema = z.object({
    queue: z.string().min(1),
    partitionKey: z.string().min(1),
    ownerNodeId: z.uuid(),
    ownerServerUrl: z.string().url().nullable(),
    forwardingRequired: z.boolean(),
    forwardedToNodeId: z.uuid().nullable(),
    leaseHandoff: z.boolean(),
    selectedAt: z.string(),
    candidates: z.array(meshQueuePartitionPlanCandidateSchema),
});
export type MeshQueuePartitionPlanResult = z.infer<typeof meshQueuePartitionPlanResultSchema>;

export const meshQueueTransitionPayloadSchema = z.object({
    transitionId: z.uuid(),
    queue: z.string().min(1),
    partitionKey: z.string().min(1),
    jobId: z.uuid().nullable().optional(),
    fromStatus: z.string().min(1).nullable().optional(),
    toStatus: z.string().min(1),
    workerId: z.uuid().nullable().optional(),
    idempotencyKey: z.string().min(1),
    occurredAt: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type MeshQueueTransitionPayload = z.infer<typeof meshQueueTransitionPayloadSchema>;

export const meshQueueTransitionLogEntrySchema = z.object({
    organizationId: z.uuid().nullable().optional(),
    sourceNodeId: z.uuid(),
    sequence: z.number().int().min(1),
    payloadHash: z.string().min(1),
    payload: meshQueueTransitionPayloadSchema,
    receivedAt: z.string(),
});
export type MeshQueueTransitionLogEntry = z.infer<typeof meshQueueTransitionLogEntrySchema>;

const meshQueueTransitionAppendPayloadSchema = meshQueueTransitionPayloadSchema.omit({
    transitionId: true,
    occurredAt: true,
    metadata: true,
});

export const meshQueueTransitionAppendInputSchema = meshQueueTransitionAppendPayloadSchema.extend({
    organizationId: z.uuid().nullable().optional(),
    occurredAt: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type MeshQueueTransitionAppendInput = z.infer<typeof meshQueueTransitionAppendInputSchema>;

const meshQueueTransitionWriteResultBaseSchema = z.object({
    duplicate: z.boolean(),
    reason: z.string().nullable(),
    entry: meshQueueTransitionLogEntrySchema,
});

export const meshQueueTransitionAppendResultSchema = meshQueueTransitionWriteResultBaseSchema.extend({
    appended: z.boolean(),
});
export type MeshQueueTransitionAppendResult = z.infer<typeof meshQueueTransitionAppendResultSchema>;

export const meshQueueTransitionApplyInputSchema = z.object({
    entry: meshQueueTransitionLogEntrySchema,
});
export type MeshQueueTransitionApplyInput = z.infer<typeof meshQueueTransitionApplyInputSchema>;

export const meshQueueTransitionApplyResultSchema = meshQueueTransitionWriteResultBaseSchema.extend({
    applied: z.boolean(),
});
export type MeshQueueTransitionApplyResult = z.infer<typeof meshQueueTransitionApplyResultSchema>;

export const meshQueueTransitionListInputSchema = z.object({
    organizationId: z.uuid().nullable().optional(),
    queue: z.string().min(1).optional(),
    partitionKey: z.string().min(1).optional(),
    sourceNodeId: z.uuid().optional(),
    fromSequence: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(500).default(100),
});
export type MeshQueueTransitionListInput = z.infer<typeof meshQueueTransitionListInputSchema>;

export const meshQueueTransitionListResultSchema = z.object({
    items: z.array(meshQueueTransitionLogEntrySchema),
    total: z.number().int().min(0),
    nextFromSequence: z.number().int().min(1).nullable(),
});
export type MeshQueueTransitionListResult = z.infer<typeof meshQueueTransitionListResultSchema>;
