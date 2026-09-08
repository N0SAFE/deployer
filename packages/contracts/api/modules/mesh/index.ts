export * from "./resource";

import z from "zod/v4";
import { oc } from "@orpc/contract";
import {
    createFilterConfig,
    error,
    meshDomainErrorContracts,
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

// Reuse the CANONICAL event-stream list config from the events module — the
// mesh surface exposes the same streams, and re-declaring the config here
// created a structurally-identical but nominally-distinct input type (the
// mesh controller passes `input.query` straight into CoreEventSyncService,
// which expects CoreEventStreamListInput).
import { coreEventStreamListConfigSchemas as meshEventStreamListConfigSchemas } from "../events";

export type MeshEventStreamListInput = ComputeInputSchema<typeof meshEventStreamListConfigSchemas>;

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
    .input(z.object({}))
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
    .input(z.object({}))
    .output(meshPingResultSchema)
    .build();

export const meshGetNodeMetricsContract = meshSystemMetricsOps
    .list()
    .path("/node/metrics")
    .input(z.object({}))
    .output(systemMetricsSnapshotSchema)
    .build();

export const meshListPeersContract = meshPeersListOps
    .list()
    .path("/peers")
    .input(z.object({}))
    .output(meshPeersListResultSchema)
    .build();

export const meshListPeerSessionsContract = meshPeerSessionsListOps
    .list()
    .path("/peers/sessions")
    .input(z.object({}))
    .output(meshPeerSessionsListResultSchema)
    .build();

export const meshListEventStreamsContract = meshEventStreamOps.list(meshEventStreamListConfigSchemas).build();

export const meshFindEventStreamByIdContract = meshEventStreamByIdOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/streams/${p("id", z.uuid())}`))
    .output(coreEventStreamDefinitionSchema)
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
    .output(meshStreamRoutePlanResultSchema)
    .build();

export const meshConnectPeerContract = meshPeerConnectOps
    .create()
    .path("/peers/connect")
    .input((b) => b.body(meshPeerConnectInputSchema))
    .output(meshPeerConnectResultSchema)
    .build();

export const meshDisconnectPeerContract = meshPeerDisconnectOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/peers/${p("sessionId", z.uuid())}/disconnect`)
            .body(meshPeerDisconnectInputSchema),
    )
    .output(meshPeerDisconnectResultSchema)
    .build();

export const meshPeerHeartbeatContract = meshPeerHeartbeatOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/peers/${p("sessionId", z.uuid())}/heartbeat`)
            .body(meshPeerHeartbeatInputSchema),
    )
    .output(meshPeerHeartbeatResultSchema)
    .build();

export const meshMembershipSnapshotContract = meshMembershipSnapshotOps
    .list()
    .path("/membership/snapshot")
    .input(z.object({}))
    .output(meshMembershipSnapshotSchema)
    .build();

export const meshMembershipReconcileContract = meshMembershipReconcileOps
    .create()
    .path("/membership/reconcile")
    .input((b) => b.body(meshMembershipReconcileInputSchema))
    .output(meshMembershipReconcileResultSchema)
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
    .output(meshControlEnvelopePublishResultSchema)
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
    .output(meshResourceLookupResultSchema)
    .build();

export const meshUpsertResourceIndexContract = meshResourceIndexUpsertOps
    .create()
    .path("/index/upsert")
    .input((b) => b.body(meshResourceIndexUpsertInputSchema))
    .output(meshResourceIndexUpsertResultSchema)
    .build();

export const meshPlanQueuePartitionContract = meshQueuePartitionPlanOps
    .create()
    .path("/queue/partitions/plan")
    .input((b) => b.body(meshQueuePartitionPlanInputSchema))
    .output(meshQueuePartitionPlanResultSchema)
    .build();

export const meshIssueJoinGrantContract = meshJoinGrantIssueOps
    .create()
    .path("/enrollment/grants/issue")
    .input((b) => b.body(meshJoinGrantIssueInputSchema))
    .output((b) => meshJoinGrantIssueResultSchema)
    .build();

export const meshConsumeJoinGrantContract = meshJoinGrantConsumeOps
    .create()
    .path("/enrollment/grants/consume")
    .input((b) => b.body(meshJoinGrantConsumeInputSchema))
    .output((b) => meshJoinGrantConsumeResultSchema)
    .errors((e) => [
        // The bootstrap handoff throws MeshNotFoundError when the grant
        // has been revoked / already used / never existed. The HTTP
        // exception filter turns this into 404 + MeshDomainErrorPayload
        // automatically — declaring it here gives the typed client a
        // typed catch path.
        ...meshDomainErrorContracts(e),
    ])
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
    .errors((e) => [
        // Throws MeshNotFoundError (when the grant id doesn't exist) and
        // MeshAuthorizationError (when the caller isn't super-admin).
        ...meshDomainErrorContracts(e),
    ])
    .build();

export const meshTrustKeyringStatusContract = meshTrustKeyringStatusOps
    .list()
    .path("/trust/keyring")
    .input(z.object({}))
    .output(meshTrustKeyringStatusResultSchema)
    .build();

export const meshTrustKeyringSecretsContract = meshTrustKeyringSecretsOps
    .list()
    .path("/trust/keyring/secrets")
    .input(z.object({}))
    .output(meshTrustKeyringSecretsResultSchema)
    .build();

export const meshTrustKeyringRotateContract = meshTrustKeyringRotateOps
    .create()
    .path("/trust/keyring/rotate")
    .input((b) => b.body(meshTrustKeyringRotateInputSchema))
    .output(meshTrustKeyringRotateResultSchema)
    .build();

export const meshTrustKeyringConvergenceStatusContract = meshTrustKeyringConvergenceStatusOps
    .list()
    .path("/trust/keyring/convergence")
    .input(z.object({}))
    .output(meshTrustKeyringConvergenceStatusResultSchema)
    .build();

export const meshTrustStrictReadinessContract = meshTrustStrictReadinessOps
    .list()
    .path("/trust/strict/readiness")
    .input(z.object({}))
    .output(meshTrustStrictReadinessResultSchema)
    .build();

export const meshTrustStrictModeSetContract = meshTrustStrictModeSetOps
    .create()
    .path("/trust/strict/mode")
    .input((b) => b.body(meshTrustStrictModeSetInputSchema))
    .output(meshTrustStrictModeSetResultSchema)
    .build();

export const meshTrustStrictRolloutPlanContract = meshTrustStrictRolloutPlanOps
    .list()
    .path("/trust/strict/rollout-plan")
    .input((b) => b.query(meshTrustStrictRolloutPlanQuerySchema))
    .output(meshTrustStrictRolloutPlanResultSchema)
    .build();

export const meshTrustStrictRollbackContract = meshTrustStrictRollbackOps
    .create()
    .path("/trust/strict/rollback")
    .input((b) => b.body(meshTrustStrictRollbackInputSchema))
    .output(meshTrustStrictRollbackResultSchema)
    .build();

export const meshGetNodeConfigContract = meshNodeConfigOps
    .list()
    .path("/node/config")
    .input((b) => b.body(z.object({}).optional()))
    .output(meshNodeConfigSchema)
    .build();

export const meshUpdateNodeConfigContract = meshNodeConfigUpdateOps
    .create()
    .path("/node/config")
    .input((b) => b.body(meshNodeConfigUpdateInputSchema))
    .output(meshNodeConfigUpdateResultSchema)
    .build();

export const meshRegenerateNodeConfigSecretContract = meshNodeConfigRegenerateSecretOps
    .create()
    .path("/node/config/regenerate-secret")
    .input((b) => b.body(z.object({}).optional()))
    .output(meshNodeConfigRegenerateSecretResultSchema)
    .build();

export const meshTestNodeConfigDbContract = meshNodeConfigTestDbOps
    .create()
    .path("/node/config/test-db")
    .input((b) => b.body(meshNodeConfigTestDbInputSchema))
    .output(meshNodeConfigTestDbResultSchema)
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
    lookupResource: meshLookupResourceContract,
    upsertResourceIndex: meshUpsertResourceIndexContract,
    issueJoinGrant: meshIssueJoinGrantContract,
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

/**
 * `meshInternalContract` (PRIVATE) — mesh-to-mesh transport surface.
 *
 * These endpoints are ONLY callable inside the mesh (peer service token /
 * internal key via `requireMesh()`), never by dashboard users. They are
 * deliberately NOT part of `appContract` (see `packages/contracts/api/index.ts`)
 * and NOT reachable through the public web client. The mesh-to-mesh client in
 * `mesh-initialization.service.ts` merges this router with `meshContract` to
 * get one typed client for the whole mesh API.
 */
export const meshInternalContract = oc.tag("Core Mesh Internal").prefix("/mesh").router({
    publishControlEnvelope: meshControlEnvelopePublishContract,
    streamSession: meshSessionStreamContract,
    planQueuePartition: meshPlanQueuePartitionContract,
    registerNode: meshRegisterNodeContract,
    consumeJoinGrant: meshConsumeJoinGrantContract,
});

export type MeshInternalContract = typeof meshInternalContract;
