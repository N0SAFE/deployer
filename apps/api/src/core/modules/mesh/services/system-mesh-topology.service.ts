import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Observable } from "rxjs";
import { filter, map } from "rxjs/operators";
import { asyncIterableToObservable, observableToAsyncIterable } from "@/core/utils/observable.utils";
import { EnvService } from "@/config/env/env.service";
import {
    meshDuplexStreamInputSchema,
    meshMembershipReconcileInputSchema,
    meshMembershipSnapshotSchema,
    meshPeerSessionSchema,
    meshNodeStateSchema,
    meshPeerConnectionSchema,
    type MeshControlEnvelope,
    type MeshResourceIndexUpsertInput,
    type MeshResourceIndexUpsertResult,
    type MeshResourceKind,
    type MeshResourceLocation,
    type MeshResourceLookupInput,
    type MeshResourceLookupResult,
    type MeshDuplexStreamInput,
    type MeshDuplexStreamOutput,
    type MeshMembershipReconcileInput,
    type MeshMembershipReconcileResult,
    type MeshMembershipSnapshot,
    type MeshPeerConnectInput,
    type MeshPeerConnectResult,
    type MeshPeerDisconnectInput,
    type MeshPeerDisconnectResult,
    type MeshPeerHeartbeatInput,
    type MeshPeerHeartbeatResult,
    type MeshPeerSession,
    type MeshNodeState,
    type MeshPeerConnection,
    type MeshRuntimeEvent,
    type MeshTopologyEvent,
    type MeshQueuePartitionPlanInput,
    type MeshQueuePartitionPlanResult,
    type MeshQueueTransitionAppendInput,
    type MeshQueueTransitionAppendResult,
    type MeshQueueTransitionApplyInput,
    type MeshQueueTransitionApplyResult,
    type MeshQueueTransitionListInput,
    type MeshQueueTransitionListResult,
    type MeshQueueTransitionLogEntry,
    type MeshQueueTransitionPayload,
    meshQueueTransitionLogEntrySchema,
} from "@repo/api-contracts/common/mesh";
import { SystemMeshEventService } from "../events/system-mesh-event.service";
import { SystemMeshClusterRepository } from "../repositories/system-mesh-cluster.repository";
import { SystemMeshLogicService } from "./system-mesh-logic.service";
import { SystemMeshOverlayScopeService } from "./system-mesh-overlay-scope.service";
import { MeshPartitionPolicy, type PartitionPolicyResult } from "./mesh-partition-policy";

interface TopologyStreamInput {
    organizationId?: string | null;
    replay: boolean;
    replayLimit: number;
    includeEdges: boolean;
    includeNodes: boolean;
}

interface MeshStreamRoutePlanInput {
    organizationId?: string | null;
    streamId: string;
    desiredBranches: number;
    includeCandidates: boolean;
}

interface MeshJoinGrantIssueInput {
    organizationId?: string | null;
    targetNodeId?: string | null;
    ttlSeconds: number;
    issuedByUserId: string;
    issuedByRole?: string | null;
    metadata?: Record<string, unknown> | null;
}

interface MeshJoinGrantIssueResult {
    grantId: string;
    clusterId: string;
    grantToken: string;
    expiresAt: string;
    status: "issued";
}

interface MeshJoinGrantConsumeInput {
    grantToken: string;
    nodeId: string;
    serverUrl: string;
    displayName?: string;
    capabilities?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
}

interface MeshJoinGrantConsumeResult {
    accepted: boolean;
    grantId: string;
    clusterId: string;
    nodeId: string;
    enrolledAt: string;
}

interface MeshJoinGrantRevokeInput {
    grantId: string;
    reason?: string | null;
    revokedByUserId: string;
    revokedByRole?: string | null;
}

interface MeshJoinGrantRevokeResult {
    revoked: boolean;
    grantId: string;
    clusterId: string;
    status: "revoked";
    revokedAt: string;
}

interface MeshTrustKeyInfo {
    keyId: string;
    algorithm: "HS256";
    status: "active" | "previous";
}

interface MeshTrustKeyringStatusResult {
    activeKeyId: string | null;
    keys: MeshTrustKeyInfo[];
}

interface MeshTrustKeyringSecretsResult {
    activeKeyId: string | null;
    keys: {
        keyId: string;
        algorithm: "HS256";
        status: "active" | "previous";
        secretMaterial: string;
    }[];
}

interface MeshTrustKeyringRotateInput {
    keyId?: string;
    secretMaterial?: string;
    expiresAt?: string | null;
    rotatedByRole?: string | null;
}

interface MeshTrustKeyringRotateResult {
    activeKeyId: string;
    rotatedKeyId: string;
    secretMaterial: string;
    keys: MeshTrustKeyInfo[];
}

interface MeshTrustKeyringConvergenceStatusResult {
    activeKeyId: string | null;
    converged: boolean;
    expectedAcks: number;
    receivedAcks: number;
    pendingNodeIds: string[];
    lastRotatedAt: string | null;
}

interface MeshTrustStrictReadinessResult {
    ready: boolean;
    strictConfigured: boolean;
    strictEnforced: boolean;
    activeKeyId: string | null;
    converged: boolean;
    expectedAcks: number;
    receivedAcks: number;
    ackRatio: number;
    minAckRatio: number;
    maxAckAgeSeconds: number;
    lastRotationAgeSeconds: number | null;
    rollbackRecommended: boolean;
    rollbackTriggers: string[];
    reasons: string[];
}

interface MeshTrustStrictModeSetInput {
    enabled: boolean;
    setByRole?: string | null;
}

interface MeshTrustStrictModeSetResult extends MeshTrustStrictReadinessResult {
    requested: boolean;
}

interface MeshTrustStrictRollbackInput {
    force?: boolean;
    reason?: string;
    setByRole?: string | null;
}

interface MeshTrustStrictRollbackResult extends MeshTrustStrictReadinessResult {
    requested: boolean;
    rolledBack: boolean;
}

interface MeshTrustStrictRolloutPlanInput {
    waveSize?: number;
}

interface MeshTrustStrictRolloutPlanResult {
    activeKeyId: string | null;
    strictConfigured: boolean;
    strictEnforced: boolean;
    waveSize: number;
    ackedNodeIds: string[];
    pendingNodeIds: string[];
    waves: { index: number; nodeIds: string[] }[];
    rollbackRecommended: boolean;
    rollbackTriggers: string[];
}

interface MeshStreamRoutePlanBranch {
    ownerNodeId: string;
    ownerServerUrl: string;
    endpointPath: string;
    protocol: "http" | "https" | "ws" | "wss" | "sse";
    priority: number;
    estimatedWeight: number;
}

interface MeshStreamRoutePlanResult {
    streamId: string;
    selected: MeshStreamRoutePlanBranch[];
    candidates: MeshStreamRoutePlanBranch[];
}

interface QueuePartitionCandidate {
    nodeId: string;
    ownerServerUrl: string | null;
    role: "edge" | "relay" | "partition-owner" | "observer";
    local: boolean;
}

interface QueueTransitionApplyState {
    applied: boolean;
    duplicate: boolean;
    reason: string | null;
    entry: MeshQueueTransitionLogEntry;
}

type RuntimeReason =
    | "bootstrap"
    | "session_connected"
    | "session_disconnected"
    | "session_heartbeat"
    | "membership_reconciled"
    | "topology_event"
    | "control_envelope";

@Injectable()
export class SystemMeshTopologyService implements OnModuleInit {
    private readonly logger = new Logger(SystemMeshTopologyService.name);
    private readonly controlEnvelopeHandlers = new Set<(envelope: MeshControlEnvelope) => void>();
    private readonly localNode: MeshNodeState;
    private readonly remoteNodes = new Map<string, MeshNodeState>();
    private readonly peerConnections = new Map<string, MeshPeerConnection>();
    private readonly peerSessions = new Map<string, MeshPeerSession>();
    private readonly activeSessionByPeerNodeId = new Map<string, string>();
    private readonly activeSessionByEndpointUrl = new Map<string, string>();
    private readonly topologyEvents: MeshTopologyEvent[] = [];
    private readonly resourceIndex = new Map<string, MeshResourceLocation[]>();
    private readonly queueTransitionLog: MeshQueueTransitionLogEntry[] = [];
    private readonly queueTransitionByIdempotencyKey = new Map<string, MeshQueueTransitionLogEntry>();
    private readonly queueTransitionBySourceAndTransitionId = new Map<string, MeshQueueTransitionLogEntry>();
    private readonly queueTransitionSequenceByNode = new Map<string, number>();
    private readonly topologyHistoryLimit = 5_000;
    private readonly trustKeys = new Map<string, { keyId: string; algorithm: "HS256"; secret: string; status: "active" | "previous" }>();
    private readonly trustKeyAcksByKeyId = new Map<string, Set<string>>();
    private readonly trustKeyExpectedPeersByKeyId = new Map<string, Set<string>>();
    private readonly trustKeyLastRotatedAt = new Map<string, string>();
    private strictTrustModeRequested = false;
    private activeTrustKeyId: string | null = null;
    private membershipVersion = 1;

    private env(): EnvService {
        return new EnvService();
    }

    private resolveUuidFromEnv(envName: "MESH_NODE_ID" | "MESH_CLUSTER_ID"): string {
        const value = this.env().get(envName);
        if (!value) {
            return randomUUID();
        }

        const trimmed = String(value).trim();
        const uuidLikeRegex =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

        return uuidLikeRegex.test(trimmed) ? trimmed : randomUUID();
    }

    constructor(
        private readonly meshEventService: SystemMeshEventService,
        private readonly meshLogicService: SystemMeshLogicService,
        private readonly meshOverlayScopeService: SystemMeshOverlayScopeService,
        @Optional()
        private readonly clusterRepository?: SystemMeshClusterRepository,
    ) {
        const now = new Date().toISOString();
        const configuredNodeId = this.resolveUuidFromEnv("MESH_NODE_ID");
        const configuredClusterId = this.resolveUuidFromEnv("MESH_CLUSTER_ID");
        this.localNode = meshNodeStateSchema.parse({
            nodeId: configuredNodeId,
            clusterId: configuredClusterId,
            region: "auto",
            roles: ["edge"],
            lifecycleState: "healthy",
            routingMode: "balanced",
            consistencyMode: "hybrid",
            version: "v3-mesh-alpha",
            startedAt: now,
            lastSeenAt: now,
            metadata: null,
        });

        this.recordTopologyEvent({
            type: "node_upserted",
            node: this.localNode,
            timestamp: now,
        });

        this.loadEnvTrustKey();

        this.emitRuntimeState("bootstrap", null);
    }

    async onModuleInit(): Promise<void> {
        if (this.clusterRepository && "loadSigningKeys" in this.clusterRepository) {
            try {
                const keys = await this.clusterRepository.loadSigningKeys();
                for (const key of keys) {
                    this.trustKeys.set(key.keyId, {
                        keyId: key.keyId,
                        algorithm: key.algorithm,
                        secret: key.secretMaterial,
                        status: key.status,
                    });

                    if (key.status === "active") {
                        this.activeTrustKeyId = key.keyId;
                    }
                }
            } catch (error) {
                this.logger.warn(
                    `Failed to hydrate mesh signing keys from database: ${
                        error instanceof Error ? error.message : "unknown error"
                    }`,
                );
            }
        }

        if (!this.clusterRepository) {
            return;
        }

        try {
            const locations = await this.clusterRepository.loadAllResourceLocations();
            for (const location of locations) {
                const key = this.resourceIndexKey(location.kind, location.key, location.organizationId ?? null);
                const existing = this.resourceIndex.get(key) ?? [];
                existing.push(location);
                this.resourceIndex.set(key, this.meshLogicService.rankResourceLocations(existing));
            }

            if (locations.length > 0) {
                this.logger.log(`Hydrated ${String(locations.length)} mesh resource ownership entries from database`);
            }
        } catch (error) {
            this.logger.warn(
                `Failed to hydrate mesh resource ownership from database: ${
                    error instanceof Error ? error.message : "unknown error"
                }`,
            );
        }
    }

    getLocalNode(): MeshNodeState {
        return this.localNode;
    }

    listPeers(): { items: MeshPeerConnection[] } {
        const ranked = [...this.peerConnections.values()]
            .sort((left, right) => left.metrics.weight - right.metrics.weight)
            .map((connection, index) => ({
                ...connection,
                activePathRank: index + 1,
            }));

        return { items: ranked };
    }

    listPeerSessions(): { items: MeshPeerSession[] } {
        return {
            items: [...this.peerSessions.values()].sort((left, right) => {
                const leftTime = left.connectedAt ?? left.disconnectedAt ?? "";
                const rightTime = right.connectedAt ?? right.disconnectedAt ?? "";
                return rightTime.localeCompare(leftTime);
            }),
        };
    }

    getMembershipSnapshot(input?: { organizationId?: string | null }): MeshMembershipSnapshot {
        const snapshot: MeshMembershipSnapshot = {
            version: this.membershipVersion,
            generatedAt: new Date().toISOString(),
            localNode: this.localNode,
            nodes: [...this.remoteNodes.values()],
            connections: [...this.peerConnections.values()],
            sessions: [...this.peerSessions.values()],
        };

        const organizationId = input?.organizationId ?? null;
        if (!organizationId) {
            return snapshot;
        }

        return this.meshOverlayScopeService.scopeMembershipSnapshotByOrganization(snapshot, organizationId, {
            fallbackToUnscoped: false,
        });
    }

    getRealtimeState() {
        const snapshot = this.getMembershipSnapshot();
        return {
            localNode: this.getLocalNode(),
            peers: this.listPeers().items,
            sessions: this.listPeerSessions().items,
            snapshot,
            timestamp: new Date().toISOString(),
        };
    }

    streamRuntimeEvents(input: { organizationId?: string | null; replay: boolean; replayLimit: number }) {
        return observableToAsyncIterable(this.observeRuntimeEvents(input));
    }

    observeRuntimeEvents(input: { organizationId?: string | null; replay: boolean; replayLimit: number }): Observable<MeshRuntimeEvent> {
        const source = this.meshEventService.observeRuntime({
            clusterId: this.localNode.clusterId,
            replay: input.replay,
            replayLimit: input.replayLimit,
        });

        const organizationId = input.organizationId ?? null;
        if (!organizationId) {
            return source;
        }

        if (!this.meshOverlayScopeService.hasScopedNodes(organizationId)) {
            return source;
        }

        return source.pipe(
            map((event) => this.meshOverlayScopeService.filterRuntimeEventByOrganization(event, organizationId)),
        );
    }

    /**
     * T106 — Cursor-based event stream replication.
     *
     * Returns all runtime events buffered after the given sequence cursor, then
     * continues as a live stream.  Subscribers persist the last `cursor` value
     * they receive and supply it on reconnect so no events are replayed twice.
     */
    streamRuntimeEventsSince(input: { cursor: number; organizationId?: string | null }) {
        return observableToAsyncIterable(this.observeRuntimeEventsSince(input));
    }

    observeRuntimeEventsSince(input: { cursor: number; organizationId?: string | null }): Observable<MeshRuntimeEvent> {
        const source = this.meshEventService.observeRuntimeSince({
            clusterId: this.localNode.clusterId,
            afterSequence: input.cursor,
        });

        const organizationId = input.organizationId ?? null;
        if (!organizationId) {
            return source;
        }

        if (!this.meshOverlayScopeService.hasScopedNodes(organizationId)) {
            return source;
        }

        return source.pipe(
            map((event) => this.meshOverlayScopeService.filterRuntimeEventByOrganization(event, organizationId)),
        );
    }

    /** Returns the current sequence cursor for the runtime event stream of this node's cluster. */
    getRuntimeEventCursor(): number {
        return this.meshEventService.runtimeLastSequence(this.localNode.clusterId);
    }

    /**
     * T107 — Partition/failover policy status.
     *
     * Evaluates the effective availability of this node using the configured
     * consistency mode (AP / CP / hybrid), the number of currently connected
     * peer sessions, and the cluster quorum target.
     *
     * Consumers should check `canWrite` before performing write-path operations
     * when running in CP or hybrid mode, and expose `effectiveLifecycleState`
     * upstream for health checks.
     */
    getPartitionStatus(): PartitionPolicyResult {
        const activePeerCount = [...this.peerSessions.values()].filter(
            (s) => s.state === "connected",
        ).length;

        return MeshPartitionPolicy.evaluate({
            consistencyMode: this.localNode.consistencyMode,
            activePeerCount,
            quorumSize: MeshPartitionPolicy.getConfiguredQuorumSize(),
        });
    }

    lookupResource(input: MeshResourceLookupInput): MeshResourceLookupResult {
        const indexKey = this.resourceIndexKey(input.kind, input.key, input.organizationId ?? null);
        const entries = (this.resourceIndex.get(indexKey) ?? []).slice();
        const ranked = this.meshLogicService.rankResourceLocations(entries);
        const candidates = input.includeCandidates ? ranked : ranked.slice(0, 1);

        return {
            found: ranked.length > 0,
            query: input,
            primary: ranked[0] ?? null,
            candidates,
        };
    }

    upsertResourceIndex(input: MeshResourceIndexUpsertInput): MeshResourceIndexUpsertResult {
        let replaced = 0;
        let upserted = 0;
        const upsertOrgScope = input.organizationId ?? null;

        if (input.replaceExistingForSource) {
            for (const [indexKey, existing] of this.resourceIndex.entries()) {
                const retained = existing.filter((resource) => {
                    if (resource.ownerNodeId !== input.sourceNodeId) {
                        return true;
                    }

                    if (upsertOrgScope === null) {
                        return false;
                    }

                    return (resource.organizationId ?? null) !== upsertOrgScope;
                });
                replaced += existing.length - retained.length;
                if (retained.length === 0) {
                    this.resourceIndex.delete(indexKey);
                } else {
                    this.resourceIndex.set(indexKey, retained);
                }
            }
        }

        for (const resource of input.resources) {
            const resourceOrgScope = resource.organizationId ?? upsertOrgScope;
            const normalizedResource: MeshResourceLocation = {
                ...resource,
                organizationId: resourceOrgScope,
            };

            const indexKey = this.resourceIndexKey(normalizedResource.kind, normalizedResource.key, resourceOrgScope);
            const existing = this.resourceIndex.get(indexKey) ?? [];
            const deduped = existing.filter(
                (current) =>
                    !(
                        current.ownerNodeId === normalizedResource.ownerNodeId &&
                        current.ownerServerUrl === normalizedResource.ownerServerUrl &&
                        current.endpointPath === normalizedResource.endpointPath &&
                        current.protocol === normalizedResource.protocol &&
                        (current.organizationId ?? null) === (normalizedResource.organizationId ?? null)
                    ),
            );

            if (deduped.length !== existing.length) {
                replaced += existing.length - deduped.length;
            }

            deduped.push(normalizedResource);
            this.resourceIndex.set(indexKey, this.meshLogicService.rankResourceLocations(deduped));
            upserted += 1;
        }

        if (this.clusterRepository) {
            void this.clusterRepository.persistResourceIndexUpsert(input).catch((error: unknown) => {
                this.logger.warn(
                    `Failed to persist mesh resource ownership upsert: ${
                        error instanceof Error ? error.message : "unknown error"
                    }`,
                );
            });
        }

        return {
            accepted: true,
            sourceNodeId: input.sourceNodeId,
            upserted,
            replaced,
        };
    }

    planStreamRoute(input: MeshStreamRoutePlanInput): MeshStreamRoutePlanResult {
        const lookup = this.lookupResource({
            organizationId: input.organizationId ?? null,
            kind: "stream",
            key: `stream:${input.streamId}`,
            includeCandidates: true,
        });

        const weighted = this.meshOverlayScopeService.filterCandidatesByOrganization(
            lookup.candidates,
            input.organizationId ?? null,
        ).map((candidate) => {
            const edge = [...this.peerConnections.values()].find(
                (connection) => connection.targetNodeId === candidate.ownerNodeId,
            );

            const estimatedWeight = edge?.metrics.weight ?? 1;

            return {
                ownerNodeId: candidate.ownerNodeId,
                ownerServerUrl: candidate.ownerServerUrl,
                endpointPath: candidate.endpointPath,
                protocol: candidate.protocol,
                priority: candidate.priority,
                estimatedWeight,
            } satisfies MeshStreamRoutePlanBranch;
        });

        const candidates = weighted.sort((left, right) => {
            if (left.estimatedWeight !== right.estimatedWeight) {
                return left.estimatedWeight - right.estimatedWeight;
            }

            if (left.priority !== right.priority) {
                return left.priority - right.priority;
            }

            return left.ownerNodeId.localeCompare(right.ownerNodeId);
        });

        const selected = candidates.slice(0, Math.max(1, input.desiredBranches));

        return {
            streamId: input.streamId,
            selected,
            candidates: input.includeCandidates ? candidates : selected,
        };
    }

    planQueuePartitionOwnership(input: MeshQueuePartitionPlanInput): MeshQueuePartitionPlanResult {
        const nowIso = new Date().toISOString();
        const organizationId = input.organizationId ?? null;
        const candidates = this.buildQueuePartitionCandidates(organizationId);

        const rankedCandidates = candidates
            .map((candidate) => ({
                ...candidate,
                score: this.computeQueuePartitionRendezvousScore(input.queue, input.partitionKey, candidate.nodeId),
            }))
            .sort((left, right) => {
                if (left.score !== right.score) {
                    return right.score - left.score;
                }
                return left.nodeId.localeCompare(right.nodeId);
            });

        const selected = rankedCandidates[0];
        if (!selected) {
            const localNodeId = this.localNode.nodeId;
            return {
                queue: input.queue,
                partitionKey: input.partitionKey,
                ownerNodeId: localNodeId,
                ownerServerUrl: this.resolveNodeServerUrl(localNodeId),
                forwardingRequired: false,
                forwardedToNodeId: null,
                leaseHandoff: false,
                selectedAt: nowIso,
                candidates: [],
            };
        }

        const leaseHolderNodeId = input.leaseHolderNodeId ?? null;
        const leaseActive = this.isLeaseActive(input.leaseExpiresAt ?? null, nowIso);
        const leaseHolderEligible = leaseHolderNodeId
            ? rankedCandidates.some((candidate) => candidate.nodeId === leaseHolderNodeId)
            : false;

        const ownerNodeId: string = leaseActive && leaseHolderEligible && leaseHolderNodeId
            ? leaseHolderNodeId
            : selected.nodeId;

        const forwardingRequired = ownerNodeId !== this.localNode.nodeId;
        const leaseHandoff = Boolean(leaseHolderNodeId) && ownerNodeId !== leaseHolderNodeId;

        return {
            queue: input.queue,
            partitionKey: input.partitionKey,
            ownerNodeId,
            ownerServerUrl: this.resolveNodeServerUrl(ownerNodeId),
            forwardingRequired,
            forwardedToNodeId: forwardingRequired ? ownerNodeId : null,
            leaseHandoff,
            selectedAt: nowIso,
            candidates: input.includeCandidates
                ? rankedCandidates
                : rankedCandidates.filter((candidate) => candidate.nodeId === ownerNodeId),
        };
    }

    async issueJoinGrant(input: MeshJoinGrantIssueInput): Promise<MeshJoinGrantIssueResult> {
        if (!this.clusterRepository) {
            throw new BadRequestException("Mesh cluster repository is required to issue bootstrap join grants");
        }

        if (!this.isSuperAdminRole(input.issuedByRole)) {
            throw new BadRequestException("Only super-admin can issue bootstrap join grants");
        }

        const issued = await this.clusterRepository.issueJoinGrant({
            organizationId: input.organizationId ?? null,
            targetNodeId: input.targetNodeId ?? null,
            issuedByUserId: input.issuedByUserId,
            ttlSeconds: input.ttlSeconds,
            metadata: input.metadata ?? null,
        });

        return {
            grantId: issued.grantId,
            clusterId: issued.clusterId,
            grantToken: issued.grantToken,
            expiresAt: issued.expiresAt,
            status: "issued",
        };
    }

    async consumeJoinGrant(input: MeshJoinGrantConsumeInput): Promise<MeshJoinGrantConsumeResult> {
        if (!this.clusterRepository) {
            throw new BadRequestException("Mesh cluster repository is required to consume bootstrap join grants");
        }

        const consumed = await this.clusterRepository.consumeJoinGrant(input);
        if (!consumed) {
            throw new NotFoundException("Join grant is invalid, expired, revoked, or already used");
        }

        return {
            accepted: true,
            grantId: consumed.grantId,
            clusterId: consumed.clusterId,
            nodeId: consumed.nodeId,
            enrolledAt: consumed.enrolledAt,
        };
    }

    async revokeJoinGrant(input: MeshJoinGrantRevokeInput): Promise<MeshJoinGrantRevokeResult> {
        if (!this.clusterRepository) {
            throw new BadRequestException("Mesh cluster repository is required to revoke bootstrap join grants");
        }

        if (!this.isSuperAdminRole(input.revokedByRole)) {
            throw new BadRequestException("Only super-admin can revoke bootstrap join grants");
        }

        const revoked = await this.clusterRepository.revokeJoinGrant({
            grantId: input.grantId,
            revokedByUserId: input.revokedByUserId,
            reason: input.reason ?? null,
        });

        if (!revoked) {
            throw new NotFoundException("Join grant not found or no longer revocable");
        }

        return {
            revoked: true,
            grantId: revoked.grantId,
            clusterId: revoked.clusterId,
            status: "revoked",
            revokedAt: revoked.revokedAt,
        };
    }

    getTrustKeyringStatus(): MeshTrustKeyringStatusResult {
        return {
            activeKeyId: this.activeTrustKeyId,
            keys: this.listTrustKeys(),
        };
    }

    getTrustKeyringSecrets(): MeshTrustKeyringSecretsResult {
        return {
            activeKeyId: this.activeTrustKeyId,
            keys: this.listTrustSecretKeys(),
        };
    }

    async rotateTrustKey(input: MeshTrustKeyringRotateInput): Promise<MeshTrustKeyringRotateResult> {
        if (!this.clusterRepository || !("rotateSigningKey" in this.clusterRepository)) {
            throw new BadRequestException("Mesh cluster repository is required to rotate trust keys");
        }

        if (!this.isSuperAdminRole(input.rotatedByRole)) {
            throw new BadRequestException("Only super-admin can rotate mesh trust keys");
        }

        const keyId = input.keyId?.trim() || `mesh-k-${Date.now()}`;
        const secretMaterial = input.secretMaterial?.trim() || `${randomUUID()}${randomUUID()}`;

        const rotated = await this.clusterRepository.rotateSigningKey({
            keyId,
            secretMaterial,
            expiresAt: input.expiresAt ?? null,
        });

        const snapshotKeys = this.clusterRepository.loadSigningKeys
            ? await this.clusterRepository.loadSigningKeys()
            : [];

        const payloadKeys = snapshotKeys.length > 0
            ? snapshotKeys
            : [{ keyId, algorithm: "HS256" as const, secretMaterial, status: "active" as const }];

        const expectedPeerNodeIds = this.resolveExpectedTrustAckPeers();
        this.trustKeyExpectedPeersByKeyId.set(rotated.activeKeyId, new Set(expectedPeerNodeIds));
        this.trustKeyAcksByKeyId.set(rotated.activeKeyId, new Set());
        this.trustKeyLastRotatedAt.set(rotated.activeKeyId, new Date().toISOString());

        this.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "trust_keyring_sync",
            sourceNodeId: this.localNode.nodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                activeKeyId: rotated.activeKeyId,
                keys: payloadKeys,
            },
        });

        return {
            activeKeyId: rotated.activeKeyId,
            rotatedKeyId: rotated.rotatedKeyId,
            secretMaterial: rotated.secretMaterial,
            keys: this.listTrustKeys(),
        };
    }

    getTrustKeyringConvergenceStatus(): MeshTrustKeyringConvergenceStatusResult {
        const activeKeyId = this.activeTrustKeyId;
        if (!activeKeyId) {
            return {
                activeKeyId: null,
                converged: true,
                expectedAcks: 0,
                receivedAcks: 0,
                pendingNodeIds: [],
                lastRotatedAt: null,
            };
        }

        const expected = this.trustKeyExpectedPeersByKeyId.get(activeKeyId) ?? new Set<string>();
        const acks = this.trustKeyAcksByKeyId.get(activeKeyId) ?? new Set<string>();
        const pendingNodeIds = [...expected].filter((nodeId) => !acks.has(nodeId)).sort();

        return {
            activeKeyId,
            converged: pendingNodeIds.length === 0,
            expectedAcks: expected.size,
            receivedAcks: acks.size,
            pendingNodeIds,
            lastRotatedAt: this.trustKeyLastRotatedAt.get(activeKeyId) ?? null,
        };
    }

    getTrustStrictReadiness(): MeshTrustStrictReadinessResult {
        const convergence = this.getTrustKeyringConvergenceStatus();
        const reasons: string[] = [];
        const strictConfigured = this.isStrictTrustConfigured();
        const minAckRatio = this.resolveTrustMinAckRatio();
        const maxAckAgeSeconds = this.resolveTrustMaxAckAgeSeconds();
        const ackRatio = convergence.expectedAcks > 0
            ? convergence.receivedAcks / convergence.expectedAcks
            : 1;
        const rotationAgeSeconds = this.resolveRotationAgeSeconds(convergence.lastRotatedAt);

        const hasActiveKey = convergence.activeKeyId !== null;
        const hasRemoteExpectation = convergence.expectedAcks > 0 || this.remoteNodes.size === 0;
        const ackRatioSatisfied = ackRatio >= minAckRatio;
        const staleConvergenceSloBreached =
            convergence.expectedAcks > 0 &&
            !ackRatioSatisfied &&
            rotationAgeSeconds !== null &&
            rotationAgeSeconds > maxAckAgeSeconds;

        if (!convergence.activeKeyId) {
            reasons.push("missing_active_signing_key");
        }

        if (!hasRemoteExpectation) {
            reasons.push("no_remote_peers_observed");
        }

        if (!ackRatioSatisfied) {
            reasons.push("insufficient_peer_ack_ratio");
        }

        if (convergence.expectedAcks > 0 && rotationAgeSeconds === null) {
            reasons.push("rotation_not_observed_for_active_key");
        }

        if (staleConvergenceSloBreached) {
            reasons.push("rotation_convergence_slo_breached");
        }

        const rollbackTriggerSet = new Set([
            "missing_active_signing_key",
            "rotation_not_observed_for_active_key",
            "rotation_convergence_slo_breached",
        ]);
        const rollbackTriggers = strictConfigured
            ? reasons.filter((reason) => rollbackTriggerSet.has(reason))
            : [];
        const rollbackRecommended = strictConfigured && rollbackTriggers.length > 0;

        return {
            ready: hasActiveKey && hasRemoteExpectation && ackRatioSatisfied && !staleConvergenceSloBreached,
            strictConfigured,
            strictEnforced: strictConfigured && hasActiveKey && hasRemoteExpectation && ackRatioSatisfied && !staleConvergenceSloBreached,
            activeKeyId: convergence.activeKeyId,
            converged: convergence.converged,
            expectedAcks: convergence.expectedAcks,
            receivedAcks: convergence.receivedAcks,
            ackRatio,
            minAckRatio,
            maxAckAgeSeconds,
            lastRotationAgeSeconds: rotationAgeSeconds,
            rollbackRecommended,
            rollbackTriggers,
            reasons,
        };
    }

    getTrustStrictRolloutPlan(input: MeshTrustStrictRolloutPlanInput): MeshTrustStrictRolloutPlanResult {
        const readiness = this.getTrustStrictReadiness();
        const convergence = this.getTrustKeyringConvergenceStatus();
        const waveSize = this.resolveTrustRolloutWaveSize(input.waveSize);

        const activeKeyId = convergence.activeKeyId;
        const expected = activeKeyId
            ? this.trustKeyExpectedPeersByKeyId.get(activeKeyId) ?? new Set<string>()
            : new Set<string>();
        const acks = activeKeyId
            ? this.trustKeyAcksByKeyId.get(activeKeyId) ?? new Set<string>()
            : new Set<string>();

        const ackedNodeIds = [...expected].filter((nodeId) => acks.has(nodeId)).sort();

        return {
            activeKeyId,
            strictConfigured: readiness.strictConfigured,
            strictEnforced: readiness.strictEnforced,
            waveSize,
            ackedNodeIds,
            pendingNodeIds: convergence.pendingNodeIds.slice(),
            waves: this.buildRolloutWaves(ackedNodeIds, waveSize),
            rollbackRecommended: readiness.rollbackRecommended,
            rollbackTriggers: readiness.rollbackTriggers,
        };
    }

    setTrustStrictMode(input: MeshTrustStrictModeSetInput): MeshTrustStrictModeSetResult {
        if (!this.isSuperAdminRole(input.setByRole)) {
            throw new BadRequestException("Only super-admin can set strict mesh trust mode");
        }

        if (!input.enabled && this.isStrictTrustPinnedFromEnv()) {
            throw new BadRequestException("Strict mesh trust mode is pinned by environment and cannot be disabled at runtime");
        }

        const readiness = this.getTrustStrictReadiness();
        if (input.enabled && !readiness.ready) {
            throw new BadRequestException("Strict mesh trust mode cannot be enabled before readiness convergence");
        }

        this.strictTrustModeRequested = input.enabled;

        this.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "trust_strict_mode_sync",
            sourceNodeId: this.localNode.nodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                enabled: input.enabled,
                setAt: new Date().toISOString(),
            },
        });

        const nextReadiness = this.getTrustStrictReadiness();
        return {
            requested: this.isStrictTrustConfigured(),
            ...nextReadiness,
        };
    }

    rollbackTrustStrictMode(input: MeshTrustStrictRollbackInput): MeshTrustStrictRollbackResult {
        if (!this.isSuperAdminRole(input.setByRole)) {
            throw new BadRequestException("Only super-admin can rollback strict mesh trust mode");
        }

        if (this.isStrictTrustPinnedFromEnv()) {
            throw new BadRequestException("Strict mesh trust mode is pinned by environment and cannot be rolled back at runtime");
        }

        const readiness = this.getTrustStrictReadiness();
        if (!input.force && !readiness.rollbackRecommended) {
            throw new BadRequestException("Strict mesh trust rollback requires active rollback recommendation or force=true");
        }

        const wasRequested = this.strictTrustModeRequested;
        this.strictTrustModeRequested = false;

        if (wasRequested) {
            this.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "trust_strict_mode_sync",
                sourceNodeId: this.localNode.nodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: new Date().toISOString(),
                payload: {
                    enabled: false,
                    setAt: new Date().toISOString(),
                    rollback: {
                        reason: input.reason ?? "operator_rollback",
                        triggers: readiness.rollbackTriggers,
                        forced: Boolean(input.force),
                    },
                },
            });
        }

        const nextReadiness = this.getTrustStrictReadiness();
        return {
            requested: this.isStrictTrustConfigured(),
            rolledBack: wasRequested,
            ...nextReadiness,
        };
    }

    appendQueueTransitionLog(input: MeshQueueTransitionAppendInput): MeshQueueTransitionAppendResult {
        const now = new Date().toISOString();
        const sourceNodeId = this.localNode.nodeId;
        const nextSequence = (this.queueTransitionSequenceByNode.get(sourceNodeId) ?? 0) + 1;

        const existing = this.queueTransitionByIdempotencyKey.get(input.idempotencyKey);
        if (existing) {
            return {
                appended: false,
                duplicate: true,
                reason: "duplicate_delivery",
                entry: existing,
            };
        }

        const payload: MeshQueueTransitionPayload = {
            transitionId: randomUUID(),
            queue: input.queue,
            partitionKey: input.partitionKey,
            jobId: input.jobId ?? null,
            fromStatus: input.fromStatus ?? null,
            toStatus: input.toStatus,
            workerId: input.workerId ?? null,
            idempotencyKey: input.idempotencyKey,
            occurredAt: input.occurredAt ?? now,
            metadata: input.metadata ?? null,
        };

        const payloadHash = this.computeQueueTransitionPayloadHash(payload);

        const entry: MeshQueueTransitionLogEntry = {
            organizationId: input.organizationId ?? null,
            sourceNodeId,
            sequence: nextSequence,
            payloadHash,
            payload,
            receivedAt: now,
        };

        const state = this.applyQueueTransitionEntry(entry);
        if (state.applied) {
            this.queueTransitionSequenceByNode.set(sourceNodeId, nextSequence);
        }

        return {
            appended: state.applied,
            duplicate: state.duplicate,
            reason: state.reason,
            entry: state.entry,
        };
    }

    applyReplicatedQueueTransitionLogEntry(input: MeshQueueTransitionApplyInput): MeshQueueTransitionApplyResult {
        const parsed = meshQueueTransitionLogEntrySchema.parse(input.entry);
        const state = this.applyQueueTransitionEntry(parsed);

        const currentSequence = this.queueTransitionSequenceByNode.get(parsed.sourceNodeId) ?? 0;
        if (state.applied && parsed.sequence > currentSequence) {
            this.queueTransitionSequenceByNode.set(parsed.sourceNodeId, parsed.sequence);
        }

        return {
            applied: state.applied,
            duplicate: state.duplicate,
            reason: state.reason,
            entry: state.entry,
        };
    }

    listQueueTransitionLogs(input: MeshQueueTransitionListInput): MeshQueueTransitionListResult {
        const filtered = this.queueTransitionLog
            .filter((entry) => !input.organizationId || (entry.organizationId ?? null) === input.organizationId)
            .filter((entry) => !input.queue || entry.payload.queue === input.queue)
            .filter((entry) => !input.partitionKey || entry.payload.partitionKey === input.partitionKey)
            .filter((entry) => !input.sourceNodeId || entry.sourceNodeId === input.sourceNodeId)
            .filter((entry) => input.fromSequence === undefined || entry.sequence >= input.fromSequence)
            .sort((left, right) => {
                if (left.receivedAt !== right.receivedAt) {
                    return left.receivedAt.localeCompare(right.receivedAt);
                }
                if (left.sourceNodeId !== right.sourceNodeId) {
                    return left.sourceNodeId.localeCompare(right.sourceNodeId);
                }
                return left.sequence - right.sequence;
            });

        const items = filtered.slice(0, input.limit);
        const hasMore = filtered.length > items.length;
        const nextFromSequence = hasMore && items.length > 0
            ? (items.at(-1)?.sequence ?? null)
            : null;

        return {
            items,
            total: filtered.length,
            nextFromSequence,
        };
    }

    streamSession(inputStream: AsyncIterable<MeshDuplexStreamInput>): AsyncIterable<MeshDuplexStreamOutput> {
        return observableToAsyncIterable(this.observeSession(asyncIterableToObservable(inputStream)));
    }

    observeSession(input$: Observable<MeshDuplexStreamInput>): Observable<MeshDuplexStreamOutput> {
        return new Observable<MeshDuplexStreamOutput>((subscriber) => {
            let activeSessionId: string | null = null;
            let seenFirstEvent = false;
            let terminated = false;

            const emit = (event: MeshDuplexStreamOutput) => {
                if (!subscriber.closed) {
                    subscriber.next(event);
                }
            };

            const terminate = () => {
                if (!terminated) {
                    terminated = true;
                    inputSubscription.unsubscribe();
                    if (!subscriber.closed) {
                        subscriber.complete();
                    }
                }
            };

            const cleanupSession = () => {
                if (activeSessionId) {
                    try {
                        this.disconnectPeer(activeSessionId, {
                            reason: "stream_closed",
                            allowReconnect: true,
                        });
                    } catch {
                        // Ignore cleanup failures during stream teardown.
                    }
                    activeSessionId = null;
                }
            };

            const inputSubscription = input$.subscribe({
                next: (inputEvent) => {
                    if (terminated || subscriber.closed) {
                        return;
                    }

                    if (!seenFirstEvent) {
                        seenFirstEvent = true;
                        const firstParsed = meshDuplexStreamInputSchema.safeParse(inputEvent);
                        if (!firstParsed.success || firstParsed.data.type !== "auth") {
                            emit({
                                type: "error",
                                code: "auth_required",
                                message: "First stream event must be an auth envelope",
                                retryable: false,
                            });
                            cleanupSession();
                            terminate();
                            return;
                        }

                        if (!this.isValidStreamCredential(firstParsed.data.credential)) {
                            emit({
                                type: "error",
                                code: "unauthorized",
                                message: "Invalid mesh stream credential",
                                retryable: false,
                            });
                            cleanupSession();
                            terminate();
                            return;
                        }

                        const connected = this.connectPeer({
                            endpointUrl: firstParsed.data.endpointUrl,
                            serverUrl: firstParsed.data.serverUrl,
                            resumeToken: firstParsed.data.resumeToken,
                            remoteAuthSession: firstParsed.data.remoteAuthSession,
                            metadata: firstParsed.data.metadata,
                        });
                        activeSessionId = connected.session.sessionId;

                        emit({
                            type: "auth_ok",
                            session: connected.session,
                            localNode: this.localNode,
                        });

                        emit({
                            type: "snapshot",
                            snapshot: this.getMembershipSnapshot(),
                        });

                        return;
                    }

                    const parsed = meshDuplexStreamInputSchema.safeParse(inputEvent);
                    if (!parsed.success) {
                        emit({
                            type: "error",
                            code: "invalid_event",
                            message: "Received invalid mesh stream event payload",
                            retryable: true,
                        });
                        return;
                    }

                    if (parsed.data.type === "auth") {
                        emit({
                            type: "error",
                            code: "invalid_sequence",
                            message: "Auth event can only be sent once at stream start",
                            retryable: false,
                        });
                        return;
                    }

                    try {
                        if (parsed.data.type === "ping") {
                            emit({
                                type: "pong",
                                nonce: parsed.data.nonce,
                                timestamp: new Date().toISOString(),
                            });
                            return;
                        }

                        if (parsed.data.type === "snapshot_request") {
                            emit({
                                type: "snapshot",
                                snapshot: this.getMembershipSnapshot(),
                            });
                            return;
                        }

                        if (parsed.data.type === "reconcile") {
                            const result = this.reconcileMembership(parsed.data.reconcile);
                            emit({
                                type: "reconcile_result",
                                result,
                            });
                            return;
                        }

                        if (parsed.data.type === "control") {
                            const scopedEnvelope = this.applySessionOrganizationScopeToEnvelope(
                                parsed.data.envelope,
                                activeSessionId,
                            );

                            if (!scopedEnvelope) {
                                emit({
                                    type: "error",
                                    code: "invalid_event",
                                    message: "Control envelope organization scope does not match stream session scope",
                                    retryable: false,
                                });
                                return;
                            }

                            const response = this.publishControlEnvelope(scopedEnvelope);
                            emit({
                                type: "control_ack",
                                accepted: response.accepted,
                                envelopeId: response.envelopeId,
                                forwardedTo: response.forwardedTo,
                            });
                            return;
                        }

                        if (parsed.data.type === "heartbeat") {
                            if (!activeSessionId) {
                                emit({
                                    type: "error",
                                    code: "invalid_sequence",
                                    message: "Cannot process heartbeat before auth",
                                    retryable: false,
                                });
                                return;
                            }

                            const heartbeat = this.heartbeatPeer(activeSessionId, {
                                peerNodeId: parsed.data.peerNodeId,
                                latencyMs: parsed.data.latencyMs,
                                jitterMs: parsed.data.jitterMs,
                                packetLossRatio: parsed.data.packetLossRatio,
                                throughputMbps: parsed.data.throughputMbps,
                                reliabilityScore: parsed.data.reliabilityScore,
                            });

                            emit({
                                type: "heartbeat_ack",
                                session: heartbeat.session,
                                connection: heartbeat.connection,
                            });
                            return;
                        }

                        if (parsed.data.type === "disconnect") {
                            if (!activeSessionId) {
                                emit({
                                    type: "error",
                                    code: "invalid_sequence",
                                    message: "Cannot disconnect before auth",
                                    retryable: false,
                                });
                                cleanupSession();
                                terminate();
                                return;
                            }

                            const disconnected = this.disconnectPeer(activeSessionId, {
                                reason: parsed.data.reason,
                                allowReconnect: parsed.data.allowReconnect,
                            });

                            emit({
                                type: "disconnected",
                                session: disconnected.session,
                            });
                            activeSessionId = null;
                            terminate();
                        }
                    } catch (error) {
                        emit({
                            type: "error",
                            code: "processing_error",
                            message: error instanceof Error ? error.message : "Failed to process mesh stream event",
                            retryable: true,
                        });
                    }
                },
                error: (error: unknown) => {
                    cleanupSession();
                    if (!subscriber.closed) {
                        subscriber.error(error);
                    }
                },
                complete: () => {
                    if (!seenFirstEvent) {
                        emit({
                            type: "error",
                            code: "auth_required",
                            message: "First stream event must be an auth envelope",
                            retryable: false,
                        });
                    }
                    cleanupSession();
                    terminate();
                },
            });

            return () => {
                cleanupSession();
                inputSubscription.unsubscribe();
            };
        });
    }

    reconcileMembership(input: MeshMembershipReconcileInput): MeshMembershipReconcileResult {
        const parsedInput = meshMembershipReconcileInputSchema.parse(input);
        const scopedSnapshot = this.meshOverlayScopeService.scopeMembershipSnapshotByOrganization(
            parsedInput.snapshot,
            parsedInput.organizationId ?? null,
        );
        let mergedNodes = 0;
        let mergedConnections = 0;
        let mergedSessions = 0;
        let skippedStale = 0;

        for (const node of scopedSnapshot.nodes) {
            const existing = this.remoteNodes.get(node.nodeId);
            if (!existing || existing.lastSeenAt <= node.lastSeenAt) {
                if (!parsedInput.dryRun) {
                    this.remoteNodes.set(node.nodeId, node);
                    this.recordTopologyEvent({
                        type: "node_upserted",
                        node,
                        timestamp: new Date().toISOString(),
                    });
                }
                mergedNodes += 1;
            } else {
                skippedStale += 1;
            }
        }

        for (const connection of scopedSnapshot.connections) {
            const existing = this.peerConnections.get(connection.connectionId);
            const existingSeen = existing?.lastHeartbeatAt ?? "";
            const incomingSeen = connection.lastHeartbeatAt ?? "";
            if (!existing || existingSeen <= incomingSeen) {
                if (!parsedInput.dryRun) {
                    this.peerConnections.set(connection.connectionId, connection);
                    this.recordTopologyEvent({
                        type: "edge_upserted",
                        edge: connection,
                        timestamp: new Date().toISOString(),
                    });
                }
                mergedConnections += 1;
            } else {
                skippedStale += 1;
            }
        }

        for (const session of scopedSnapshot.sessions) {
            const existing = this.peerSessions.get(session.sessionId);
            const existingSeen = existing?.lastHeartbeatAt ?? existing?.disconnectedAt ?? "";
            const incomingSeen = session.lastHeartbeatAt ?? session.disconnectedAt ?? "";
            if (!existing || existingSeen <= incomingSeen) {
                if (!parsedInput.dryRun) {
                    this.peerSessions.set(session.sessionId, session);
                    if (session.state !== "closed" && session.peerNodeId) {
                        this.activeSessionByPeerNodeId.set(session.peerNodeId, session.sessionId);
                    }
                    if (session.state !== "closed") {
                        this.activeSessionByEndpointUrl.set(session.endpointUrl, session.sessionId);
                    }
                }
                mergedSessions += 1;
            } else {
                skippedStale += 1;
            }
        }

        if (!parsedInput.dryRun && (mergedNodes > 0 || mergedConnections > 0 || mergedSessions > 0)) {
            this.membershipVersion += 1;
            this.recomputePathRanks();
            this.emitRuntimeState("membership_reconciled", null);
        }

        return {
            mergedNodes,
            mergedConnections,
            mergedSessions,
            skippedStale,
            version: this.membershipVersion,
        };
    }

    connectPeer(input: MeshPeerConnectInput): MeshPeerConnectResult {
        const now = new Date().toISOString();

        const resumed = this.tryResumeSession(input, now);
        if (resumed) {
            return resumed;
        }

        const currentActiveSessionId = this.activeSessionByEndpointUrl.get(input.endpointUrl);
        if (currentActiveSessionId) {
            const current = this.peerSessions.get(currentActiveSessionId);
            if (current && current.state !== "closed") {
                return {
                    connected: true,
                    deduplicated: true,
                    resumed: false,
                    session: current,
                };
            }
        }

        const created = meshPeerSessionSchema.parse({
            sessionId: randomUUID(),
            peerNodeId: null,
            endpointUrl: input.endpointUrl,
            state: "connected",
            reconnectAttempt: 0,
            nextReconnectAt: null,
            resumeToken: input.resumeToken ?? randomUUID(),
            duplicateSuppressed: false,
            duplicateOfSessionId: null,
            connectedAt: now,
            disconnectedAt: null,
            lastHeartbeatAt: now,
            metadata: {
                ...(input.metadata ?? {}),
                serverUrl: input.serverUrl ?? null,
                remoteAuthSession: input.remoteAuthSession ?? null,
            },
        });

        this.peerSessions.set(created.sessionId, created);
        this.activeSessionByEndpointUrl.set(created.endpointUrl, created.sessionId);

        this.emitRuntimeState("session_connected", null);

        return {
            connected: true,
            deduplicated: false,
            resumed: false,
            session: created,
        };
    }

    disconnectPeer(sessionId: string, input: MeshPeerDisconnectInput): MeshPeerDisconnectResult {
        const existing = this.peerSessions.get(sessionId);
        if (!existing) {
            throw new NotFoundException(`Mesh peer session '${sessionId}' not found`);
        }

        const now = new Date().toISOString();
        const reconnectAttempt = input.allowReconnect ? existing.reconnectAttempt + 1 : existing.reconnectAttempt;
        const updated: MeshPeerSession = {
            ...existing,
            state: input.allowReconnect ? "reconnecting" : "closed",
            reconnectAttempt,
            nextReconnectAt: input.allowReconnect
                ? this.computeNextReconnectAt(reconnectAttempt, Date.now())
                : null,
            disconnectedAt: now,
            metadata: {
                ...(existing.metadata ?? {}),
                disconnectReason: input.reason ?? null,
                allowReconnect: input.allowReconnect,
            },
        };

        this.peerSessions.set(updated.sessionId, updated);
        if (updated.peerNodeId && !input.allowReconnect && this.activeSessionByPeerNodeId.get(updated.peerNodeId) === updated.sessionId) {
            this.activeSessionByPeerNodeId.delete(updated.peerNodeId);
        }
        if (!input.allowReconnect && this.activeSessionByEndpointUrl.get(updated.endpointUrl) === updated.sessionId) {
            this.activeSessionByEndpointUrl.delete(updated.endpointUrl);
        }

        this.emitRuntimeState("session_disconnected", null);

        return {
            disconnected: true,
            session: updated,
        };
    }

    heartbeatPeer(sessionId: string, input: MeshPeerHeartbeatInput): MeshPeerHeartbeatResult {
        const existing = this.peerSessions.get(sessionId);
        if (!existing) {
            throw new NotFoundException(`Mesh peer session '${sessionId}' not found`);
        }

        const now = new Date().toISOString();
        const resolvedPeerNodeId = existing.peerNodeId ?? input.peerNodeId ?? null;
        if (!resolvedPeerNodeId) {
            throw new BadRequestException("peerNodeId must be provided on heartbeat until peer identity is resolved");
        }

        const updatedSession: MeshPeerSession = {
            ...existing,
            peerNodeId: resolvedPeerNodeId,
            state: "connected",
            reconnectAttempt: 0,
            nextReconnectAt: null,
            lastHeartbeatAt: now,
            connectedAt: existing.connectedAt ?? now,
            duplicateSuppressed: false,
            duplicateOfSessionId: null,
        };
        this.peerSessions.set(updatedSession.sessionId, updatedSession);
        this.activeSessionByPeerNodeId.set(resolvedPeerNodeId, updatedSession.sessionId);
        this.activeSessionByEndpointUrl.set(updatedSession.endpointUrl, updatedSession.sessionId);

        const connection = this.upsertPeerConnectionFromHeartbeat(updatedSession, input, now);

        if (this.clusterRepository) {
            void this.clusterRepository
                .persistNodeHeartbeat({
                    clusterId: this.localNode.clusterId,
                    nodeId: resolvedPeerNodeId,
                    organizationId: this.resolveSessionOrganizationId(sessionId),
                    serverUrl:
                        typeof updatedSession.metadata?.serverUrl === "string"
                            ? updatedSession.metadata.serverUrl
                            : null,
                    metrics: connection.metrics,
                })
                .catch((error) => {
                    this.logger.warn(
                        `Failed to persist cluster node heartbeat metrics: ${
                            error instanceof Error ? error.message : "unknown error"
                        }`,
                    );
                });
        }

        this.emitRuntimeState("session_heartbeat", null);

        return {
            acknowledged: true,
            session: updatedSession,
            connection,
        };
    }

    streamTopology(input: TopologyStreamInput): AsyncIterable<MeshTopologyEvent> {
        return observableToAsyncIterable(this.observeTopology(input));
    }

    observeTopology(input: TopologyStreamInput): Observable<MeshTopologyEvent> {
        return this.meshEventService.observeTopology({
            clusterId: this.localNode.clusterId,
            replay: input.replay,
            replayLimit: input.replayLimit,
        }).pipe(
            filter((event) => this.isTopologyEventVisibleByTypeAndOrganization(event, input)),
        );
    }

    publishControlEnvelope(envelope: MeshControlEnvelope): {
        accepted: boolean;
        envelopeId: string;
        forwardedTo: string[];
    } {
        const trustedEnvelope = this.ensureTrustedControlEnvelope(envelope);

        this.applyEnvelopeSideEffects(trustedEnvelope);
        this.maybeAutoRollbackStrictTrust(`control_envelope:${trustedEnvelope.type}`);
        this.notifyControlEnvelopeHandlers(trustedEnvelope);
        this.emitRuntimeState("control_envelope", null);

        const forwardedCandidates = trustedEnvelope.targetNodeId
            ? [trustedEnvelope.targetNodeId]
            : [...this.peerConnections.values()]
                  .filter((peer) => peer.state !== "down")
                  .map((peer) => peer.targetNodeId);

        const forwardedTo = this.filterForwardedNodeIdsByOrganization(
            forwardedCandidates,
            trustedEnvelope.organizationId ?? null,
        );

        return {
            accepted: true,
            envelopeId: trustedEnvelope.envelopeId,
            forwardedTo,
        };
    }

    registerControlEnvelopeHandler(handler: (envelope: MeshControlEnvelope) => void): () => void {
        this.controlEnvelopeHandlers.add(handler);
        return () => {
            this.controlEnvelopeHandlers.delete(handler);
        };
    }

    private applyEnvelopeSideEffects(envelope: MeshControlEnvelope): void {
        if (envelope.type === "hello") {
            const parsedNode = meshNodeStateSchema.safeParse(envelope.payload.node);
            if (!parsedNode.success) {
                return;
            }

            const nextNode: MeshNodeState = {
                ...parsedNode.data,
                lastSeenAt: new Date().toISOString(),
            };
            this.remoteNodes.set(nextNode.nodeId, nextNode);
            this.recordTopologyEvent({
                type: "node_upserted",
                node: nextNode,
                timestamp: new Date().toISOString(),
            });
            this.meshOverlayScopeService.upsertNodeOverlayMemberships(nextNode.nodeId, nextNode.metadata);
            this.bumpMembershipVersion();
            return;
        }

        if (envelope.type === "heartbeat") {
            const source = this.remoteNodes.get(envelope.sourceNodeId);
            if (!source) {
                const heartbeatNode = meshNodeStateSchema.safeParse(envelope.payload.node);
                if (heartbeatNode.success) {
                    this.remoteNodes.set(heartbeatNode.data.nodeId, heartbeatNode.data);
                    this.recordTopologyEvent({
                        type: "node_upserted",
                        node: heartbeatNode.data,
                        timestamp: new Date().toISOString(),
                    });
                    this.bumpMembershipVersion();
                }
                return;
            }

            const refreshed: MeshNodeState = {
                ...source,
                lifecycleState: "healthy",
                lastSeenAt: new Date().toISOString(),
            };
            this.remoteNodes.set(refreshed.nodeId, refreshed);
            this.meshOverlayScopeService.upsertNodeOverlayMemberships(refreshed.nodeId, envelope.payload);
            this.recordTopologyEvent({
                type: "node_upserted",
                node: refreshed,
                timestamp: refreshed.lastSeenAt,
            });
            this.bumpMembershipVersion();
            return;
        }

        if (envelope.type === "membership_suspect") {
            const suspectNodeId = this.extractPayloadNodeId(envelope);
            if (!suspectNodeId) {
                return;
            }

            const existing = this.remoteNodes.get(suspectNodeId);
            if (!existing) {
                return;
            }

            const suspected: MeshNodeState = {
                ...existing,
                lifecycleState: "suspect",
                lastSeenAt: new Date().toISOString(),
            };
            this.remoteNodes.set(suspected.nodeId, suspected);
            this.recordTopologyEvent({
                type: "node_upserted",
                node: suspected,
                timestamp: suspected.lastSeenAt,
            });
            this.bumpMembershipVersion();
            return;
        }

        if (envelope.type === "membership_confirm") {
            const targetNodeId = this.extractPayloadNodeId(envelope);
            if (!targetNodeId) {
                return;
            }

            const existing = this.remoteNodes.get(targetNodeId);
            if (!existing) {
                return;
            }

            const confirmed: MeshNodeState = {
                ...existing,
                lifecycleState: "isolated",
                lastSeenAt: new Date().toISOString(),
            };
            this.remoteNodes.set(confirmed.nodeId, confirmed);
            this.recordTopologyEvent({
                type: "node_upserted",
                node: confirmed,
                timestamp: confirmed.lastSeenAt,
            });
            this.bumpMembershipVersion();
            return;
        }

        if (envelope.type === "membership_remove") {
            const targetNodeId = this.extractPayloadNodeId(envelope);
            if (!targetNodeId) {
                return;
            }

            const hadNode = this.remoteNodes.delete(targetNodeId);
            if (!hadNode) {
                return;
            }

            for (const [connectionId, connection] of this.peerConnections.entries()) {
                if (connection.sourceNodeId === targetNodeId || connection.targetNodeId === targetNodeId) {
                    this.peerConnections.delete(connectionId);
                    this.recordTopologyEvent({
                        type: "edge_removed",
                        connectionId,
                        sourceNodeId: connection.sourceNodeId,
                        targetNodeId: connection.targetNodeId,
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            for (const [sessionId, session] of this.peerSessions.entries()) {
                if (session.peerNodeId === targetNodeId) {
                    this.peerSessions.delete(sessionId);
                    this.activeSessionByPeerNodeId.delete(targetNodeId);
                    this.activeSessionByEndpointUrl.delete(session.endpointUrl);
                }
            }

            this.recordTopologyEvent({
                type: "node_removed",
                nodeId: targetNodeId,
                timestamp: new Date().toISOString(),
            });

            this.removeResourceLocationsByNode(targetNodeId);
            this.meshOverlayScopeService.removeNodeFromAllOverlayScopes(targetNodeId);
            this.bumpMembershipVersion();
            return;
        }

        if (envelope.type === "anti_entropy_sync") {
            const snapshot = envelope.payload.snapshot;
            const parsedSnapshot = meshMembershipSnapshotSchema.safeParse(snapshot);
            if (!parsedSnapshot.success) {
                return;
            }

            this.reconcileMembership({
                snapshot: parsedSnapshot.data,
                sourceNodeId: envelope.sourceNodeId,
                dryRun: false,
            });
            return;
        }

        if (envelope.type === "topology_delta") {
            const parsedEdge = meshPeerConnectionSchema.safeParse(envelope.payload.edge);
            if (!parsedEdge.success) {
                return;
            }

            const metrics = this.meshLogicService.computeWeightedMetrics(parsedEdge.data.metrics);
            const nextEdge: MeshPeerConnection = {
                ...parsedEdge.data,
                metrics,
                activePathRank: 1,
            };

            this.peerConnections.set(nextEdge.connectionId, nextEdge);
            this.recomputePathRanks();
            this.recordTopologyEvent({
                type: "edge_upserted",
                edge: this.peerConnections.get(nextEdge.connectionId) ?? nextEdge,
                timestamp: new Date().toISOString(),
            });
            this.bumpMembershipVersion();
            return;
        }

        if (envelope.type === "queue_transition") {
            const payloadEntry = envelope.payload.entry;
            const parsedEntry = meshQueueTransitionLogEntrySchema.safeParse(payloadEntry);
            if (!parsedEntry.success) {
                return;
            }

            this.applyReplicatedQueueTransitionLogEntry({
                entry: {
                    ...parsedEntry.data,
                    organizationId: envelope.organizationId ?? parsedEntry.data.organizationId ?? null,
                },
            });
            return;
        }

        if (envelope.type === "trust_keyring_sync") {
            const payloadKeysRaw = envelope.payload.keys;
            const payloadActiveKeyId = envelope.payload.activeKeyId;
            if (!Array.isArray(payloadKeysRaw)) {
                return;
            }

            const keys: { keyId: string; algorithm: "HS256"; secret: string; status: "active" | "previous" }[] = [];
            for (const item of payloadKeysRaw) {
                if (!item || typeof item !== "object") {
                    continue;
                }

                const value = item as Record<string, unknown>;
                const keyId = value.keyId;
                const algorithm = value.algorithm;
                const secret = value.secretMaterial;
                const status = value.status;

                if (
                    typeof keyId === "string" &&
                    keyId.length > 0 &&
                    algorithm === "HS256" &&
                    typeof secret === "string" &&
                    secret.length > 0 &&
                    (status === "active" || status === "previous")
                ) {
                    keys.push({
                        keyId,
                        algorithm,
                        secret,
                        status,
                    });
                }
            }

            if (keys.length === 0) {
                return;
            }

            this.applyTrustKeyringSnapshot({
                activeKeyId: typeof payloadActiveKeyId === "string" && payloadActiveKeyId.length > 0
                    ? payloadActiveKeyId
                    : null,
                keys,
            });

            if (envelope.sourceNodeId !== this.localNode.nodeId) {
                const ackKeyId = typeof payloadActiveKeyId === "string" && payloadActiveKeyId.length > 0
                    ? payloadActiveKeyId
                    : this.activeTrustKeyId;

                if (ackKeyId) {
                    this.publishControlEnvelope({
                        envelopeId: randomUUID(),
                        type: "trust_keyring_ack",
                        sourceNodeId: this.localNode.nodeId,
                        targetNodeId: envelope.sourceNodeId,
                        hop: 0,
                        maxHops: 16,
                        emittedAt: new Date().toISOString(),
                        payload: {
                            keyId: ackKeyId,
                            ackedAt: new Date().toISOString(),
                        },
                    });
                }
            }
            return;
        }

        if (envelope.type === "trust_keyring_ack") {
            const keyId = envelope.payload.keyId;
            if (typeof keyId !== "string" || keyId.length === 0) {
                return;
            }

            const expected = this.trustKeyExpectedPeersByKeyId.get(keyId);
            if (!expected?.has(envelope.sourceNodeId)) {
                return;
            }

            const acks = this.trustKeyAcksByKeyId.get(keyId) ?? new Set<string>();
            acks.add(envelope.sourceNodeId);
            this.trustKeyAcksByKeyId.set(keyId, acks);
            return;
        }

        if (envelope.type === "trust_strict_mode_sync") {
            const enabled = envelope.payload.enabled;
            if (typeof enabled !== "boolean") {
                return;
            }

            if (!enabled && this.isStrictTrustPinnedFromEnv()) {
                return;
            }

            this.strictTrustModeRequested = enabled;
            return;
        }
    }

    private extractPayloadNodeId(envelope: MeshControlEnvelope): string | null {
        const payloadValue = envelope.payload.nodeId;
        return typeof payloadValue === "string" && payloadValue.length > 0 ? payloadValue : null;
    }

    private resourceIndexKey(kind: MeshResourceKind, key: string, organizationId: string | null): string {
        const scope = organizationId ?? "__global__";
        return `${scope}:${kind}:${key}`;
    }

    private isTopologyEventVisibleByTypeAndOrganization(
        event: MeshTopologyEvent,
        input: TopologyStreamInput,
    ): boolean {
        const typeAllowed =
            (input.includeNodes && (event.type === "node_upserted" || event.type === "node_removed")) ||
            (input.includeEdges && (event.type === "edge_upserted" || event.type === "edge_removed"));

        if (!typeAllowed) {
            return false;
        }

        return this.meshOverlayScopeService.isTopologyEventVisibleForOrganization(event, input.organizationId ?? null);
    }

    private filterForwardedNodeIdsByOrganization(
        nodeIds: string[],
        organizationId: string | null,
    ): string[] {
        return this.meshOverlayScopeService.filterForwardedNodeIdsByOrganization(nodeIds, organizationId);
    }

    private applySessionOrganizationScopeToEnvelope(
        envelope: MeshControlEnvelope,
        sessionId: string | null,
    ): MeshControlEnvelope | null {
        const sessionOrganizationId = this.resolveSessionOrganizationId(sessionId);
        if (!sessionOrganizationId) {
            return envelope;
        }

        if (envelope.organizationId && envelope.organizationId !== sessionOrganizationId) {
            return null;
        }

        return {
            ...envelope,
            organizationId: sessionOrganizationId,
        };
    }

    private resolveSessionOrganizationId(sessionId: string | null): string | null {
        if (!sessionId) {
            return null;
        }

        const session = this.peerSessions.get(sessionId);
        if (!session?.metadata || typeof session.metadata !== "object") {
            return null;
        }

        const organizationId = session.metadata.organizationId;
        return typeof organizationId === "string" && organizationId.length > 0 ? organizationId : null;
    }

    private removeResourceLocationsByNode(ownerNodeId: string): void {
        for (const [indexKey, resources] of this.resourceIndex.entries()) {
            const remaining = resources.filter((resource) => resource.ownerNodeId !== ownerNodeId);
            if (remaining.length === 0) {
                this.resourceIndex.delete(indexKey);
                continue;
            }

            if (remaining.length !== resources.length) {
                this.resourceIndex.set(indexKey, remaining);
            }
        }
    }

    private isValidStreamCredential(credential: string): boolean {
        const configuredCredential = this.env().get("MESH_STREAM_SHARED_SECRET")?.toString().trim();
        if (!configuredCredential) {
            return credential.trim().length > 0;
        }

        return credential === configuredCredential;
    }

    private tryResumeSession(input: MeshPeerConnectInput, now: string): MeshPeerConnectResult | null {
        if (!input.resumeToken) {
            return null;
        }

        const resumable = [...this.peerSessions.values()]
            .find((session) => session.resumeToken === input.resumeToken);

        if (!resumable) {
            return null;
        }

        const resumedSession: MeshPeerSession = {
            ...resumable,
            endpointUrl: input.endpointUrl,
            state: "connected",
            reconnectAttempt: 0,
            nextReconnectAt: null,
            connectedAt: now,
            disconnectedAt: null,
            lastHeartbeatAt: now,
            duplicateSuppressed: false,
            duplicateOfSessionId: null,
            metadata: {
                ...(resumable.metadata ?? {}),
                resumedAt: now,
                serverUrl: input.serverUrl ?? (resumable.metadata && typeof resumable.metadata === "object" ? (resumable.metadata.serverUrl as string | null | undefined) : null) ?? null,
                remoteAuthSession: input.remoteAuthSession ?? (resumable.metadata && typeof resumable.metadata === "object" ? resumable.metadata.remoteAuthSession : null) ?? null,
            },
        };

        this.peerSessions.set(resumedSession.sessionId, resumedSession);
        this.activeSessionByEndpointUrl.set(resumedSession.endpointUrl, resumedSession.sessionId);
        if (resumedSession.peerNodeId) {
            this.activeSessionByPeerNodeId.set(resumedSession.peerNodeId, resumedSession.sessionId);
        }

        return {
            connected: true,
            deduplicated: false,
            resumed: true,
            session: resumedSession,
        };
    }

    private upsertPeerConnectionFromHeartbeat(
        session: MeshPeerSession,
        input: MeshPeerHeartbeatInput,
        now: string,
    ): MeshPeerConnection {
        const existing = [...this.peerConnections.values()].find(
            (connection) =>
                connection.sourceNodeId === this.localNode.nodeId &&
                connection.targetNodeId === session.peerNodeId,
        );

        const metrics = this.meshLogicService.computeWeightedMetrics({
            latencyMs: input.latencyMs,
            jitterMs: input.jitterMs,
            packetLossRatio: input.packetLossRatio,
            throughputMbps: input.throughputMbps,
            reliabilityScore: input.reliabilityScore,
            weight: existing?.metrics.weight ?? 0,
            measuredAt: now,
        });

        const connection = meshPeerConnectionSchema.parse({
            connectionId: existing?.connectionId ?? randomUUID(),
            sourceNodeId: this.localNode.nodeId,
            targetNodeId: session.peerNodeId,
            state: input.packetLossRatio >= 0.5 ? "degraded" : "up",
            metrics,
            activePathRank: 1,
            lastHeartbeatAt: now,
            metadata: existing?.metadata ?? null,
        });

        this.peerConnections.set(connection.connectionId, connection);
        this.recomputePathRanks();
        const rankedConnection = this.peerConnections.get(connection.connectionId) ?? connection;
        this.recordTopologyEvent({
            type: "edge_upserted",
            edge: rankedConnection,
            timestamp: now,
        });
        this.bumpMembershipVersion();
        return rankedConnection;
    }

    private computeNextReconnectAt(attempt: number, nowMs: number): string {
        return this.meshLogicService.computeNextReconnectAt(attempt, nowMs);
    }

    private recomputePathRanks(): void {
        const ranked = this.meshLogicService.recomputePathRanks(this.peerConnections.values());
        for (const edge of ranked) {
            this.peerConnections.set(edge.connectionId, {
                ...edge,
            });
        }
    }

    private recordTopologyEvent(event: MeshTopologyEvent): void {
        this.meshEventService.emitTopology(this.localNode.clusterId, event);
        this.topologyEvents.push(event);
        const overflow = this.topologyEvents.length - this.topologyHistoryLimit;
        if (overflow > 0) {
            this.topologyEvents.splice(0, overflow);
        }

        this.emitRuntimeState("topology_event", event);
    }

    private emitRuntimeState(reason: RuntimeReason, topologyEvent: MeshTopologyEvent | null): void {
        const state = this.getRealtimeState();
        const event: MeshRuntimeEvent = {
            type: "mesh_state",
            reason,
            localNode: state.localNode,
            peers: state.peers,
            sessions: state.sessions,
            snapshot: state.snapshot,
            topologyEvent,
            emittedAt: state.timestamp,
            revision: this.membershipVersion,
        };

        this.meshEventService.emitRuntime(this.localNode.clusterId, event);
    }

    private bumpMembershipVersion(): void {
        this.membershipVersion += 1;
    }

    private notifyControlEnvelopeHandlers(envelope: MeshControlEnvelope): void {
        for (const handler of this.controlEnvelopeHandlers) {
            try {
                handler(envelope);
            } catch {
                // Never break control plane envelope processing due to external bridge handlers.
            }
        }
    }

    private applyQueueTransitionEntry(entry: MeshQueueTransitionLogEntry): QueueTransitionApplyState {
        const transitionKey = `${entry.sourceNodeId}:${entry.payload.transitionId}`;
        const existingByIdempotency = this.queueTransitionByIdempotencyKey.get(entry.payload.idempotencyKey);
        if (existingByIdempotency) {
            if (existingByIdempotency.payloadHash === entry.payloadHash) {
                return {
                    applied: false,
                    duplicate: true,
                    reason: "duplicate_delivery",
                    entry: existingByIdempotency,
                };
            }

            throw new BadRequestException(
                `Queue transition idempotency key conflict for '${entry.payload.idempotencyKey}'`,
            );
        }

        const existingByTransitionId = this.queueTransitionBySourceAndTransitionId.get(transitionKey);
        if (existingByTransitionId) {
            if (existingByTransitionId.payloadHash === entry.payloadHash) {
                return {
                    applied: false,
                    duplicate: true,
                    reason: "duplicate_transition",
                    entry: existingByTransitionId,
                };
            }

            throw new BadRequestException(
                `Queue transition conflict for source '${entry.sourceNodeId}' and transition '${entry.payload.transitionId}'`,
            );
        }

        this.queueTransitionByIdempotencyKey.set(entry.payload.idempotencyKey, entry);
        this.queueTransitionBySourceAndTransitionId.set(transitionKey, entry);
        this.queueTransitionLog.push(entry);

        return {
            applied: true,
            duplicate: false,
            reason: null,
            entry,
        };
    }

    private computeQueueTransitionPayloadHash(payload: MeshQueueTransitionPayload): string {
        return createHash("sha256")
            .update(JSON.stringify(payload))
            .digest("hex");
    }

    private buildQueuePartitionCandidates(organizationId: string | null): QueuePartitionCandidate[] {
        const localCandidate: QueuePartitionCandidate = {
            nodeId: this.localNode.nodeId,
            ownerServerUrl: this.resolveNodeServerUrl(this.localNode.nodeId),
            role: this.localNode.roles[0] ?? "edge",
            local: true,
        };

        const remoteCandidates: QueuePartitionCandidate[] = [...this.remoteNodes.values()]
            .filter((node) => node.lifecycleState !== "isolated" && node.lifecycleState !== "leaving")
            .map((node) => ({
                nodeId: node.nodeId,
                ownerServerUrl: this.resolveNodeServerUrl(node.nodeId),
                role: node.roles[0] ?? "relay",
                local: false,
            }));

        const allCandidates = [localCandidate, ...remoteCandidates];
        const allowedNodeIds = this.filterForwardedNodeIdsByOrganization(
            allCandidates.map((candidate) => candidate.nodeId),
            organizationId,
        );
        const allowedNodeIdSet = new Set(allowedNodeIds);

        return allCandidates.filter((candidate) => allowedNodeIdSet.has(candidate.nodeId));
    }

    private computeQueuePartitionRendezvousScore(queue: string, partitionKey: string, nodeId: string): number {
        const digest = createHash("sha256")
            .update(`${queue}:${partitionKey}:${nodeId}`)
            .digest();
        return digest.readUInt32BE(0);
    }

    private isLeaseActive(leaseExpiresAt: string | null, nowIso: string): boolean {
        if (!leaseExpiresAt) {
            return false;
        }

        return leaseExpiresAt > nowIso;
    }

    private resolveNodeServerUrl(nodeId: string): string | null {
        if (nodeId === this.localNode.nodeId) {
            const localServerUrl = this.env().get("MESH_NODE_SERVER_URL")?.toString().trim();
            return localServerUrl && localServerUrl.length > 0 ? localServerUrl : null;
        }

        const remoteNode = this.remoteNodes.get(nodeId);
        if (!remoteNode?.metadata || typeof remoteNode.metadata !== "object") {
            return null;
        }

        const value = remoteNode.metadata.serverUrl;
        return typeof value === "string" && value.length > 0 ? value : null;
    }

    private loadEnvTrustKey(): void {
        const envSecret = this.env().get("MESH_CONTROL_ENVELOPE_SIGNING_KEY")?.toString().trim();
        if (!envSecret) {
            return;
        }

        const keyId = this.env().get("MESH_CONTROL_ENVELOPE_SIGNING_KID")?.toString().trim() || "env-active";
        this.trustKeys.set(keyId, {
            keyId,
            algorithm: "HS256",
            secret: envSecret,
            status: "active",
        });
        this.activeTrustKeyId = keyId;
    }

    private ensureTrustedControlEnvelope(envelope: MeshControlEnvelope): MeshControlEnvelope {
        if (this.trustKeys.size === 0) {
            return envelope;
        }

        const strictTrustConfigured = this.isStrictTrustConfigured();
        const strictTrustMode = strictTrustConfigured && this.getTrustStrictReadiness().ready;

        const fromLocalNode = envelope.sourceNodeId === this.localNode.nodeId;

        if (fromLocalNode) {
            if (envelope.signature && envelope.keyId) {
                this.assertEnvelopeSignatureValid(envelope);
                return envelope;
            }

            return this.signControlEnvelope(envelope);
        }

        if (!envelope.signature || !envelope.keyId) {
            if (!strictTrustMode) {
                return envelope;
            }
            throw new BadRequestException("Signed mesh control envelope is required for remote node messages");
        }

        this.assertEnvelopeSignatureValid(envelope);
        return envelope;
    }

    private signControlEnvelope(envelope: MeshControlEnvelope): MeshControlEnvelope {
        const keyId = this.activeTrustKeyId;
        if (!keyId) {
            throw new BadRequestException("No active mesh control-envelope signing key configured");
        }

        const trustKey = this.trustKeys.get(keyId);
        if (!trustKey) {
            throw new BadRequestException("Active mesh control-envelope signing key is unavailable");
        }

        const signingPayload = this.serializeEnvelopeForSigning({
            ...envelope,
            keyId,
            algorithm: trustKey.algorithm,
        });

        const signature = createHmac("sha256", trustKey.secret)
            .update(signingPayload)
            .digest("base64url");

        return {
            ...envelope,
            keyId,
            algorithm: trustKey.algorithm,
            signature,
        };
    }

    private assertEnvelopeSignatureValid(envelope: MeshControlEnvelope): void {
        if (!envelope.keyId || !envelope.signature) {
            throw new BadRequestException("Mesh control envelope keyId and signature are required");
        }

        if (envelope.algorithm && envelope.algorithm !== "HS256") {
            throw new BadRequestException(`Unsupported mesh control envelope algorithm '${envelope.algorithm}'`);
        }

        const trustKey = this.trustKeys.get(envelope.keyId);
        if (!trustKey) {
            throw new BadRequestException(`Unknown mesh control envelope key '${envelope.keyId}'`);
        }

        const signingPayload = this.serializeEnvelopeForSigning({
            ...envelope,
            algorithm: "HS256",
        });

        const expectedSignature = createHmac("sha256", trustKey.secret)
            .update(signingPayload)
            .digest("base64url");

        const expectedBuffer = Buffer.from(expectedSignature);
        const providedBuffer = Buffer.from(envelope.signature);
        if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
            throw new BadRequestException("Invalid mesh control envelope signature");
        }
    }

    private serializeEnvelopeForSigning(envelope: MeshControlEnvelope): string {
        return JSON.stringify({
            envelopeId: envelope.envelopeId,
            organizationId: envelope.organizationId ?? null,
            keyId: envelope.keyId ?? null,
            algorithm: envelope.algorithm ?? "HS256",
            type: envelope.type,
            sourceNodeId: envelope.sourceNodeId,
            targetNodeId: envelope.targetNodeId,
            partitionKey: envelope.partitionKey ?? null,
            traceId: envelope.traceId ?? null,
            hop: envelope.hop,
            maxHops: envelope.maxHops,
            emittedAt: envelope.emittedAt,
            payload: envelope.payload,
        });
    }

    private applyTrustKeyringSnapshot(input: {
        activeKeyId: string | null;
        keys: { keyId: string; algorithm: "HS256"; secret: string; status: "active" | "previous" }[];
    }): void {
        this.trustKeys.clear();
        for (const key of input.keys) {
            this.trustKeys.set(key.keyId, key);
        }

        if (input.activeKeyId && this.trustKeys.has(input.activeKeyId)) {
            this.activeTrustKeyId = input.activeKeyId;
            return;
        }

        const active = input.keys.find((key) => key.status === "active") ?? null;
        this.activeTrustKeyId = active?.keyId ?? null;
    }

    private listTrustKeys(): MeshTrustKeyInfo[] {
        return [...this.trustKeys.values()]
            .map((key) => ({
                keyId: key.keyId,
                algorithm: key.algorithm,
                status: key.status,
            }))
            .sort((left, right) => {
                if (left.status !== right.status) {
                    return left.status === "active" ? -1 : 1;
                }
                return left.keyId.localeCompare(right.keyId);
            });
    }

    private listTrustSecretKeys(): {
        keyId: string;
        algorithm: "HS256";
        status: "active" | "previous";
        secretMaterial: string;
    }[] {
        return [...this.trustKeys.values()]
            .map((key) => ({
                keyId: key.keyId,
                algorithm: key.algorithm,
                status: key.status,
                secretMaterial: key.secret,
            }))
            .sort((left, right) => {
                if (left.status !== right.status) {
                    return left.status === "active" ? -1 : 1;
                }
                return left.keyId.localeCompare(right.keyId);
            });
    }

    private resolveExpectedTrustAckPeers(): string[] {
        const peerNodeIds = new Set<string>();
        for (const nodeId of this.remoteNodes.keys()) {
            if (nodeId !== this.localNode.nodeId) {
                peerNodeIds.add(nodeId);
            }
        }

        for (const connection of this.peerConnections.values()) {
            if (connection.targetNodeId !== this.localNode.nodeId) {
                peerNodeIds.add(connection.targetNodeId);
            }
        }

        return [...peerNodeIds].sort();
    }

    private resolveTrustMinAckRatio(): number {
        const raw = this.env().get("MESH_TRUST_STRICT_MIN_ACK_RATIO")?.toString().trim();
        const parsed = raw ? Number(raw) : Number.NaN;
        if (!Number.isFinite(parsed)) {
            return 1;
        }

        return Math.min(1, Math.max(0, parsed));
    }

    private resolveTrustMaxAckAgeSeconds(): number {
        const raw = this.env().get("MESH_TRUST_STRICT_MAX_ACK_AGE_SECONDS")?.toString().trim();
        const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
        if (!Number.isFinite(parsed) || parsed < 1) {
            return 300;
        }

        return parsed;
    }

    private resolveRotationAgeSeconds(lastRotatedAt: string | null): number | null {
        if (!lastRotatedAt) {
            return null;
        }

        const rotationDate = new Date(lastRotatedAt);
        if (Number.isNaN(rotationDate.getTime())) {
            return null;
        }

        const elapsedMs = Date.now() - rotationDate.getTime();
        if (elapsedMs < 0) {
            return 0;
        }

        return Math.floor(elapsedMs / 1000);
    }

    private resolveTrustRolloutWaveSize(explicitWaveSize?: number): number {
        if (typeof explicitWaveSize === "number" && Number.isFinite(explicitWaveSize)) {
            return Math.max(1, Math.floor(explicitWaveSize));
        }

        const raw = this.env().get("MESH_TRUST_STRICT_ROLLOUT_WAVE_SIZE")?.toString().trim();
        const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
        if (!Number.isFinite(parsed) || parsed < 1) {
            return 3;
        }

        return parsed;
    }

    private readBooleanEnv(name: string): boolean {
        const raw = this.env().get(name as never);

        if (typeof raw === "boolean") {
            return raw;
        }

        if (typeof raw === "number") {
            return raw !== 0;
        }

        if (typeof raw === "string") {
            const normalized = raw.trim().toLowerCase();
            if (normalized.length === 0) {
                return false;
            }

            if (["1", "true", "yes", "on"].includes(normalized)) {
                return true;
            }

            if (["0", "false", "no", "off"].includes(normalized)) {
                return false;
            }

            return true;
        }

        return false;
    }

    private isStrictTrustAutoRollbackEnabled(): boolean {
        return this.readBooleanEnv("MESH_TRUST_STRICT_AUTO_ROLLBACK");
    }

    private maybeAutoRollbackStrictTrust(cause: string): void {
        if (!this.isStrictTrustAutoRollbackEnabled()) {
            return;
        }

        if (!this.strictTrustModeRequested) {
            return;
        }

        if (this.isStrictTrustPinnedFromEnv()) {
            return;
        }

        const readiness = this.getTrustStrictReadiness();
        if (!readiness.rollbackRecommended) {
            return;
        }

        this.strictTrustModeRequested = false;
        this.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "trust_strict_mode_sync",
            sourceNodeId: this.localNode.nodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                enabled: false,
                setAt: new Date().toISOString(),
                rollback: {
                    reason: "auto_triggered",
                    triggers: readiness.rollbackTriggers,
                    forced: true,
                    cause,
                },
            },
        });
    }

    private buildRolloutWaves(nodeIds: string[], waveSize: number): { index: number; nodeIds: string[] }[] {
        const waves: { index: number; nodeIds: string[] }[] = [];
        for (let index = 0; index < nodeIds.length; index += waveSize) {
            waves.push({
                index: Math.floor(index / waveSize) + 1,
                nodeIds: nodeIds.slice(index, index + waveSize),
            });
        }

        return waves;
    }

    private isStrictTrustPinnedFromEnv(): boolean {
        return this.readBooleanEnv("MESH_CONTROL_ENVELOPE_TRUST_REQUIRED");
    }

    private isStrictTrustConfigured(): boolean {
        return this.isStrictTrustPinnedFromEnv() || this.strictTrustModeRequested;
    }

    private isSuperAdminRole(role: string | null | undefined): boolean {
        return role === "superAdmin" || role === "superadmin";
    }
}
