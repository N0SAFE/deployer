import z from "zod/v4";
import { coreDomainEventEnvelopeSchema } from "./event-stream.schema";

export const meshNodeRoleSchema = z.enum(["edge", "relay", "partition-owner", "observer"]);
export type MeshNodeRole = z.infer<typeof meshNodeRoleSchema>;

export const meshNodeLifecycleStateSchema = z.enum([
    "discovering",
    "connecting",
    "healthy",
    "degraded",
    "suspect",
    "isolated",
    "leaving",
]);
export type MeshNodeLifecycleState = z.infer<typeof meshNodeLifecycleStateSchema>;

export const meshLinkStateSchema = z.enum(["up", "degraded", "down"]);
export type MeshLinkState = z.infer<typeof meshLinkStateSchema>;

export const meshRoutingModeSchema = z.enum(["latency", "balanced", "throughput", "resilience"]);
export type MeshRoutingMode = z.infer<typeof meshRoutingModeSchema>;

export const meshPartitionConsistencyModeSchema = z.enum(["ap", "cp", "hybrid"]);
export type MeshPartitionConsistencyMode = z.infer<typeof meshPartitionConsistencyModeSchema>;

export const meshPeerLinkMetricsSchema = z.object({
    latencyMs: z.number().min(0),
    jitterMs: z.number().min(0),
    packetLossRatio: z.number().min(0).max(1),
    throughputMbps: z.number().min(0),
    reliabilityScore: z.number().min(0).max(1),
    weight: z.number().min(0),
    measuredAt: z.string(),
});
export type MeshPeerLinkMetrics = z.infer<typeof meshPeerLinkMetricsSchema>;

export const systemMetricsSnapshotSchema = z.object({
    capturedAt: z.string(),
    cpu: z.object({
        manufacturer: z.string(),
        brand: z.string(),
        speed: z.number(),
        cores: z.number(),
        physicalCores: z.number(),
        load: z.object({
            currentLoad: z.number(),
            currentLoadUser: z.number(),
            currentLoadSystem: z.number(),
            currentLoadIdle: z.number(),
            cpus: z.array(
                z.object({
                    load: z.number(),
                    loadUser: z.number(),
                    loadSystem: z.number(),
                    loadIdle: z.number(),
                }),
            ),
        }),
    }),
    memory: z.object({
        total: z.number(),
        free: z.number(),
        used: z.number(),
        active: z.number(),
        available: z.number(),
        buffcache: z.number(),
        swaptotal: z.number(),
        swapused: z.number(),
        swapfree: z.number(),
    }),
    disk: z.object({
        totals: z.object({
            size: z.number(),
            used: z.number(),
            available: z.number(),
            use: z.number(),
        }),
        filesystems: z.array(
            z.object({
                fs: z.string(),
                type: z.string(),
                size: z.number(),
                used: z.number(),
                available: z.number(),
                use: z.number(),
                mount: z.string(),
                rw: z.boolean().nullable(),
            }),
        ),
    }),
    network: z.object({
        totals: z.object({
            rxBytes: z.number(),
            txBytes: z.number(),
            rxDropped: z.number(),
            txDropped: z.number(),
            rxErrors: z.number(),
            txErrors: z.number(),
        }),
        interfaces: z.array(
            z.object({
                iface: z.string(),
                operstate: z.string(),
                rxBytes: z.number(),
                txBytes: z.number(),
                rxDropped: z.number(),
                txDropped: z.number(),
                rxErrors: z.number(),
                txErrors: z.number(),
                rxSec: z.number(),
                txSec: z.number(),
            }),
        ),
    }),
    process: z
        .object({
            pid: z.number(),
            name: z.string(),
            cpu: z.number().nullable(),
            mem: z.number().nullable(),
            command: z.string().nullable(),
            started: z.string().nullable(),
        })
        .nullable(),
    gpu: z.object({
        controllers: z.array(
            z.object({
                vendor: z.string(),
                model: z.string(),
                bus: z.string(),
                vram: z.number().nullable(),
                vramDynamic: z.boolean(),
                fanSpeed: z.number().optional(),
                memoryTotal: z.number().optional(),
                memoryUsed: z.number().optional(),
                memoryFree: z.number().optional(),
                utilizationGpu: z.number().optional(),
                utilizationMemory: z.number().optional(),
                temperatureGpu: z.number().optional(),
                temperatureMemory: z.number().optional(),
                powerDraw: z.number().optional(),
                powerLimit: z.number().optional(),
                clockCore: z.number().optional(),
                clockMemory: z.number().optional(),
            }),
        ),
    }),
});
export type SystemMetricsSnapshot = z.infer<typeof systemMetricsSnapshotSchema>;

export const meshNodeStateSchema = z.object({
    nodeId: z.uuid(),
    clusterId: z.uuid(),
    region: z.string().min(1),
    zone: z.string().min(1).optional(),
    roles: z.array(meshNodeRoleSchema).min(1),
    lifecycleState: meshNodeLifecycleStateSchema,
    routingMode: meshRoutingModeSchema,
    consistencyMode: meshPartitionConsistencyModeSchema,
    version: z.string().min(1),
    startedAt: z.string(),
    lastSeenAt: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type MeshNodeState = z.infer<typeof meshNodeStateSchema>;

export const meshPeerConnectionSchema = z.object({
    connectionId: z.uuid(),
    sourceNodeId: z.uuid(),
    targetNodeId: z.uuid(),
    state: meshLinkStateSchema,
    metrics: meshPeerLinkMetricsSchema,
    activePathRank: z.number().int().min(1),
    lastHeartbeatAt: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type MeshPeerConnection = z.infer<typeof meshPeerConnectionSchema>;

export const meshPeersListResultSchema = z.object({
    items: z.array(meshPeerConnectionSchema),
});
export type MeshPeersListResult = z.infer<typeof meshPeersListResultSchema>;

export const meshPeerSessionStateSchema = z.enum(["connected", "reconnecting", "closed"]);
export type MeshPeerSessionState = z.infer<typeof meshPeerSessionStateSchema>;

export const meshPeerSessionSchema = z.object({
    sessionId: z.uuid(),
    peerNodeId: z.uuid().nullable(),
    endpointUrl: z.string().url(),
    state: meshPeerSessionStateSchema,
    reconnectAttempt: z.number().int().min(0),
    nextReconnectAt: z.string().nullable(),
    resumeToken: z.string().min(1),
    duplicateSuppressed: z.boolean().default(false),
    duplicateOfSessionId: z.uuid().nullable(),
    connectedAt: z.string().nullable(),
    disconnectedAt: z.string().nullable(),
    lastHeartbeatAt: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type MeshPeerSession = z.infer<typeof meshPeerSessionSchema>;

export const meshPeerSessionsListResultSchema = z.object({
    items: z.array(meshPeerSessionSchema),
});
export type MeshPeerSessionsListResult = z.infer<typeof meshPeerSessionsListResultSchema>;

export const meshRemoteAuthSessionSchema = z.object({
    serverUrl: z.string().url(),
    sessionId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    userEmail: z.string().email().optional(),
    expiresAt: z.string().optional(),
    retrievedAt: z.string(),
    raw: z.record(z.string(), z.unknown()).nullable().default(null),
});
export type MeshRemoteAuthSession = z.infer<typeof meshRemoteAuthSessionSchema>;

export const meshPeerConnectInputSchema = z.object({
    serverUrl: z.string().url().optional(),
    endpointUrl: z.string().url(),
    resumeToken: z.string().min(1).optional(),
    remoteAuthSession: meshRemoteAuthSessionSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type MeshPeerConnectInput = z.infer<typeof meshPeerConnectInputSchema>;

export const meshPeerConnectResultSchema = z.object({
    connected: z.boolean(),
    deduplicated: z.boolean(),
    resumed: z.boolean(),
    session: meshPeerSessionSchema,
});
export type MeshPeerConnectResult = z.infer<typeof meshPeerConnectResultSchema>;

export const meshPeerDisconnectInputSchema = z.object({
    reason: z.string().min(1).optional(),
    allowReconnect: z.boolean().default(true),
});
export type MeshPeerDisconnectInput = z.infer<typeof meshPeerDisconnectInputSchema>;

export const meshPeerDisconnectResultSchema = z.object({
    disconnected: z.boolean(),
    session: meshPeerSessionSchema,
});
export type MeshPeerDisconnectResult = z.infer<typeof meshPeerDisconnectResultSchema>;

export const meshPeerHeartbeatInputSchema = z.object({
    peerNodeId: z.uuid().optional(),
    latencyMs: z.number().min(0),
    jitterMs: z.number().min(0),
    packetLossRatio: z.number().min(0).max(1),
    throughputMbps: z.number().min(0),
    reliabilityScore: z.number().min(0).max(1),
});
export type MeshPeerHeartbeatInput = z.infer<typeof meshPeerHeartbeatInputSchema>;

export const meshPeerHeartbeatResultSchema = z.object({
    acknowledged: z.boolean(),
    session: meshPeerSessionSchema,
    connection: meshPeerConnectionSchema,
});
export type MeshPeerHeartbeatResult = z.infer<typeof meshPeerHeartbeatResultSchema>;

export const meshControlEnvelopeTypeSchema = z.enum([
    "hello",
    "heartbeat",
    "membership_suspect",
    "membership_confirm",
    "membership_remove",
    "anti_entropy_sync",
    "topology_delta",
    "queue_forward",
    "queue_transition",
    "event_publish",
    "event_replay_request",
    "event_replay_chunk",
    "trust_keyring_sync",
    "trust_keyring_ack",
    "trust_strict_mode_sync",
]);
export type MeshControlEnvelopeType = z.infer<typeof meshControlEnvelopeTypeSchema>;

export const meshControlEnvelopeSchema = z.object({
    envelopeId: z.uuid(),
    organizationId: z.uuid().nullable().optional(),
    keyId: z.string().min(1).optional(),
    algorithm: z.enum(["HS256"]).optional(),
    signature: z.string().min(1).optional(),
    type: meshControlEnvelopeTypeSchema,
    sourceNodeId: z.uuid(),
    targetNodeId: z.uuid().nullable(),
    partitionKey: z.string().min(1).optional(),
    traceId: z.string().min(1).optional(),
    hop: z.number().int().min(0).default(0),
    maxHops: z.number().int().min(1).max(64).default(16),
    emittedAt: z.string(),
    payload: z.record(z.string(), z.unknown()),
});
export type MeshControlEnvelope = z.infer<typeof meshControlEnvelopeSchema>;

export const meshControlEnvelopeAckSchema = z.object({
    accepted: z.boolean(),
    envelopeId: z.uuid(),
    forwardedTo: z.array(z.uuid()),
});
export type MeshControlEnvelopeAck = z.infer<typeof meshControlEnvelopeAckSchema>;

export const meshControlEnvelopePublishResultSchema = meshControlEnvelopeAckSchema;
export type MeshControlEnvelopePublishResult = z.infer<typeof meshControlEnvelopePublishResultSchema>;

/**
 * Typed payload contracts for event transport over mesh control envelopes.
 *
 * Boundary (T268): mesh carries validated domain-event envelopes and replay chunks,
 * but does not own domain event semantics.
 */
export const meshEventPublishPayloadSchema = z.object({
    event: coreDomainEventEnvelopeSchema,
    replayCursor: z.string().min(1).optional(),
    sequence: z.number().int().nonnegative().optional(),
});
export type MeshEventPublishPayload = z.infer<typeof meshEventPublishPayloadSchema>;

export const meshEventReplayChunkPayloadSchema = z.object({
    events: z.array(coreDomainEventEnvelopeSchema),
    fromCursor: z.string().min(1).optional(),
    nextCursor: z.string().min(1).nullable().optional(),
    hasMore: z.boolean().default(false),
});
export type MeshEventReplayChunkPayload = z.infer<typeof meshEventReplayChunkPayloadSchema>;

export const meshMembershipSnapshotSchema = z.object({
    version: z.number().int().min(0),
    generatedAt: z.string(),
    localNode: meshNodeStateSchema,
    nodes: z.array(meshNodeStateSchema),
    connections: z.array(meshPeerConnectionSchema),
    sessions: z.array(meshPeerSessionSchema),
});
export type MeshMembershipSnapshot = z.infer<typeof meshMembershipSnapshotSchema>;

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

export const meshTopologyEventSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("node_upserted"),
        node: meshNodeStateSchema,
        timestamp: z.string(),
    }),
    z.object({
        type: z.literal("node_removed"),
        nodeId: z.uuid(),
        timestamp: z.string(),
    }),
    z.object({
        type: z.literal("edge_upserted"),
        edge: meshPeerConnectionSchema,
        timestamp: z.string(),
    }),
    z.object({
        type: z.literal("edge_removed"),
        connectionId: z.uuid(),
        sourceNodeId: z.uuid(),
        targetNodeId: z.uuid(),
        timestamp: z.string(),
    }),
]);
export type MeshTopologyEvent = z.infer<typeof meshTopologyEventSchema>;

export const meshRuntimeEventReasonSchema = z.enum([
    "bootstrap",
    "session_connected",
    "session_disconnected",
    "session_heartbeat",
    "membership_reconciled",
    "topology_event",
    "control_envelope",
]);
export type MeshRuntimeEventReason = z.infer<typeof meshRuntimeEventReasonSchema>;

export const meshRuntimeEventSchema = z.object({
    type: z.literal("mesh_state"),
    reason: meshRuntimeEventReasonSchema,
    localNode: meshNodeStateSchema,
    peers: z.array(meshPeerConnectionSchema),
    sessions: z.array(meshPeerSessionSchema),
    snapshot: meshMembershipSnapshotSchema,
    topologyEvent: meshTopologyEventSchema.nullable(),
    emittedAt: z.string(),
    revision: z.number().int().min(0),
});
export type MeshRuntimeEvent = z.infer<typeof meshRuntimeEventSchema>;

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

export const meshJoinGrantIssueInputSchema = z.object({
    organizationId: z.uuid().nullable().optional(),
    targetNodeId: z.uuid().nullable().optional(),
    ttlSeconds: z.number().int().min(30).max(86_400).default(900),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type MeshJoinGrantIssueInput = z.infer<typeof meshJoinGrantIssueInputSchema>;

export const meshJoinGrantIssueCommandInputSchema = meshJoinGrantIssueInputSchema.extend({
    issuedByUserId: z.string().min(1),
    issuedByRole: z.string().min(1).nullable().optional(),
});
export type MeshJoinGrantIssueCommandInput = z.infer<typeof meshJoinGrantIssueCommandInputSchema>;

export const meshJoinGrantIssueResultSchema = z.object({
    grantId: z.uuid(),
    clusterId: z.uuid(),
    grantToken: z.string().min(1),
    expiresAt: z.string(),
    status: z.enum(["issued"]),
});
export type MeshJoinGrantIssueResult = z.infer<typeof meshJoinGrantIssueResultSchema>;

export const meshJoinGrantConsumeInputSchema = z.object({
    grantToken: z.string().min(1),
    nodeId: z.uuid(),
    serverUrl: z.string().url(),
    displayName: z.string().min(1).max(255).optional(),
    capabilities: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type MeshJoinGrantConsumeInput = z.infer<typeof meshJoinGrantConsumeInputSchema>;

export const meshJoinGrantConsumeResultSchema = z.object({
    accepted: z.boolean(),
    grantId: z.uuid(),
    clusterId: z.uuid(),
    nodeId: z.uuid(),
    enrolledAt: z.string(),
});
export type MeshJoinGrantConsumeResult = z.infer<typeof meshJoinGrantConsumeResultSchema>;

export const meshRegisterNodeInputSchema = meshJoinGrantConsumeInputSchema.omit({
    grantToken: true,
});
export type MeshRegisterNodeInput = z.infer<typeof meshRegisterNodeInputSchema>;

export const meshRegisterNodeResultSchema = meshJoinGrantConsumeResultSchema.omit({
    grantId: true,
}).extend({
    status: z.enum(["registered", "updated"]),
});
export type MeshRegisterNodeResult = z.infer<typeof meshRegisterNodeResultSchema>;

export const meshJoinGrantRevokeInputSchema = z.object({
    grantId: z.uuid(),
    reason: z.string().min(1).max(500).nullable().optional(),
});
export type MeshJoinGrantRevokeInput = z.infer<typeof meshJoinGrantRevokeInputSchema>;

export const meshJoinGrantRevokeCommandInputSchema = meshJoinGrantRevokeInputSchema.extend({
    revokedByUserId: z.string().min(1),
    revokedByRole: z.string().min(1).nullable().optional(),
});
export type MeshJoinGrantRevokeCommandInput = z.infer<typeof meshJoinGrantRevokeCommandInputSchema>;

export const meshJoinGrantRevokeResultSchema = z.object({
    revoked: z.boolean(),
    grantId: z.uuid(),
    clusterId: z.uuid(),
    status: z.enum(["revoked"]),
    revokedAt: z.string(),
});
export type MeshJoinGrantRevokeResult = z.infer<typeof meshJoinGrantRevokeResultSchema>;

export const meshTrustKeySchema = z.object({
    keyId: z.string().min(1),
    algorithm: z.enum(["HS256"]),
    status: z.enum(["active", "previous"]),
});
export type MeshTrustKey = z.infer<typeof meshTrustKeySchema>;

export const meshTrustKeyringStatusResultSchema = z.object({
    activeKeyId: z.string().min(1).nullable(),
    keys: z.array(meshTrustKeySchema),
});
export type MeshTrustKeyringStatusResult = z.infer<typeof meshTrustKeyringStatusResultSchema>;

export const meshTrustSecretKeySchema = meshTrustKeySchema.extend({
    secretMaterial: z.string().min(1),
});
export type MeshTrustSecretKey = z.infer<typeof meshTrustSecretKeySchema>;

export const meshTrustKeyringSecretsResultSchema = z.object({
    activeKeyId: z.string().min(1).nullable(),
    keys: z.array(meshTrustSecretKeySchema),
});
export type MeshTrustKeyringSecretsResult = z.infer<typeof meshTrustKeyringSecretsResultSchema>;

export const meshTrustKeyringRotateInputSchema = z.object({
    keyId: z.string().min(1).optional(),
    secretMaterial: z.string().min(16).optional(),
    expiresAt: z.string().nullable().optional(),
});
export type MeshTrustKeyringRotateInput = z.infer<typeof meshTrustKeyringRotateInputSchema>;

export const meshTrustKeyringRotateCommandInputSchema = meshTrustKeyringRotateInputSchema.extend({
    rotatedByRole: z.string().min(1).nullable().optional(),
});
export type MeshTrustKeyringRotateCommandInput = z.infer<typeof meshTrustKeyringRotateCommandInputSchema>;

export const meshTrustKeyringRotateResultSchema = z.object({
    activeKeyId: z.string().min(1),
    rotatedKeyId: z.string().min(1),
    secretMaterial: z.string().min(1),
    keys: z.array(meshTrustKeySchema),
});
export type MeshTrustKeyringRotateResult = z.infer<typeof meshTrustKeyringRotateResultSchema>;

export const meshTrustKeyringConvergenceStatusResultSchema = z.object({
    activeKeyId: z.string().min(1).nullable(),
    converged: z.boolean(),
    expectedAcks: z.number().int().min(0),
    receivedAcks: z.number().int().min(0),
    pendingNodeIds: z.array(z.uuid()),
    lastRotatedAt: z.string().nullable(),
});
export type MeshTrustKeyringConvergenceStatusResult = z.infer<typeof meshTrustKeyringConvergenceStatusResultSchema>;

export const meshTrustStrictReadinessResultSchema = z.object({
    ready: z.boolean(),
    strictConfigured: z.boolean(),
    strictEnforced: z.boolean(),
    activeKeyId: z.string().min(1).nullable(),
    converged: z.boolean(),
    expectedAcks: z.number().int().min(0),
    receivedAcks: z.number().int().min(0),
    ackRatio: z.number().min(0).max(1),
    minAckRatio: z.number().min(0).max(1),
    maxAckAgeSeconds: z.number().int().min(1),
    lastRotationAgeSeconds: z.number().int().min(0).nullable(),
    rollbackRecommended: z.boolean(),
    rollbackTriggers: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)),
});
export type MeshTrustStrictReadinessResult = z.infer<typeof meshTrustStrictReadinessResultSchema>;

export const meshTrustStrictRolloutPlanQuerySchema = z.object({
    waveSize: z.coerce.number().int().min(1).max(100).optional(),
});
export type MeshTrustStrictRolloutPlanQuery = z.infer<typeof meshTrustStrictRolloutPlanQuerySchema>;

export const meshTrustStrictRolloutWaveSchema = z.object({
    index: z.number().int().min(1),
    nodeIds: z.array(z.uuid()),
});
export type MeshTrustStrictRolloutWave = z.infer<typeof meshTrustStrictRolloutWaveSchema>;

export const meshTrustStrictRolloutPlanResultSchema = z.object({
    activeKeyId: z.string().min(1).nullable(),
    strictConfigured: z.boolean(),
    strictEnforced: z.boolean(),
    waveSize: z.number().int().min(1),
    ackedNodeIds: z.array(z.uuid()),
    pendingNodeIds: z.array(z.uuid()),
    waves: z.array(meshTrustStrictRolloutWaveSchema),
    rollbackRecommended: z.boolean(),
    rollbackTriggers: z.array(z.string().min(1)),
});
export type MeshTrustStrictRolloutPlanResult = z.infer<typeof meshTrustStrictRolloutPlanResultSchema>;

export const meshTrustStrictModeSetInputSchema = z.object({
    enabled: z.boolean(),
});
export type MeshTrustStrictModeSetInput = z.infer<typeof meshTrustStrictModeSetInputSchema>;

export const meshTrustStrictModeSetCommandInputSchema = meshTrustStrictModeSetInputSchema.extend({
    setByRole: z.string().min(1).nullable().optional(),
});
export type MeshTrustStrictModeSetCommandInput = z.infer<typeof meshTrustStrictModeSetCommandInputSchema>;

export const meshTrustStrictModeSetResultSchema = meshTrustStrictReadinessResultSchema.extend({
    requested: z.boolean(),
});
export type MeshTrustStrictModeSetResult = z.infer<typeof meshTrustStrictModeSetResultSchema>;

export const meshTrustStrictRollbackInputSchema = z.object({
    force: z.boolean().default(false),
    reason: z.string().min(1).max(500).optional(),
});
export type MeshTrustStrictRollbackInput = z.infer<typeof meshTrustStrictRollbackInputSchema>;

export const meshTrustStrictRollbackCommandInputSchema = meshTrustStrictRollbackInputSchema.extend({
    setByRole: z.string().min(1).nullable().optional(),
});
export type MeshTrustStrictRollbackCommandInput = z.infer<typeof meshTrustStrictRollbackCommandInputSchema>;

export const meshTrustStrictRolloutPlanInputSchema = meshTrustStrictRolloutPlanQuerySchema;
export type MeshTrustStrictRolloutPlanInput = z.infer<typeof meshTrustStrictRolloutPlanInputSchema>;

export const meshTrustStrictRollbackResultSchema = meshTrustStrictReadinessResultSchema.extend({
    requested: z.boolean(),
    rolledBack: z.boolean(),
});
export type MeshTrustStrictRollbackResult = z.infer<typeof meshTrustStrictRollbackResultSchema>;

export const meshDuplexStreamAuthInputSchema = z.object({
    type: z.literal("auth"),
    credential: z.string().min(1),
    endpointUrl: z.string().url(),
    serverUrl: z.string().url().optional(),
    resumeToken: z.string().min(1).optional(),
    remoteAuthSession: meshRemoteAuthSessionSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type MeshDuplexStreamAuthInput = z.infer<typeof meshDuplexStreamAuthInputSchema>;

export const meshDuplexStreamHeartbeatInputSchema = z
    .object({
        type: z.literal("heartbeat"),
    })
    .merge(meshPeerHeartbeatInputSchema);
export type MeshDuplexStreamHeartbeatInput = z.infer<typeof meshDuplexStreamHeartbeatInputSchema>;

export const meshDuplexStreamControlInputSchema = z.object({
    type: z.literal("control"),
    envelope: meshControlEnvelopeSchema,
});
export type MeshDuplexStreamControlInput = z.infer<typeof meshDuplexStreamControlInputSchema>;

export const meshDuplexStreamReconcileInputSchema = z.object({
    type: z.literal("reconcile"),
    reconcile: meshMembershipReconcileInputSchema,
});
export type MeshDuplexStreamReconcileInput = z.infer<typeof meshDuplexStreamReconcileInputSchema>;

export const meshDuplexStreamSnapshotRequestInputSchema = z.object({
    type: z.literal("snapshot_request"),
});
export type MeshDuplexStreamSnapshotRequestInput = z.infer<typeof meshDuplexStreamSnapshotRequestInputSchema>;

export const meshDuplexStreamPingInputSchema = z.object({
    type: z.literal("ping"),
    nonce: z.string().min(1).optional(),
});
export type MeshDuplexStreamPingInput = z.infer<typeof meshDuplexStreamPingInputSchema>;

export const meshDuplexStreamDisconnectInputSchema = z.object({
    type: z.literal("disconnect"),
    reason: z.string().min(1).optional(),
    allowReconnect: z.boolean().default(true),
});
export type MeshDuplexStreamDisconnectInput = z.infer<typeof meshDuplexStreamDisconnectInputSchema>;

export const meshDuplexStreamInputSchema = z.discriminatedUnion("type", [
    meshDuplexStreamAuthInputSchema,
    meshDuplexStreamHeartbeatInputSchema,
    meshDuplexStreamControlInputSchema,
    meshDuplexStreamReconcileInputSchema,
    meshDuplexStreamSnapshotRequestInputSchema,
    meshDuplexStreamPingInputSchema,
    meshDuplexStreamDisconnectInputSchema,
]);
export type MeshDuplexStreamInput = z.infer<typeof meshDuplexStreamInputSchema>;

export const meshDuplexStreamAuthOkOutputSchema = z.object({
    type: z.literal("auth_ok"),
    session: meshPeerSessionSchema,
    localNode: meshNodeStateSchema,
});
export type MeshDuplexStreamAuthOkOutput = z.infer<typeof meshDuplexStreamAuthOkOutputSchema>;

export const meshDuplexStreamHeartbeatAckOutputSchema = z.object({
    type: z.literal("heartbeat_ack"),
    session: meshPeerSessionSchema,
    connection: meshPeerConnectionSchema,
});
export type MeshDuplexStreamHeartbeatAckOutput = z.infer<typeof meshDuplexStreamHeartbeatAckOutputSchema>;

export const meshDuplexStreamControlAckOutputSchema = meshControlEnvelopeAckSchema.extend({
    type: z.literal("control_ack"),
});
export type MeshDuplexStreamControlAckOutput = z.infer<typeof meshDuplexStreamControlAckOutputSchema>;

export const meshDuplexStreamReconcileResultOutputSchema = z.object({
    type: z.literal("reconcile_result"),
    result: meshMembershipReconcileResultSchema,
});
export type MeshDuplexStreamReconcileResultOutput = z.infer<typeof meshDuplexStreamReconcileResultOutputSchema>;

export const meshDuplexStreamSnapshotOutputSchema = z.object({
    type: z.literal("snapshot"),
    snapshot: meshMembershipSnapshotSchema,
});
export type MeshDuplexStreamSnapshotOutput = z.infer<typeof meshDuplexStreamSnapshotOutputSchema>;

export const meshDuplexStreamRuntimeEventOutputSchema = z.object({
    type: z.literal("runtime_event"),
    event: meshRuntimeEventSchema,
});
export type MeshDuplexStreamRuntimeEventOutput = z.infer<typeof meshDuplexStreamRuntimeEventOutputSchema>;

export const meshDuplexStreamTopologyEventOutputSchema = z.object({
    type: z.literal("topology_event"),
    event: meshTopologyEventSchema,
});
export type MeshDuplexStreamTopologyEventOutput = z.infer<typeof meshDuplexStreamTopologyEventOutputSchema>;

export const meshDuplexStreamPongOutputSchema = z.object({
    type: z.literal("pong"),
    nonce: z.string().min(1).optional(),
    timestamp: z.string(),
});
export type MeshDuplexStreamPongOutput = z.infer<typeof meshDuplexStreamPongOutputSchema>;

export const meshDuplexStreamDisconnectedOutputSchema = z.object({
    type: z.literal("disconnected"),
    session: meshPeerSessionSchema,
});
export type MeshDuplexStreamDisconnectedOutput = z.infer<typeof meshDuplexStreamDisconnectedOutputSchema>;

export const meshDuplexStreamErrorCodeSchema = z.enum([
    "auth_required",
    "unauthorized",
    "invalid_event",
    "invalid_sequence",
    "processing_error",
]);
export type MeshDuplexStreamErrorCode = z.infer<typeof meshDuplexStreamErrorCodeSchema>;

export const meshDuplexStreamErrorOutputSchema = z.object({
    type: z.literal("error"),
    code: meshDuplexStreamErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean().default(false),
});
export type MeshDuplexStreamErrorOutput = z.infer<typeof meshDuplexStreamErrorOutputSchema>;

export const meshDuplexStreamOutputSchema = z.discriminatedUnion("type", [
    meshDuplexStreamAuthOkOutputSchema,
    meshDuplexStreamHeartbeatAckOutputSchema,
    meshDuplexStreamControlAckOutputSchema,
    meshDuplexStreamReconcileResultOutputSchema,
    meshDuplexStreamSnapshotOutputSchema,
    meshDuplexStreamRuntimeEventOutputSchema,
    meshDuplexStreamTopologyEventOutputSchema,
    meshDuplexStreamPongOutputSchema,
    meshDuplexStreamDisconnectedOutputSchema,
    meshDuplexStreamErrorOutputSchema,
]);
export type MeshDuplexStreamOutput = z.infer<typeof meshDuplexStreamOutputSchema>;
