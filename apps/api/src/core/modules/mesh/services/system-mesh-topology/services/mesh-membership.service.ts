import { Inject, Injectable } from '@nestjs/common'
import {
    meshMembershipReconcileInputSchema,
    type MeshMembershipReconcileInput,
    type MeshMembershipReconcileResult,
    type MeshMembershipSnapshot,
    type MeshNodeState,
} from '@repo/contracts-entities'
import { CLOCK_TOKEN, type Clock } from '../../../shared/primitives/clock'
import { LwwMap } from '../../../shared/primitives/lww-map'
import { MeshIdentityService } from './mesh-identity.service'
import { MeshHealthMonitorService } from './mesh-health-monitor.service'
import { MeshPeerSessionService } from './mesh-peer-session.service'
import { SystemMeshOverlayScopeService } from '../../system-mesh-overlay-scope.service'
import { SystemMeshEventService } from '../../../events/system-mesh-event.service'

/**
 * Membership distribué via LWW-Map (CRDT).
 * Remplace le compteur entier naïf par un vrai modèle de convergence.
 */
@Injectable()
export class MeshMembershipService {
    /** LWW-Map : nodeId → VersionedNodeState */
    private readonly remoteNodes = new LwwMap<string, MeshNodeState>()
    private membershipVersion = 1

    constructor(
        @Inject(CLOCK_TOKEN) private readonly clock: Clock,
        private readonly identity: MeshIdentityService,
        private readonly health: MeshHealthMonitorService,
        private readonly sessions: MeshPeerSessionService,
        private readonly overlayScope: SystemMeshOverlayScopeService,
        private readonly meshEventService: SystemMeshEventService
    ) {}

    upsertRemoteNode(node: MeshNodeState): boolean {
        const hlc = this.identity.observeHlc({
            wallMs: new Date(node.lastSeenAt).getTime(),
            logical: 0,
            nodeId: node.nodeId,
        })
        const changed = this.remoteNodes.set(node.nodeId, node, hlc)
        if (changed) {
            this.meshEventService.emitTopology({
                type: 'node_upserted',
                node,
                timestamp: this.clock.nowIso(),
            })
            this.overlayScope.upsertNodeOverlayMemberships(
                node.nodeId,
                node.metadata
            )
            this.bumpVersion()
        }
        return changed
    }

    removeRemoteNode(nodeId: string): boolean {
        const hlc = this.identity.tickHlc()
        const removed = this.remoteNodes.delete(nodeId, hlc)
        if (removed) {
            this.health.removeByNodeId(nodeId)
            this.sessions.removeByPeerNodeId(nodeId)
            this.overlayScope.removeNodeFromAllOverlayScopes(nodeId)
            this.meshEventService.emitTopology({
                type: 'node_removed',
                nodeId,
                timestamp: this.clock.nowIso(),
            })
            this.bumpVersion()
        }
        return removed
    }

    markSuspect(nodeId: string): void {
        const existing = this.remoteNodes.get(nodeId)
        if (!existing) return
        this.upsertRemoteNode({
            ...existing,
            lifecycleState: 'suspect',
            lastSeenAt: this.clock.nowIso(),
        })
    }

    markIsolated(nodeId: string): void {
        const existing = this.remoteNodes.get(nodeId)
        if (!existing) return
        this.upsertRemoteNode({
            ...existing,
            lifecycleState: 'isolated',
            lastSeenAt: this.clock.nowIso(),
        })
    }

    reconcile(
        input: MeshMembershipReconcileInput
    ): MeshMembershipReconcileResult {
        const parsed = meshMembershipReconcileInputSchema.parse(input)
        const scoped = this.overlayScope.scopeMembershipSnapshotByOrganization(
            parsed.snapshot,
            parsed.organizationId ?? null
        )

        let mergedNodes = 0
        let mergedConnections = 0
        let mergedSessions = 0
        let skippedStale = 0

        for (const node of scoped.nodes) {
            if (!parsed.dryRun) {
                const changed = this.upsertRemoteNode(node)
                if (changed) mergedNodes += 1
                else skippedStale += 1
            } else {
                mergedNodes += 1
            }
        }

        for (const connection of scoped.connections) {
            if (!parsed.dryRun) {
                const changed = this.health.upsertFromReconcile(connection)
                if (changed) mergedConnections += 1
                else skippedStale += 1
            } else {
                mergedConnections += 1
            }
        }

        for (const session of scoped.sessions) {
            if (!parsed.dryRun) {
                const changed = this.sessions.upsertFromReconcile(session)
                if (changed) mergedSessions += 1
                else skippedStale += 1
            } else {
                mergedSessions += 1
            }
        }

        if (
            !parsed.dryRun &&
            (mergedNodes > 0 || mergedConnections > 0 || mergedSessions > 0)
        ) {
            this.bumpVersion()
            this.health.recomputeRanks()
        }

        return {
            mergedNodes,
            mergedConnections,
            mergedSessions,
            skippedStale,
            version: this.membershipVersion,
        }
    }

    getSnapshot(organizationId?: string | null): MeshMembershipSnapshot {
        const snapshot: MeshMembershipSnapshot = {
            version: this.membershipVersion,
            generatedAt: this.clock.nowIso(),
            localNode: this.identity.getLocalNode(),
            nodes: [...this.remoteNodes.values()],
            connections: this.health.listRanked(),
            sessions: this.sessions.list(),
        }
        if (!organizationId) return snapshot
        return this.overlayScope.scopeMembershipSnapshotByOrganization(
            snapshot,
            organizationId,
            {
                fallbackToUnscoped: false,
            }
        )
    }

    getRemoteNode(nodeId: string): MeshNodeState | undefined {
        return this.remoteNodes.get(nodeId)
    }

    listRemoteNodes(): MeshNodeState[] {
        return [...this.remoteNodes.values()]
    }

    getVersion(): number {
        return this.membershipVersion
    }
    getRemoteNodeCount(): number {
        return this.remoteNodes.size()
    }

    private bumpVersion(): void {
        this.membershipVersion += 1
    }
}
