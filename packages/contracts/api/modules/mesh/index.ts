import z from "zod/v4";
import { oc } from "@orpc/contract";
import { route } from "@repo/orpc-utils/builder";
import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import {
    coreEventScopeSchema,
    coreEventStreamDefinitionSchema,
    coreSyncedEventEnvelopeSchema,
} from "@repo/api-contracts/common/event-stream";
import {
    meshResourceIndexUpsertInputSchema,
    meshResourceIndexUpsertResultSchema,
    meshResourceLookupInputSchema,
    meshResourceLookupResultSchema,
    meshQueuePartitionPlanInputSchema,
    meshQueuePartitionPlanResultSchema,
    meshDuplexStreamInputSchema,
    meshDuplexStreamOutputSchema,
    meshControlEnvelopeSchema,
    meshMembershipReconcileInputSchema,
    meshMembershipReconcileResultSchema,
    meshMembershipSnapshotSchema,
    meshPeerConnectInputSchema,
    meshPeerConnectResultSchema,
    meshPeerDisconnectInputSchema,
    meshPeerDisconnectResultSchema,
    meshPeerHeartbeatInputSchema,
    meshPeerHeartbeatResultSchema,
    meshPeerSessionSchema,
    meshRuntimeEventSchema,
    meshNodeStateSchema,
    meshPeerConnectionSchema,
    meshTopologyEventSchema,
    meshJoinGrantIssueInputSchema,
    meshJoinGrantIssueResultSchema,
    meshJoinGrantConsumeInputSchema,
    meshJoinGrantConsumeResultSchema,
    meshJoinGrantRevokeInputSchema,
    meshJoinGrantRevokeResultSchema,
    meshTrustKeyringRotateInputSchema,
    meshTrustKeyringRotateResultSchema,
    meshTrustKeyringStatusResultSchema,
    meshTrustKeyringSecretsResultSchema,
    meshTrustKeyringConvergenceStatusResultSchema,
    meshTrustStrictReadinessResultSchema,
    meshTrustStrictModeSetInputSchema,
    meshTrustStrictModeSetResultSchema,
    meshTrustStrictRollbackInputSchema,
    meshTrustStrictRollbackResultSchema,
    meshTrustStrictRolloutPlanQuerySchema,
    meshTrustStrictRolloutPlanResultSchema,
} from "@repo/api-contracts/common/mesh";

const meshEventStreamOps = standard.zod(coreEventStreamDefinitionSchema, "meshEventStream");

const meshEventStreamListConfig = createFilterConfig(meshEventStreamOps)
    .withPagination({
        defaultLimit: 20,
        maxLimit: 100,
        includeOffset: true,
    } as const)
    .withSorting(["createdAt", "updatedAt", "name", "namespace"] as const, {
        defaultField: "createdAt",
        defaultDirection: "desc",
    })
    .withFiltering({
        name: {
            schema: coreEventStreamDefinitionSchema.shape.name,
            operators: ["eq", "like", "ilike"] as const,
        },
        namespace: {
            schema: coreEventStreamDefinitionSchema.shape.namespace,
            operators: ["eq", "like", "ilike"] as const,
        },
        isActive: {
            schema: coreEventStreamDefinitionSchema.shape.isActive,
            operators: ["eq"] as const,
        },
        scope: {
            schema: coreEventScopeSchema,
            operators: ["eq"] as const,
        },
        scopeId: {
            schema: coreEventStreamDefinitionSchema.shape.scopeId,
            operators: ["eq"] as const,
        },
        createdBy: {
            schema: coreEventStreamDefinitionSchema.shape.createdBy,
            operators: ["eq"] as const,
        },
    })
    .buildConfig();

export type MeshEventStreamListInput = ComputeInputSchema<typeof meshEventStreamListConfig>;

export const meshEventStreamListConfigSchemas = meshEventStreamListConfig;

const meshStreamReplayQuerySchema = z.object({
    replay: z.coerce.boolean().default(true),
    replayLimit: z.coerce.number().int().min(1).max(500).default(1),
});

const meshStreamRoutePlanInputSchema = z.object({
    organizationId: z.uuid().nullable().optional(),
    streamId: z.uuid(),
    desiredBranches: z.coerce.number().int().min(1).max(6).default(1),
    includeCandidates: z.coerce.boolean().default(true),
});

const meshStreamRoutePlanBranchSchema = z.object({
    ownerNodeId: z.uuid(),
    ownerServerUrl: z.string().url(),
    endpointPath: z.string().min(1),
    protocol: z.enum(["http", "https", "ws", "wss", "sse"]),
    priority: z.number().int().min(1),
    estimatedWeight: z.number().min(0),
});

const meshStreamRoutePlanResultSchema = z.object({
    streamId: z.uuid(),
    selected: z.array(meshStreamRoutePlanBranchSchema),
    candidates: z.array(meshStreamRoutePlanBranchSchema),
});

const meshTopologyStreamQuerySchema = z.object({
    replay: z.coerce.boolean().default(true),
    replayLimit: z.coerce.number().int().min(1).max(1_000).default(100),
    includeEdges: z.coerce.boolean().default(true),
    includeNodes: z.coerce.boolean().default(true),
});

const meshRuntimeStreamQuerySchema = z.object({
    replay: z.coerce.boolean().default(true),
    replayLimit: z.coerce.number().int().min(1).max(1_000).default(100),
});

export const meshGetLocalNodeContract = route({
    method: "GET",
    path: "/node/local",
    summary: "Get local mesh node state",
})
    .output((b) => b.body(meshNodeStateSchema))
    .build();

export const meshListPeersContract = route({
    method: "GET",
    path: "/peers",
    summary: "List active mesh peers and link metrics",
})
    .output((b) => b.body(z.object({ items: z.array(meshPeerConnectionSchema) })))
    .build();

export const meshListPeerSessionsContract = route({
    method: "GET",
    path: "/peers/sessions",
    summary: "List mesh peer sessions and reconnect status",
})
    .output((b) => b.body(z.object({ items: z.array(meshPeerSessionSchema) })))
    .build();

export const meshListEventStreamsContract = meshEventStreamOps.list(meshEventStreamListConfig).build();

export const meshFindEventStreamByIdContract = route({
    method: "GET",
    path: "/streams/{id}",
    summary: "Find an event stream by id through mesh control plane",
})
    .input((b) => b.params((p) => p`/streams/${p("id", z.uuid())}`))
    .output((b) => b.body(coreEventStreamDefinitionSchema))
    .build();

export const meshStreamSubscribeContract = route({
    method: "GET",
    path: "/streams/{id}/subscribe",
    summary: "Subscribe to a stream using mesh lookup metadata and owner stream endpoint",
})
    .input((b) =>
        b
            .params((p) => p`/streams/${p("id", z.uuid())}/subscribe`)
            .query(meshStreamReplayQuerySchema),
    )
    .output((b) => b.streamed(coreSyncedEventEnvelopeSchema))
    .build();

export const meshPlanStreamRouteContract = route({
    method: "POST",
    path: "/streams/plan",
    summary: "Build weighted branch plan for stream subscription fan-out",
})
    .input((b) => b.body(meshStreamRoutePlanInputSchema))
    .output((b) => b.body(meshStreamRoutePlanResultSchema))
    .build();

export const meshConnectPeerContract = route({
    method: "POST",
    path: "/peers/connect",
    summary: "Connect to a peer or resume an existing peer session",
})
    .input((b) => b.body(meshPeerConnectInputSchema))
    .output((b) => b.body(meshPeerConnectResultSchema))
    .build();

export const meshDisconnectPeerContract = route({
    method: "POST",
    path: "/peers/{sessionId}/disconnect",
    summary: "Disconnect a peer session and optionally schedule reconnect",
})
    .input((b) =>
        b
            .params((p) => p`/peers/${p("sessionId", z.uuid())}/disconnect`)
            .body(meshPeerDisconnectInputSchema),
    )
    .output((b) => b.body(meshPeerDisconnectResultSchema))
    .build();

export const meshPeerHeartbeatContract = route({
    method: "POST",
    path: "/peers/{sessionId}/heartbeat",
    summary: "Refresh peer session health and weighted connection metrics",
})
    .input((b) =>
        b
            .params((p) => p`/peers/${p("sessionId", z.uuid())}/heartbeat`)
            .body(meshPeerHeartbeatInputSchema),
    )
    .output((b) => b.body(meshPeerHeartbeatResultSchema))
    .build();

export const meshMembershipSnapshotContract = route({
    method: "GET",
    path: "/membership/snapshot",
    summary: "Get local membership snapshot for anti-entropy reconciliation",
})
    .output((b) => b.body(meshMembershipSnapshotSchema))
    .build();

export const meshMembershipReconcileContract = route({
    method: "POST",
    path: "/membership/reconcile",
    summary: "Merge remote membership snapshot into local mesh view",
})
    .input((b) => b.body(meshMembershipReconcileInputSchema))
    .output((b) => b.body(meshMembershipReconcileResultSchema))
    .build();

export const meshTopologyStreamContract = route({
    method: "GET",
    path: "/topology/stream",
    summary: "Stream topology updates and weighted edge changes",
})
    .input((b) => b.query(meshTopologyStreamQuerySchema))
    .output((b) => b.streamed(meshTopologyEventSchema))
    .build();

export const meshRuntimeStreamContract = route({
    method: "GET",
    path: "/events/stream",
    summary: "Stream unified mesh runtime events from a single channel",
})
    .input((b) => b.query(meshRuntimeStreamQuerySchema))
    .output((b) => b.streamed(meshRuntimeEventSchema))
    .build();

export const meshControlEnvelopePublishContract = route({
    method: "POST",
    path: "/control/publish",
    summary: "Publish a typed mesh control envelope to peers",
})
    .input((b) => b.body(meshControlEnvelopeSchema))
    .output((b) =>
        b.body(
            z.object({
                accepted: z.boolean(),
                envelopeId: z.uuid(),
                forwardedTo: z.array(z.uuid()),
            }),
        ),
    )
    .build();

export const meshSessionStreamContract = route({
    method: "POST",
    path: "/session/stream",
    summary: "Bidirectional mesh session stream with auth-first handshake over a single kept-alive connection",
})
    .input((b) => b.body.streamed(meshDuplexStreamInputSchema))
    .output((b) => b.streamed(meshDuplexStreamOutputSchema))
    .build();

export const meshLookupResourceContract = route({
    method: "POST",
    path: "/lookup",
    summary: "Resolve resource ownership and direct endpoint routing metadata across mesh",
})
    .input((b) => b.body(meshResourceLookupInputSchema))
    .output((b) => b.body(meshResourceLookupResultSchema))
    .build();

export const meshUpsertResourceIndexContract = route({
    method: "POST",
    path: "/index/upsert",
    summary: "Upsert resource ownership index entries used for mesh lookup/search",
})
    .input((b) => b.body(meshResourceIndexUpsertInputSchema))
    .output((b) => b.body(meshResourceIndexUpsertResultSchema))
    .build();

export const meshPlanQueuePartitionContract = route({
    method: "POST",
    path: "/queue/partitions/plan",
    summary: "Resolve deterministic queue partition owner and forwarding target across mesh nodes",
})
    .input((b) => b.body(meshQueuePartitionPlanInputSchema))
    .output((b) => b.body(meshQueuePartitionPlanResultSchema))
    .build();

export const meshIssueJoinGrantContract = route({
    method: "POST",
    path: "/enrollment/grants/issue",
    summary: "Issue one-time bootstrap join grant for URL-first node enrollment",
})
    .input((b) => b.body(meshJoinGrantIssueInputSchema))
    .output((b) => b.body(meshJoinGrantIssueResultSchema))
    .build();

export const meshConsumeJoinGrantContract = route({
    method: "POST",
    path: "/enrollment/grants/consume",
    summary: "Consume one-time bootstrap join grant and enroll node in cluster",
})
    .input((b) => b.body(meshJoinGrantConsumeInputSchema))
    .output((b) => b.body(meshJoinGrantConsumeResultSchema))
    .build();

export const meshRevokeJoinGrantContract = route({
    method: "POST",
    path: "/enrollment/grants/revoke",
    summary: "Revoke an issued bootstrap join grant before it is consumed",
})
    .input((b) => b.body(meshJoinGrantRevokeInputSchema))
    .output((b) => b.body(meshJoinGrantRevokeResultSchema))
    .build();

export const meshTrustKeyringStatusContract = route({
    method: "GET",
    path: "/trust/keyring",
    summary: "Get current mesh trust keyring status (active + previous keys)",
})
    .output((b) => b.body(meshTrustKeyringStatusResultSchema))
    .build();

export const meshTrustKeyringSecretsContract = route({
    method: "GET",
    path: "/trust/keyring/secrets",
    summary: "Get current mesh trust keyring secret material for internal mesh consumers",
})
    .output((b) => b.body(meshTrustKeyringSecretsResultSchema))
    .build();

export const meshTrustKeyringRotateContract = route({
    method: "POST",
    path: "/trust/keyring/rotate",
    summary: "Rotate active mesh trust key and sync active/previous keyring state",
})
    .input((b) => b.body(meshTrustKeyringRotateInputSchema))
    .output((b) => b.body(meshTrustKeyringRotateResultSchema))
    .build();

export const meshTrustKeyringConvergenceStatusContract = route({
    method: "GET",
    path: "/trust/keyring/convergence",
    summary: "Get mesh trust key rotation propagation convergence status across peers",
})
    .output((b) => b.body(meshTrustKeyringConvergenceStatusResultSchema))
    .build();

export const meshTrustStrictReadinessContract = route({
    method: "GET",
    path: "/trust/strict/readiness",
    summary: "Check whether mesh trust can safely enable strict envelope signature enforcement",
})
    .output((b) => b.body(meshTrustStrictReadinessResultSchema))
    .build();

export const meshTrustStrictModeSetContract = route({
    method: "POST",
    path: "/trust/strict/mode",
    summary: "Set fleet strict trust enforcement mode after readiness gating",
})
    .input((b) => b.body(meshTrustStrictModeSetInputSchema))
    .output((b) => b.body(meshTrustStrictModeSetResultSchema))
    .build();

export const meshTrustStrictRolloutPlanContract = route({
    method: "GET",
    path: "/trust/strict/rollout-plan",
    summary: "Get staged strict trust enablement waves and rollback trigger guidance",
})
    .input((b) => b.query(meshTrustStrictRolloutPlanQuerySchema))
    .output((b) => b.body(meshTrustStrictRolloutPlanResultSchema))
    .build();

export const meshTrustStrictRollbackContract = route({
    method: "POST",
    path: "/trust/strict/rollback",
    summary: "Rollback runtime strict trust mode when readiness rollback triggers are active",
})
    .input((b) => b.body(meshTrustStrictRollbackInputSchema))
    .output((b) => b.body(meshTrustStrictRollbackResultSchema))
    .build();

export const meshContract = oc.tag("Core Mesh").prefix("/mesh").router({
    getLocalNode: meshGetLocalNodeContract,
    listPeers: meshListPeersContract,
    listPeerSessions: meshListPeerSessionsContract,
    listEventStreams: meshListEventStreamsContract,
    findEventStreamById: meshFindEventStreamByIdContract,
    subscribeEventStream: meshStreamSubscribeContract,
    planStreamRoute: meshPlanStreamRouteContract,
    connectPeer: meshConnectPeerContract,
    disconnectPeer: meshDisconnectPeerContract,
    heartbeatPeer: meshPeerHeartbeatContract,
    membershipSnapshot: meshMembershipSnapshotContract,
    reconcileMembership: meshMembershipReconcileContract,
    streamTopology: meshTopologyStreamContract,
    streamEvents: meshRuntimeStreamContract,
    publishControlEnvelope: meshControlEnvelopePublishContract,
    streamSession: meshSessionStreamContract,
    lookupResource: meshLookupResourceContract,
    upsertResourceIndex: meshUpsertResourceIndexContract,
    planQueuePartition: meshPlanQueuePartitionContract,
    issueJoinGrant: meshIssueJoinGrantContract,
    consumeJoinGrant: meshConsumeJoinGrantContract,
    revokeJoinGrant: meshRevokeJoinGrantContract,
    trustKeyringStatus: meshTrustKeyringStatusContract,
    trustKeyringSecrets: meshTrustKeyringSecretsContract,
    trustKeyringRotate: meshTrustKeyringRotateContract,
    trustKeyringConvergenceStatus: meshTrustKeyringConvergenceStatusContract,
    trustStrictReadiness: meshTrustStrictReadinessContract,
    trustStrictModeSet: meshTrustStrictModeSetContract,
    trustStrictRolloutPlan: meshTrustStrictRolloutPlanContract,
    trustStrictRollback: meshTrustStrictRollbackContract,
});

export type MeshContract = typeof meshContract;
