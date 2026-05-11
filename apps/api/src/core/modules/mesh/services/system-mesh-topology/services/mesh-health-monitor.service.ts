import { Inject, Injectable } from '@nestjs/common'
import {
    meshPeerConnectionSchema,
    type MeshPeerConnection,
    type MeshPeerHeartbeatInput,
    type MeshPeerHeartbeatResult,
    type MeshPeerSession,
} from '@repo/contracts-entities'
import { CLOCK_TOKEN, type Clock } from '../../../shared/primitives/clock'
import {
    ID_GENERATOR_TOKEN,
    type IdGenerator,
} from '../../../shared/primitives/id-generator'
import { PhiAccrualDetector } from '../../../shared/primitives/phi-accrual-detector'
import { MeshValidationError } from '../domain/mesh-errors'
import type { MeshPeerSessionService } from './mesh-peer-session.service'
import type { MeshIdentityService } from './mesh-identity.service'
import type { SystemMeshLogicService } from '../../system-mesh-logic.service';

/**
 * Heartbeats, métriques de connexion, Phi Accrual failure detection.
 * Remplace les seuils en dur (12s/30s) par une probabilité adaptative.
 */
@Injectable()
export class MeshHealthMonitorService {
    private readonly connections = new Map<string, MeshPeerConnection>()
    private readonly detectors = new Map<string, PhiAccrualDetector>()

    constructor(
        @Inject(CLOCK_TOKEN) private readonly clock: Clock,
        @Inject(ID_GENERATOR_TOKEN) private readonly idGen: IdGenerator,
        private readonly identity: MeshIdentityService,
        private readonly sessions: MeshPeerSessionService,
        private readonly meshLogic: SystemMeshLogicService
    ) {}

    heartbeat(
        sessionId: string,
        input: MeshPeerHeartbeatInput
    ): MeshPeerHeartbeatResult {
        const now = this.clock.nowIso()
        const peerNodeId = input.peerNodeId
        if (!peerNodeId)
            throw new MeshValidationError('peerNodeId required on heartbeat')

        const updatedSession = this.sessions.updateHeartbeat(
            sessionId,
            peerNodeId,
            now
        )
        const connection = this.upsertConnection(updatedSession, input, now)

        // Phi Accrual : enregistre le heartbeat pour ce peer
        const detector = this.getOrCreateDetector(peerNodeId)
        detector.heartbeat()

        return { acknowledged: true, session: updatedSession, connection }
    }

    /** Évalue l'état de chaque connexion via Phi Accrual (adaptatif). */
    reconcileFreshness(): { changed: boolean; updated: MeshPeerConnection[] } {
        const updated: MeshPeerConnection[] = []

        for (const [connectionId, connection] of this.connections) {
            const detector = this.detectors.get(connection.targetNodeId)
            if (!detector) continue

            const verdict = detector.verdict(4, 8)
            const nextState: MeshPeerConnection['state'] =
                verdict === 'dead'
                    ? 'down'
                    : verdict === 'suspect'
                      ? 'degraded'
                      : connection.state

            if (nextState === connection.state) continue

            const next: MeshPeerConnection = { ...connection, state: nextState }
            this.connections.set(connectionId, next)
            updated.push(next)
        }

        return { changed: updated.length > 0, updated }
    }

    upsertFromReconcile(connection: MeshPeerConnection): boolean {
        const existing = this.connections.get(connection.connectionId)
        const existingSeen = existing?.lastHeartbeatAt ?? ''
        const incomingSeen = connection.lastHeartbeatAt ?? ''
        if (existing && existingSeen > incomingSeen) return false
        this.connections.set(connection.connectionId, connection)
        return true
    }

    removeByNodeId(nodeId: string): void {
        for (const [id, conn] of this.connections) {
            if (conn.sourceNodeId === nodeId || conn.targetNodeId === nodeId) {
                this.connections.delete(id)
            }
        }
        this.detectors.delete(nodeId)
    }

    listRanked(): MeshPeerConnection[] {
        const ranked = this.meshLogic.recomputePathRanks(
            this.connections.values()
        )
        for (const edge of ranked) this.connections.set(edge.connectionId, edge)
        return [...this.connections.values()]
            .sort((a, b) => a.metrics.weight - b.metrics.weight)
            .map((conn, idx) => ({ ...conn, activePathRank: idx + 1 }))
    }

    getConnection(connectionId: string): MeshPeerConnection | undefined {
        return this.connections.get(connectionId)
    }

    findBySourceAndTarget(
        sourceNodeId: string,
        targetNodeId: string
    ): MeshPeerConnection | undefined {
        return [...this.connections.values()].find(
            (c) =>
                c.sourceNodeId === sourceNodeId &&
                c.targetNodeId === targetNodeId
        )
    }

    recomputeRanks(): void {
        const ranked = this.meshLogic.recomputePathRanks(
            this.connections.values()
        )
        for (const edge of ranked) this.connections.set(edge.connectionId, edge)
    }

    private upsertConnection(
        session: MeshPeerSession,
        input: MeshPeerHeartbeatInput,
        now: string
    ): MeshPeerConnection {
        if (!session.peerNodeId) {
            throw new MeshValidationError('Session must have peerNodeId to record heartbeat')
        }
        const existing = this.findBySourceAndTarget(
            this.identity.getNodeId(),
            session.peerNodeId
        )

        const metrics = this.meshLogic.computeWeightedMetrics({
            latencyMs: input.latencyMs,
            jitterMs: input.jitterMs,
            packetLossRatio: input.packetLossRatio,
            throughputMbps: input.throughputMbps,
            reliabilityScore: input.reliabilityScore,
            weight: existing?.metrics.weight ?? 0,
            measuredAt: now,
        })

        const connection = meshPeerConnectionSchema.parse({
            connectionId: existing?.connectionId ?? this.idGen.uuid(),
            sourceNodeId: this.identity.getNodeId(),
            targetNodeId: session.peerNodeId,
            state: input.packetLossRatio >= 0.5 ? 'degraded' : 'up',
            metrics,
            activePathRank: 1,
            lastHeartbeatAt: now,
            metadata: existing?.metadata ?? null,
        })

        this.connections.set(connection.connectionId, connection)
        this.recomputeRanks()
        return this.connections.get(connection.connectionId) ?? connection
    }

    private getOrCreateDetector(nodeId: string): PhiAccrualDetector {
        let detector = this.detectors.get(nodeId)
        if (!detector) {
            detector = new PhiAccrualDetector(this.clock)
            this.detectors.set(nodeId, detector)
        }
        return detector
    }
}
