import z from "zod/v4";
import { oc } from "@orpc/contract";
import {
    createFilterConfig,
    error,
    standard,
    type ComputeInputSchema,
} from "@repo/orpc-utils";
import {
    coreEventScopeSchema,
    coreEventStreamDefinitionSchema,
    coreSyncedEventEnvelopeSchema,
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
    meshPeerSessionsListResultSchema,
    meshPeersListResultSchema,
    meshPingResultSchema,
    meshRuntimeEventSchema,
    meshRuntimeStreamQuerySchema,
    meshNodeStateSchema,
    meshControlEnvelopePublishResultSchema,
    meshStreamReplayQuerySchema,
    meshStreamRoutePlanInputSchema,
    meshStreamRoutePlanResultSchema,
    meshTopologyStreamQuerySchema,
    meshTopologyEventSchema,
    systemMetricsSnapshotSchema,
    meshJoinGrantIssueInputSchema,
    meshJoinGrantIssueResultSchema,
    meshJoinGrantConsumeInputSchema,
    meshJoinGrantConsumeResultSchema,
    meshRegisterNodeInputSchema,
    meshRegisterNodeResultSchema,
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
    meshNodeConfigSchema,
    meshNodeConfigUpdateInputSchema,
    meshNodeConfigUpdateResultSchema,
    meshNodeConfigRegenerateSecretResultSchema,
    meshNodeConfigTestDbInputSchema,
    meshNodeConfigTestDbResultSchema,
} from "@repo/contracts-entities";

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

const meshNodeStateOps = standard.zod(meshNodeStateSchema, "meshNodeState");
const meshSystemMetricsOps = standard.zod(systemMetricsSnapshotSchema, "meshSystemMetrics");
const meshPeersListOps = standard.zod(meshPeersListResultSchema, "meshPeersList");
const meshPeerSessionsListOps = standard.zod(meshPeerSessionsListResultSchema, "meshPeerSessionsList");
const meshPingOps = standard.zod(meshPingResultSchema, "meshPing");
const meshEventStreamByIdOps = standard.zod(coreEventStreamDefinitionSchema, "meshEventStreamById");
const meshStreamSubscribeOps = standard.zod(coreSyncedEventEnvelopeSchema, "meshStreamSubscribe");
const meshStreamRoutePlanOps = standard.zod(meshStreamRoutePlanResultSchema, "meshStreamRoutePlan");
const meshPeerConnectOps = standard.zod(meshPeerConnectResultSchema, "meshPeerConnect");
const meshPeerDisconnectOps = standard.zod(meshPeerDisconnectResultSchema, "meshPeerDisconnect");
const meshPeerHeartbeatOps = standard.zod(meshPeerHeartbeatResultSchema, "meshPeerHeartbeat");
const meshMembershipSnapshotOps = standard.zod(meshMembershipSnapshotSchema, "meshMembershipSnapshot");
const meshMembershipReconcileOps = standard.zod(meshMembershipReconcileResultSchema, "meshMembershipReconcile");

const meshTopologyEventContractEntitySchema = z.object({
    type: z.string(),
    timestamp: z.date(),
});

const meshTopologyEventOps = standard.zod(meshTopologyEventContractEntitySchema, "meshTopologyEvent");
const meshRuntimeEventOps = standard.zod(meshRuntimeEventSchema, "meshRuntimeEvent");
const meshControlEnvelopePublishOps = standard.zod(
    meshControlEnvelopePublishResultSchema,
    "meshControlEnvelopePublish",
);

const meshSessionStreamContractEntitySchema = z.object({
    type: z.string(),
});

const meshSessionStreamOps = standard.zod(meshSessionStreamContractEntitySchema, "meshSessionStream");
const meshResourceLookupOps = standard.zod(meshResourceLookupResultSchema, "meshResourceLookup");
const meshResourceIndexUpsertOps = standard.zod(
    meshResourceIndexUpsertResultSchema,
    "meshResourceIndexUpsert",
);
const meshQueuePartitionPlanOps = standard.zod(
    meshQueuePartitionPlanResultSchema,
    "meshQueuePartitionPlan",
);
const meshJoinGrantIssueOps = standard.zod(meshJoinGrantIssueResultSchema, "meshJoinGrantIssue");
const meshJoinGrantConsumeOps = standard.zod(meshJoinGrantConsumeResultSchema, "meshJoinGrantConsume");
const meshRegisterNodeOps = standard.zod(meshRegisterNodeResultSchema, "meshRegisterNode");
const meshJoinGrantRevokeOps = standard.zod(meshJoinGrantRevokeResultSchema, "meshJoinGrantRevoke");
const meshTrustKeyringStatusOps = standard.zod(meshTrustKeyringStatusResultSchema, "meshTrustKeyringStatus");
const meshTrustKeyringSecretsOps = standard.zod(meshTrustKeyringSecretsResultSchema, "meshTrustKeyringSecrets");
const meshTrustKeyringRotateOps = standard.zod(meshTrustKeyringRotateResultSchema, "meshTrustKeyringRotate");
const meshTrustKeyringConvergenceStatusOps = standard.zod(
    meshTrustKeyringConvergenceStatusResultSchema,
    "meshTrustKeyringConvergenceStatus",
);
const meshTrustStrictReadinessOps = standard.zod(
    meshTrustStrictReadinessResultSchema,
    "meshTrustStrictReadiness",
);
const meshTrustStrictModeSetOps = standard.zod(meshTrustStrictModeSetResultSchema, "meshTrustStrictModeSet");
const meshTrustStrictRolloutPlanOps = standard.zod(
    meshTrustStrictRolloutPlanResultSchema,
    "meshTrustStrictRolloutPlan",
);
const meshTrustStrictRollbackOps = standard.zod(
    meshTrustStrictRollbackResultSchema,
    "meshTrustStrictRollback",
);
const meshNodeConfigOps = standard.zod(meshNodeConfigSchema, "meshNodeConfig");
const meshNodeConfigUpdateOps = standard.zod(meshNodeConfigUpdateResultSchema, "meshNodeConfigUpdate");
const meshNodeConfigRegenerateSecretOps = standard.zod(
    meshNodeConfigRegenerateSecretResultSchema,
    "meshNodeConfigRegenerateSecret",
);
const meshNodeConfigTestDbOps = standard.zod(meshNodeConfigTestDbResultSchema, "meshNodeConfigTestDb");

export const meshGetLocalNodeContract = meshNodeStateOps
    .list()
    .path("/node/local")
    .output((b) => meshNodeStateSchema)
    .build();

/**
 * Public, unauthenticated ping endpoint. The controller implementation
 * MUST NOT require a session or an internal mesh key — this is the
 * only route that lets a brand-new node check that a peer is reachable
 * before it has any credentials.
 *
 * Response shape: { ok: true, version, advertisedHost }
 *
 * See `meshPingResultSchema` for the contract.
 */
export const meshPingContract = meshPingOps
    .list()
    .path("/ping")
    .output((b) => b.body(meshPingResultSchema))
    .build();

export const meshGetNodeMetricsContract = meshSystemMetricsOps
    .list()
    .path("/node/metrics")
    .output((b) => b.body(systemMetricsSnapshotSchema))
    .build();

export const meshListPeersContract = meshPeersListOps
    .list()
    .path("/peers")
    .output((b) => b.body(meshPeersListResultSchema))
    .build();

export const meshListPeerSessionsContract = meshPeerSessionsListOps
    .list()
    .path("/peers/sessions")
    .output((b) => b.body(meshPeerSessionsListResultSchema))
    .build();

export const meshListEventStreamsContract = meshEventStreamOps.list(meshEventStreamListConfig).build();

export const meshFindEventStreamByIdContract = meshEventStreamByIdOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/streams/${p("id", z.uuid())}`))
    .output((b) => b.body(coreEventStreamDefinitionSchema))
    .build();

export const meshStreamSubscribeContract = meshStreamSubscribeOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/streams/${p("id", z.uuid())}/subscribe`)
            .query(meshStreamReplayQuerySchema),
    )
    .output((b) => b.observable(coreSyncedEventEnvelopeSchema))
    .build();

export const meshPlanStreamRouteContract = meshStreamRoutePlanOps
    .create()
    .path("/streams/plan")
    .input((b) => b.body(meshStreamRoutePlanInputSchema))
    .output((b) => b.body(meshStreamRoutePlanResultSchema))
    .build();

export const meshConnectPeerContract = meshPeerConnectOps
    .create()
    .path("/peers/connect")
    .input((b) => b.body(meshPeerConnectInputSchema))
    .output((b) => b.body(meshPeerConnectResultSchema))
    .build();

export const meshDisconnectPeerContract = meshPeerDisconnectOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/peers/${p("sessionId", z.uuid())}/disconnect`)
            .body(meshPeerDisconnectInputSchema),
    )
    .output((b) => b.body(meshPeerDisconnectResultSchema))
    .build();

export const meshPeerHeartbeatContract = meshPeerHeartbeatOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/peers/${p("sessionId", z.uuid())}/heartbeat`)
            .body(meshPeerHeartbeatInputSchema),
    )
    .output((b) => b.body(meshPeerHeartbeatResultSchema))
    .build();

export const meshMembershipSnapshotContract = meshMembershipSnapshotOps
    .list()
    .path("/membership/snapshot")
    .output((b) => b.body(meshMembershipSnapshotSchema))
    .build();

export const meshMembershipReconcileContract = meshMembershipReconcileOps
    .create()
    .path("/membership/reconcile")
    .input((b) => b.body(meshMembershipReconcileInputSchema))
    .output((b) => b.body(meshMembershipReconcileResultSchema))
    .build();

export const meshTopologyStreamContract = meshTopologyEventOps
    .list()
    .path("/topology/stream")
    .input((b) => b.query(meshTopologyStreamQuerySchema))
    .output((b) => b.observable(meshTopologyEventSchema))
    .build();

export const meshRuntimeStreamContract = meshRuntimeEventOps
    .list()
    .path("/events/stream")
    .input((b) => b.query(meshRuntimeStreamQuerySchema))
    .output((b) => b.observable(meshRuntimeEventSchema))
    .build();

export const meshControlEnvelopePublishContract = meshControlEnvelopePublishOps
    .create()
    .path("/control/publish")
    .input((b) => b.body(meshControlEnvelopeSchema))
    .output((b) => b.body(meshControlEnvelopePublishResultSchema))
    .build();

export const meshSessionStreamContract = meshSessionStreamOps
    .create()
    .path("/session/stream")
    .input((b) => b.body.observable(meshDuplexStreamInputSchema))
    .output((b) => b.observable(meshDuplexStreamOutputSchema))
    .build();

export const meshLookupResourceContract = meshResourceLookupOps
    .create()
    .path("/lookup")
    .input((b) => b.body(meshResourceLookupInputSchema))
    .output((b) => b.body(meshResourceLookupResultSchema))
    .build();

export const meshUpsertResourceIndexContract = meshResourceIndexUpsertOps
    .create()
    .path("/index/upsert")
    .input((b) => b.body(meshResourceIndexUpsertInputSchema))
    .output((b) => b.body(meshResourceIndexUpsertResultSchema))
    .build();

export const meshPlanQueuePartitionContract = meshQueuePartitionPlanOps
    .create()
    .path("/queue/partitions/plan")
    .input((b) => b.body(meshQueuePartitionPlanInputSchema))
    .output((b) => b.body(meshQueuePartitionPlanResultSchema))
    .build();

export const meshIssueJoinGrantContract = meshJoinGrantIssueOps
    .create()
    .path("/enrollment/grants/issue")
    .input((b) => b.body(meshJoinGrantIssueInputSchema))
    .output((b) => b.body(meshJoinGrantIssueResultSchema))
    .build();

export const meshConsumeJoinGrantContract = meshJoinGrantConsumeOps
    .create()
    .path("/enrollment/grants/consume")
    .input((b) => b.body(meshJoinGrantConsumeInputSchema))
    .output((b) => b.body(meshJoinGrantConsumeResultSchema))
    .errors(
        error("NOT_FOUND").status(404).message("Mesh resource not found"),
        error("BAD_REQUEST").status(400).message("Mesh validation error"),
        error("FORBIDDEN").status(403).message("Mesh unauthorized"),
        error("FORBIDDEN").status(403).message("Mesh trust error"),
        error("CONFLICT").status(409).message("Mesh conflict"),
        error("FAILED_DEPENDENCY").status(424).message("Mesh dependency missing"),
    )
    .build();

export const meshRegisterNodeContract = meshRegisterNodeOps
    .create()
    .path("/enrollment/register")
    .input((b) => b.body(meshRegisterNodeInputSchema))
    .output((b) => meshRegisterNodeResultSchema)
    .build();

export const meshRevokeJoinGrantContract = meshJoinGrantRevokeOps
    .create()
    .path("/enrollment/grants/revoke")
    .input((b) => b.body(meshJoinGrantRevokeInputSchema))
    .output((b) => meshJoinGrantRevokeResultSchema)
    .errors(
        error("NOT_FOUND").status(404).message("Mesh resource not found"),
        error("BAD_REQUEST").status(400).message("Mesh validation error"),
        error("FORBIDDEN").status(403).message("Mesh unauthorized"),
        error("FORBIDDEN").status(403).message("Mesh trust error"),
        error("CONFLICT").status(409).message("Mesh conflict"),
        error("FAILED_DEPENDENCY").status(424).message("Mesh dependency missing"),
    )
    .build();

export const meshTrustKeyringStatusContract = meshTrustKeyringStatusOps
    .list()
    .path("/trust/keyring")
    .output((b) => b.body(meshTrustKeyringStatusResultSchema))
    .build();

export const meshTrustKeyringSecretsContract = meshTrustKeyringSecretsOps
    .list()
    .path("/trust/keyring/secrets")
    .output((b) => b.body(meshTrustKeyringSecretsResultSchema))
    .build();

export const meshTrustKeyringRotateContract = meshTrustKeyringRotateOps
    .create()
    .path("/trust/keyring/rotate")
    .input((b) => b.body(meshTrustKeyringRotateInputSchema))
    .output((b) => b.body(meshTrustKeyringRotateResultSchema))
    .build();

export const meshTrustKeyringConvergenceStatusContract = meshTrustKeyringConvergenceStatusOps
    .list()
    .path("/trust/keyring/convergence")
    .output((b) => b.body(meshTrustKeyringConvergenceStatusResultSchema))
    .build();

export const meshTrustStrictReadinessContract = meshTrustStrictReadinessOps
    .list()
    .path("/trust/strict/readiness")
    .output((b) => b.body(meshTrustStrictReadinessResultSchema))
    .build();

export const meshTrustStrictModeSetContract = meshTrustStrictModeSetOps
    .create()
    .path("/trust/strict/mode")
    .input((b) => b.body(meshTrustStrictModeSetInputSchema))
    .output((b) => b.body(meshTrustStrictModeSetResultSchema))
    .build();

export const meshTrustStrictRolloutPlanContract = meshTrustStrictRolloutPlanOps
    .list()
    .path("/trust/strict/rollout-plan")
    .input((b) => b.query(meshTrustStrictRolloutPlanQuerySchema))
    .output((b) => b.body(meshTrustStrictRolloutPlanResultSchema))
    .build();

export const meshTrustStrictRollbackContract = meshTrustStrictRollbackOps
    .create()
    .path("/trust/strict/rollback")
    .input((b) => b.body(meshTrustStrictRollbackInputSchema))
    .output((b) => b.body(meshTrustStrictRollbackResultSchema))
    .build();

export const meshGetNodeConfigContract = meshNodeConfigOps
    .list()
    .path("/node/config")
    .input((b) => b.body(z.object({}).optional()))
    .output((b) => b.body(meshNodeConfigSchema))
    .build();

export const meshUpdateNodeConfigContract = meshNodeConfigUpdateOps
    .create()
    .path("/node/config")
    .input((b) => b.body(meshNodeConfigUpdateInputSchema))
    .output((b) => b.body(meshNodeConfigUpdateResultSchema))
    .build();

export const meshRegenerateNodeConfigSecretContract = meshNodeConfigRegenerateSecretOps
    .create()
    .path("/node/config/regenerate-secret")
    .input((b) => b.body(z.object({}).optional()))
    .output((b) => b.body(meshNodeConfigRegenerateSecretResultSchema))
    .build();

export const meshTestNodeConfigDbContract = meshNodeConfigTestDbOps
    .create()
    .path("/node/config/test-db")
    .input((b) => b.body(meshNodeConfigTestDbInputSchema))
    .output((b) => b.body(meshNodeConfigTestDbResultSchema))
    .build();

export const meshContract = oc.tag("Core Mesh").prefix("/mesh").router({
    ping: meshPingContract,
    getLocalNode: meshGetLocalNodeContract,
    getNodeMetrics: meshGetNodeMetricsContract,
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
    registerNode: meshRegisterNodeContract,
    revokeJoinGrant: meshRevokeJoinGrantContract,
    trustKeyringStatus: meshTrustKeyringStatusContract,
    trustKeyringSecrets: meshTrustKeyringSecretsContract,
    trustKeyringRotate: meshTrustKeyringRotateContract,
    trustKeyringConvergenceStatus: meshTrustKeyringConvergenceStatusContract,
    trustStrictReadiness: meshTrustStrictReadinessContract,
    trustStrictModeSet: meshTrustStrictModeSetContract,
    trustStrictRolloutPlan: meshTrustStrictRolloutPlanContract,
    trustStrictRollback: meshTrustStrictRollbackContract,
    getNodeConfig: meshGetNodeConfigContract,
    updateNodeConfig: meshUpdateNodeConfigContract,
    regenerateNodeConfigSecret: meshRegenerateNodeConfigSecretContract,
    testNodeConfigDb: meshTestNodeConfigDbContract,
});

export type MeshContract = typeof meshContract;
