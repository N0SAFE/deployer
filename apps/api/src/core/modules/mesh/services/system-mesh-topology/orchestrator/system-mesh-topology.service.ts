import { Injectable, Logger, Optional } from '@nestjs/common'
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { type Observable } from 'rxjs'
import { map, filter } from 'rxjs/operators'
import { observableToAsyncIterable } from '@/core/utils/observable.utils'
import type {
    MeshControlEnvelope,
    MeshDuplexStreamInput,
    MeshDuplexStreamOutput,
    MeshJoinGrantConsumeInput,
    MeshJoinGrantConsumeResult,
    MeshJoinGrantIssueResult,
    MeshJoinGrantRevokeResult,
    MeshMembershipReconcileInput,
    MeshMembershipReconcileResult,
    MeshMembershipSnapshot,
    MeshNodeState,
    MeshPeerConnectInput,
    MeshPeerConnectResult,
    MeshPeerDisconnectInput,
    MeshPeerDisconnectResult,
    MeshPeerHeartbeatInput,
    MeshPeerHeartbeatResult,
    MeshQueuePartitionPlanInput,
    MeshQueuePartitionPlanResult,
    MeshQueueTransitionAppendInput,
    MeshQueueTransitionAppendResult,
    MeshQueueTransitionApplyInput,
    MeshQueueTransitionApplyResult,
    MeshQueueTransitionListInput,
    MeshQueueTransitionListResult,
    MeshRegisterNodeInput,
    MeshRegisterNodeResult,
    MeshResourceIndexUpsertInput,
    MeshResourceIndexUpsertResult,
    MeshResourceLookupInput,
    MeshResourceLookupResult,
    MeshRuntimeEvent,
    MeshStreamRoutePlanInput,
    MeshStreamRoutePlanResult,
    MeshTopologyEvent,
    MeshTopologyStreamInput,
    MeshTrustKeyringConvergenceStatusResult,
    MeshTrustKeyringRotateCommandInput,
    MeshTrustKeyringRotateResult,
    MeshTrustKeyringSecretsResult,
    MeshTrustKeyringStatusResult,
    MeshTrustStrictModeSetCommandInput,
    MeshTrustStrictModeSetResult,
    MeshTrustStrictReadinessResult,
    MeshTrustStrictRollbackCommandInput,
    MeshTrustStrictRollbackResult,
    MeshTrustStrictRolloutPlanInput,
    MeshTrustStrictRolloutPlanResult,
    MeshJoinGrantIssueCommandInput,
    MeshJoinGrantRevokeCommandInput,
} from '@repo/contracts-entities'
import type { PartitionPolicyResult } from '../../mesh-partition-policy'
import { MeshPartitionPolicy } from '../../mesh-partition-policy'
import {
    MeshAuthorizationError,
    MeshDependencyMissingError,
    MeshNotFoundError,
} from '../domain/mesh-errors'

import type { MeshIdentityService } from '../services/mesh-identity.service'
import type { MeshTrustService } from '../services/mesh-trust.service'
import type { MeshTrustStrictModeService } from '../services/mesh-trust-strict-mode.service'
import type { MeshPeerSessionService } from '../services/mesh-peer-session.service'
import type { MeshHealthMonitorService } from '../services/mesh-health-monitor.service'
import type { MeshMembershipService } from '../services/mesh-membership.service'
import type { MeshResourceRegistryService } from '../services/mesh-resource-registry.service'
import type { MeshStreamRouterService } from '../services/mesh-stream-router.service'
import type { MeshQueueReplicationService } from '../services/mesh-queue-replication.service'
import type { MeshControlPlaneService } from '../services/mesh-control-plane.service'
import type { MeshClusterSyncService } from '../services/mesh-cluster-sync.service'
import type { MeshStreamSessionService } from '../services/mesh-stream-session.service'
import type { MeshEnvelopeSideEffectsService } from '../services/mesh-envelope-side-effects.service'
import type { SystemMeshEventService } from '../../../events/system-mesh-event.service'
import type { SystemMeshOverlayScopeService } from '../../system-mesh-overlay-scope.service'
import type { SystemMeshClusterRepository } from '../../../repositories/system-mesh-cluster.repository'

/**
 * Façade orchestratrice du mesh.
 *
 * Cette classe ne contient AUCUNE logique métier — elle délègue
 * entièrement aux services de domaine. Son rôle :
 *  - Cycle de vie NestJS (OnModuleInit / OnModuleDestroy)
 *  - Point d'entrée unique pour les controllers/resolvers
 *  - Câblage des side-effects sur les control envelopes
 */
@Injectable()
export class SystemMeshTopologyService
    implements OnModuleInit, OnModuleDestroy
{
    private readonly logger = new Logger(SystemMeshTopologyService.name)

    constructor(
        private readonly identity: MeshIdentityService,
        private readonly trust: MeshTrustService,
        private readonly strictMode: MeshTrustStrictModeService,
        private readonly sessions: MeshPeerSessionService,
        private readonly health: MeshHealthMonitorService,
        private readonly membership: MeshMembershipService,
        private readonly resources: MeshResourceRegistryService,
        private readonly streamRouter: MeshStreamRouterService,
        private readonly queueReplication: MeshQueueReplicationService,
        private readonly controlPlane: MeshControlPlaneService,
        private readonly clusterSync: MeshClusterSyncService,
        private readonly _streamSession: MeshStreamSessionService,
        private readonly envelopeSideEffects: MeshEnvelopeSideEffectsService,
        private readonly meshEventService: SystemMeshEventService,
        private readonly overlayScope: SystemMeshOverlayScopeService,
        @Optional()
        private readonly clusterRepository?: SystemMeshClusterRepository
    ) {}

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    async onModuleInit(): Promise<void> {
        await this.trust.hydrate()
        await this.resources.hydrate()
        await this.clusterSync.registerLocalNodeOnStartup()
        await this.clusterSync.syncPeers('startup')

        // Câble les side-effects + auto-rollback sur chaque envelope publié
        this.controlPlane.registerHandler((envelope) => {
            this.envelopeSideEffects.apply(envelope)

            const rollback = this.strictMode.maybeAutoRollback(
                this.membership.getRemoteNodeCount()
            )
            if (rollback.triggered) {
                this.logger.warn(
                    `Strict trust auto-rollback triggered: ${rollback.reasons.join(', ')}`
                )
                this.publishTrustStrictModeSync(false, rollback.reasons)
            }
        })

        this.clusterSync.startPeriodicSync(() => {
            this.health.reconcileFreshness()
        })

        this.emitBootstrap()
    }

    onModuleDestroy(): void {
        this.clusterSync.stopPeriodicSync()
    }

    // ─── Identity ─────────────────────────────────────────────────────────────

    getLocalNode(): MeshNodeState {
        return this.identity.getLocalNode()
    }

    // ─── Peers & sessions ─────────────────────────────────────────────────────

    listPeers() {
        return { items: this.health.listRanked() }
    }

    listPeerSessions() {
        return { items: this.sessions.list() }
    }

    connectPeer(input: MeshPeerConnectInput): MeshPeerConnectResult {
        return this.sessions.connect(input)
    }

    disconnectPeer(
        sessionId: string,
        input: MeshPeerDisconnectInput
    ): MeshPeerDisconnectResult {
        return this.sessions.disconnect(sessionId, input)
    }

    heartbeatPeer(
        sessionId: string,
        input: MeshPeerHeartbeatInput
    ): MeshPeerHeartbeatResult {
        const result = this.health.heartbeat(sessionId, input)
        if (this.clusterRepository) {
            if (!input.peerNodeId) {
                throw new MeshAuthorizationError(
                    'Missing peerNodeId in heartbeat input'
                )
            }
            void this.clusterRepository
                .persistNodeHeartbeat({
                    nodeId: input.peerNodeId,
                    organizationId:
                        this.sessions.resolveOrganizationId(sessionId),
                    serverUrl: null,
                    metrics: result.connection.metrics,
                })
                .catch((e: unknown) => {
                    this.logger.warn(
                        `Heartbeat persist failed: ${this.errMsg(e)}`
                    )
                })
        }
        return result
    }

    // ─── Membership ───────────────────────────────────────────────────────────

    getMembershipSnapshot(input?: {
        organizationId?: string | null
    }): MeshMembershipSnapshot {
        return this.membership.getSnapshot(input?.organizationId)
    }

    reconcileMembership(
        input: MeshMembershipReconcileInput
    ): MeshMembershipReconcileResult {
        return this.membership.reconcile(input)
    }

    getRealtimeState() {
        return {
            localNode: this.identity.getLocalNode(),
            peers: this.health.listRanked(),
            sessions: this.sessions.list(),
            snapshot: this.membership.getSnapshot(),
            timestamp: new Date().toISOString(),
        }
    }

    // ─── Partition policy ─────────────────────────────────────────────────────

    getPartitionStatus(): PartitionPolicyResult {
        return MeshPartitionPolicy.evaluate({
            consistencyMode: this.identity.getLocalNode().consistencyMode,
            activePeerCount: this.sessions.countConnected(),
            quorumSize: MeshPartitionPolicy.getConfiguredQuorumSize(),
        })
    }

    // ─── Resources ────────────────────────────────────────────────────────────

    lookupResource(input: MeshResourceLookupInput): MeshResourceLookupResult {
        return this.resources.lookup(input)
    }

    upsertResourceIndex(
        input: MeshResourceIndexUpsertInput
    ): MeshResourceIndexUpsertResult {
        return this.resources.upsert(input)
    }

    // ─── Stream routing ───────────────────────────────────────────────────────

    planStreamRoute(
        input: MeshStreamRoutePlanInput
    ): MeshStreamRoutePlanResult {
        return this.streamRouter.planRoute(input)
    }

    // ─── Queue replication ────────────────────────────────────────────────────

    planQueuePartitionOwnership(
        input: MeshQueuePartitionPlanInput
    ): MeshQueuePartitionPlanResult {
        return this.queueReplication.planPartitionOwnership(input)
    }

    appendQueueTransitionLog(
        input: MeshQueueTransitionAppendInput
    ): MeshQueueTransitionAppendResult {
        return this.queueReplication.append(input)
    }

    applyReplicatedQueueTransitionLogEntry(
        input: MeshQueueTransitionApplyInput
    ): MeshQueueTransitionApplyResult {
        return this.queueReplication.applyReplicated(input)
    }

    listQueueTransitionLogs(
        input: MeshQueueTransitionListInput
    ): MeshQueueTransitionListResult {
        return this.queueReplication.list(input)
    }

    // ─── Trust keyring ────────────────────────────────────────────────────────

    getTrustKeyringStatus(): MeshTrustKeyringStatusResult {
        return {
            activeKeyId: this.trust.getActiveKeyId(),
            keys: this.trust.listKeys(),
        }
    }

    getTrustKeyringSecrets(): MeshTrustKeyringSecretsResult {
        return {
            activeKeyId: this.trust.getActiveKeyId(),
            keys: this.trust.listSecretKeys(),
        }
    }

    async rotateTrustKey(
        input: MeshTrustKeyringRotateCommandInput
    ): Promise<MeshTrustKeyringRotateResult> {
        this.assertSuperAdmin(input.rotatedByRole, 'rotate mesh trust keys')
        const expectedPeers = this.resolveExpectedTrustAckPeers()
        const { rotated, payloadKeys } = await this.trust.rotate(
            input,
            expectedPeers
        )

        this.controlPlane.publish({
            envelopeId: randomUUID(),
            type: 'trust_keyring_sync',
            sourceNodeId: this.identity.getNodeId(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: { activeKeyId: rotated.activeKeyId, keys: payloadKeys },
        })

        return {
            activeKeyId: rotated.activeKeyId,
            rotatedKeyId: rotated.rotatedKeyId,
            secretMaterial: rotated.secretMaterial,
            keys: this.trust.listKeys(),
        }
    }

    getTrustKeyringConvergenceStatus(): MeshTrustKeyringConvergenceStatusResult {
        const conv = this.trust.getConvergence()
        return {
            activeKeyId: conv.activeKeyId,
            converged: conv.pending.length === 0,
            expectedAcks: conv.expected,
            receivedAcks: conv.received,
            pendingNodeIds: conv.pending,
            lastRotatedAt: conv.lastRotatedAt,
        }
    }

    getTrustStrictReadiness(): MeshTrustStrictReadinessResult {
        return this.strictMode.getReadiness(
            this.membership.getRemoteNodeCount()
        )
    }

    getTrustStrictRolloutPlan(
        input: MeshTrustStrictRolloutPlanInput
    ): MeshTrustStrictRolloutPlanResult {
        const readiness = this.getTrustStrictReadiness()
        const conv = this.trust.getConvergence()
        const waveSize = this.strictMode.resolveWaveSize(input.waveSize)
        const acked = [...this.resolveExpectedTrustAckPeers()]
            .filter((n) => !conv.pending.includes(n))
            .sort()

        return {
            activeKeyId: conv.activeKeyId,
            strictConfigured: readiness.strictConfigured,
            strictEnforced: readiness.strictEnforced,
            waveSize,
            ackedNodeIds: acked,
            pendingNodeIds: [...conv.pending],
            waves: this.strictMode.buildRolloutWaves(acked, waveSize),
            rollbackRecommended: readiness.rollbackRecommended,
            rollbackTriggers: readiness.rollbackTriggers,
        }
    }

    setTrustStrictMode(
        input: MeshTrustStrictModeSetCommandInput
    ): MeshTrustStrictModeSetResult {
        if (input.enabled) {
            this.strictMode.enable(
                input.setByRole,
                this.membership.getRemoteNodeCount()
            )
        } else {
            this.strictMode.disable(input.setByRole)
        }
        this.publishTrustStrictModeSync(input.enabled, [])
        return {
            requested: this.strictMode.isStrictConfigured(),
            ...this.getTrustStrictReadiness(),
        }
    }

    rollbackTrustStrictMode(
        input: MeshTrustStrictRollbackCommandInput
    ): MeshTrustStrictRollbackResult {
        const { rolledBack, triggers } = this.strictMode.rollback(
            input.setByRole,
            input.force,
            this.membership.getRemoteNodeCount()
        )
        if (rolledBack) {
            this.publishTrustStrictModeSync(false, triggers)
        }
        return {
            requested: this.strictMode.isStrictConfigured(),
            rolledBack,
            ...this.getTrustStrictReadiness(),
        }
    }

    // ─── Join grants ──────────────────────────────────────────────────────────

    async issueJoinGrant(
        input: MeshJoinGrantIssueCommandInput
    ): Promise<MeshJoinGrantIssueResult> {
        this.assertSuperAdmin(input.issuedByRole, 'issue bootstrap join grants')
        const repo = this.requireClusterRepository(
            'issue bootstrap join grants'
        )
        const issued = await repo.issueJoinGrant({
            organizationId: input.organizationId ?? null,
            targetNodeId: input.targetNodeId ?? null,
            issuedByUserId: input.issuedByUserId,
            ttlSeconds: input.ttlSeconds,
            metadata: input.metadata ?? null,
        })
        return {
            grantId: issued.grantId,
            grantToken: issued.grantToken,
            expiresAt: issued.expiresAt,
            status: 'issued',
        }
    }

    async consumeJoinGrant(
        input: MeshJoinGrantConsumeInput
    ): Promise<MeshJoinGrantConsumeResult> {
        const repo = this.requireClusterRepository(
            'consume bootstrap join grants'
        )
        const consumed = await repo.consumeJoinGrant(input)
        if (!consumed) {
            throw new MeshNotFoundError('JoinGrant', 'token')
        }
        return {
            accepted: true,
            grantId: consumed.grantId,
            nodeId: consumed.nodeId,
            enrolledAt: consumed.enrolledAt,
        }
    }

    async registerNodeInCluster(
        input: MeshRegisterNodeInput
    ): Promise<MeshRegisterNodeResult> {
        const repo = this.requireClusterRepository('register cluster nodes')
        if (!('registerOrUpdateNode' in repo)) {
            throw new MeshDependencyMissingError(
                'registerOrUpdateNode',
                'register cluster nodes'
            )
        }
        const registered = await repo.registerOrUpdateNode({
            nodeId: input.nodeId,
            serverUrl: input.serverUrl,
            displayName: input.displayName ?? null,
            capabilities: input.capabilities ?? null,
            metadata: input.metadata ?? null,
        })
        return {
            accepted: true,
            nodeId: registered.nodeId,
            status: registered.status,
            enrolledAt: registered.enrolledAt,
        }
    }

    async revokeJoinGrant(
        input: MeshJoinGrantRevokeCommandInput
    ): Promise<MeshJoinGrantRevokeResult> {
        this.assertSuperAdmin(
            input.revokedByRole,
            'revoke bootstrap join grants'
        )
        const repo = this.requireClusterRepository(
            'revoke bootstrap join grants'
        )
        const revoked = await repo.revokeJoinGrant({
            grantId: input.grantId,
            revokedByUserId: input.revokedByUserId,
            reason: input.reason ?? null,
        })
        if (!revoked) throw new MeshNotFoundError('JoinGrant', input.grantId)
        return {
            revoked: true,
            grantId: revoked.grantId,
            status: 'revoked',
            revokedAt: revoked.revokedAt,
        }
    }

    // ─── Event streams ────────────────────────────────────────────────────────

    streamRuntimeEvents(input: {
        organizationId?: string | null
        replay: boolean
        replayLimit: number
    }): AsyncIterable<MeshRuntimeEvent> {
        return observableToAsyncIterable(this.observeRuntimeEvents(input))
    }

    observeRuntimeEvents(input: {
        organizationId?: string | null
        replay: boolean
        replayLimit: number
    }): Observable<MeshRuntimeEvent> {
        const source = this.meshEventService.observeRuntime({
            replay: input.replay,
            replayLimit: input.replayLimit,
        })
        return this.applyOrganizationFilterToRuntimeStream(
            source,
            input.organizationId ?? null
        )
    }

    /**
     * T106 — Cursor-based event stream replication.
     * Le consommateur persiste le dernier cursor reçu et le fournit
     * à la reconnexion pour éviter tout replay double.
     */
    streamRuntimeEventsSince(input: {
        cursor: number
        organizationId?: string | null
    }): AsyncIterable<MeshRuntimeEvent> {
        return observableToAsyncIterable(this.observeRuntimeEventsSince(input))
    }

    observeRuntimeEventsSince(input: {
        cursor: number
        organizationId?: string | null
    }): Observable<MeshRuntimeEvent> {
        const source = this.meshEventService.observeRuntimeSince({
            afterSequence: input.cursor,
        })
        return this.applyOrganizationFilterToRuntimeStream(
            source,
            input.organizationId ?? null
        )
    }

    getRuntimeEventCursor(): number {
        return this.meshEventService.runtimeLastSequence()
    }

    streamTopology(
        input: MeshTopologyStreamInput
    ): AsyncIterable<MeshTopologyEvent> {
        return observableToAsyncIterable(this.observeTopology(input))
    }

    observeTopology(
        input: MeshTopologyStreamInput
    ): Observable<MeshTopologyEvent> {
        return this.meshEventService
            .observeTopology({
                replay: input.replay,
                replayLimit: input.replayLimit,
            })
            .pipe(filter((event) => this.isTopologyEventVisible(event, input)))
    }

    // ─── Duplex stream session ────────────────────────────────────────────────

    streamSession(
        inputStream: AsyncIterable<MeshDuplexStreamInput>
    ): AsyncIterable<MeshDuplexStreamOutput> {
        return this._streamSession.streamSession(inputStream)
    }

    // ─── Control envelopes ────────────────────────────────────────────────────

    publishControlEnvelope(envelope: MeshControlEnvelope): {
        accepted: boolean
        envelopeId: string
        forwardedTo: string[]
    } {
        return this.controlPlane.publish(envelope)
    }

    registerControlEnvelopeHandler(
        handler: (envelope: MeshControlEnvelope) => void
    ): () => void {
        return this.controlPlane.registerHandler(handler)
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private applyOrganizationFilterToRuntimeStream(
        source: Observable<MeshRuntimeEvent>,
        organizationId: string | null
    ): Observable<MeshRuntimeEvent> {
        if (!organizationId) return source
        if (!this.overlayScope.hasScopedNodes(organizationId)) return source
        return source.pipe(
            map((event) =>
                this.overlayScope.filterRuntimeEventByOrganization(
                    event,
                    organizationId
                )
            )
        )
    }

    private isTopologyEventVisible(
        event: MeshTopologyEvent,
        input: MeshTopologyStreamInput
    ): boolean {
        const typeAllowed =
            (input.includeNodes &&
                (event.type === 'node_upserted' ||
                    event.type === 'node_removed')) ||
            (input.includeEdges &&
                (event.type === 'edge_upserted' ||
                    event.type === 'edge_removed'))

        if (!typeAllowed) return false

        return this.overlayScope.isTopologyEventVisibleForOrganization(
            event,
            input.organizationId ?? null
        )
    }

    private resolveExpectedTrustAckPeers(): string[] {
        const peers = new Set<string>()
        for (const node of this.membership.listRemoteNodes()) {
            if (node.nodeId !== this.identity.getNodeId())
                peers.add(node.nodeId)
        }
        for (const conn of this.health.listRanked()) {
            if (conn.targetNodeId !== this.identity.getNodeId())
                peers.add(conn.targetNodeId)
        }
        return [...peers].sort()
    }

    private publishTrustStrictModeSync(
        enabled: boolean,
        triggers: string[]
    ): void {
        this.controlPlane.publish({
            envelopeId: randomUUID(),
            type: 'trust_strict_mode_sync',
            sourceNodeId: this.identity.getNodeId(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                enabled,
                setAt: new Date().toISOString(),
                ...(triggers.length > 0
                    ? {
                          rollback: {
                              reason: 'auto_triggered',
                              triggers,
                              forced: true,
                          },
                      }
                    : {}),
            },
        })
    }

    private emitBootstrap(): void {
        const state = this.getRealtimeState()
        this.meshEventService.emitRuntime({
            type: 'mesh_state',
            reason: 'bootstrap',
            localNode: state.localNode,
            peers: state.peers,
            sessions: state.sessions,
            snapshot: state.snapshot,
            topologyEvent: null,
            emittedAt: state.timestamp,
            revision: this.membership.getVersion(),
        })
    }

    private requireClusterRepository(
        action: string
    ): SystemMeshClusterRepository {
        if (!this.clusterRepository) {
            throw new MeshDependencyMissingError(
                'MeshClusterRepository',
                action
            )
        }
        return this.clusterRepository
    }

    private assertSuperAdmin(
        role: string | null | undefined,
        action: string
    ): void {
        if (role !== 'superAdmin' && role !== 'superadmin') {
            throw new MeshAuthorizationError(action)
        }
    }

    private errMsg(e: unknown): string {
        return e instanceof Error ? e.message : 'unknown_error'
    }
}
