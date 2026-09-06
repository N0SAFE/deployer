/**
 * SwarmLeadershipService — master election + watchdog + takeover for the
 * platform's controlling manager (docs/swarm-orchestration/02 + 03).
 *
 * Consolidated runtime for P4/P5:
 *  - adaptive evaluation loop (stable/volatile cadence from env),
 *  - candidate scoring via `ClusterMetricsProvider` + pure `MasterScorer`,
 *  - odd-quorum planning + Raft-intactness gate (`QuorumPlanner`),
 *  - single-winner CAS via `ClusterNodeRepository.claimMaster`,
 *  - cooldown + `δ_master` hysteresis (no flapping),
 *  - master heartbeat refresh + watchdog SUSPECT/grace → re-election,
 *  - step-down when the persisted view says we lost leadership,
 *  - audit history recording + `master-changed` notification sink.
 *
 * The provider is the mesh seam: today it maps engine probes (self node +
 * `docker node ls`); a mesh-RTT implementation (authenticated ping) plugs in
 * later with zero changes to this service.
 */

import { Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { MasterCandidateMetrics } from "./master-scorer";
import { isEligibleAsMaster, scoreCandidate, selectMasterWinner } from "./master-scorer";
import { planQuorum, isQuorumIntact } from "./quorum-planner";
import { SwarmClusterService } from "../services/swarm-cluster.service";
import { ClusterNodeRepository } from "../repositories/cluster-node.repository";
import { EnvService } from "@/config/env/env.service";

export const MASTER_CHANGED_EVENT = "cluster.master-changed";

export interface MasterChangedEvent {
    nodeId: string;
    term: number;
    electedAt: string;
    reason: string;
}

/** Seam for pushing leadership changes to consumers (mesh stream, UI, …). */
export interface LeadershipEventSink {
    notifyMasterChanged(event: MasterChangedEvent): void;
}

/** Provider of candidate metrics for scoring. Real impl maps engine probes. */
export interface ClusterMetricsProvider {
    getCandidateMetrics(): Promise<MasterCandidateMetrics[]>;
}

@Injectable()
export class SwarmLeadershipService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(SwarmLeadershipService.name);
    private timer: NodeJS.Timeout | null = null;
    private lastTakeoverAt = 0;
    private volatile = false;

    constructor(
        private readonly clusterService: SwarmClusterService,
        private readonly clusterNodeRepository: ClusterNodeRepository,
        private readonly envService: EnvService,
        /** Injected by the module; default = engine-probe mapper. */
        @Optional() private readonly metricsProvider?: ClusterMetricsProvider,
        @Optional() private readonly eventSink?: LeadershipEventSink,
    ) {}

    onModuleInit(): void {
        void this.evaluateNow().catch((error: unknown) => {
            this.logger.error(`Initial election evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        this.scheduleNext();
    }

    onModuleDestroy(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private get evalStableMs(): number {
        return this.envService.get("SWARM_ELECTION_EVAL_STABLE_MS");
    }

    private get evalVolatileMs(): number {
        return this.envService.get("SWARM_ELECTION_EVAL_VOLATILE_MS");
    }

    private get cooldownMs(): number {
        return this.envService.get("SWARM_ELECTION_COOLDOWN_MS");
    }

    private get deltaMaster(): number {
        return this.envService.get("SWARM_ELECTION_DELTA_MASTER");
    }

    private scheduleNext(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            void this.evaluateNow()
                .catch((error: unknown) => {
                    this.logger.error(`Election evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
                })
                .finally(() => { this.scheduleNext(); });
        }, this.volatile ? this.evalVolatileMs : this.evalStableMs);
    }

    /**
     * One full election pass. Public for testability (tests drive it directly
     * instead of waiting on intervals).
     */
    async evaluateNow(): Promise<void> {
        // Cluster gate: nothing to elect outside an active swarm.
        const snapshot = await this.clusterService.getLocalClusterSnapshot();
        if (snapshot.localNodeState !== "active") {
            return;
        }

        const row = this.clusterNodeRepository.find();
        const currentTerm = row?.masterTerm ?? 0;
        const currentMasterId = row?.masterNodeId ?? null;
        const currentHeartbeatAt = row?.lastHeartbeatAt ? Date.parse(row.lastHeartbeatAt) : 0;

        // Watchdog: if we ARE the recorded master, staying healthy means
        // refreshing the heartbeat.
        if (row?.isMaster && row.masterNodeId === snapshot.localNode.nodeId) {
            this.clusterNodeRepository.touchMasterHeartbeat();
        }

        // Step-down (P5): we believe we are master but the persisted view
        // disagrees (lost an election elsewhere) → stand down, never fight.
        if (row?.isMaster && row.masterNodeId !== snapshot.localNode.nodeId) {
            this.logger.warn(
                `Local node believes it is master but persisted master is ${String(row.masterNodeId)} — stepping down`,
            );
            return;
        }

        // Watchdog failure detection: stale master heartbeat + quorum intact
        // → force re-election on the next evaluation (SUSPECT → confirmed).
        const ttlMs = this.envService.get("SWARM_HEARTBEAT_TTL_MS");
        const graceMs = this.envService.get("SWARM_MASTER_GRACE_MS");
        const masterStale =
            currentMasterId !== null &&
            currentHeartbeatAt > 0 &&
            Date.now() - currentHeartbeatAt > ttlMs + graceMs;

        // Metrics → scoring.
        const candidates = this.metricsProvider
            ? await this.metricsProvider.getCandidateMetrics()
            : await this.engineMetrics();
        const winner = selectMasterWinner(candidates);

        // Quorum guards (P5 §4): never elect into a lost-quorum cluster.
        const reachableManagers = candidates.filter((c) => c.isManager).length;
        const plan = planQuorum(snapshot.nodeCount, snapshot.managerCount);
        if (plan.managerCount > 0 && !isQuorumIntact(reachableManagers, plan.managerCount)) {
            this.logger.error(
                `Quorum loss detected (reachable ${String(reachableManagers)}/${String(plan.managerCount)} managers) — election paused`,
            );
            this.volatile = true;
            return;
        }
        this.volatile = false;

        if (!winner) {
            this.logger.debug("No eligible master candidate");
            return;
        }

        if (winner.nodeId === currentMasterId && !masterStale) {
            return; // incumbent healthy — nothing to do
        }

        // Hysteresis: a healthy incumbent is not thrashed by a marginal edge.
        if (!masterStale && currentMasterId !== null) {
            const incumbent = candidates.find((c) => c.nodeId === currentMasterId);
            if (incumbent && isEligibleAsMaster(incumbent)) {
                const delta = scoreCandidate(incumbent) - scoreCandidate(winner);
                if (delta < this.deltaMaster) {
                    this.logger.debug(
                        `Incumbent ${currentMasterId} within hysteresis (delta=${delta.toFixed(3)}) — no takeover`,
                    );
                    return;
                }
            }
        }

        // Cooldown between takeovers (anti-flap).
        if (Date.now() - this.lastTakeoverAt < this.cooldownMs && this.lastTakeoverAt > 0) {
            this.logger.debug("Within election cooldown — skipping takeover");
            return;
        }

        // Single-winner CAS.
        const reason = masterStale ? "master_heartbeat_stale" : "better_candidate";
        if (this.clusterNodeRepository.claimMaster(winner.nodeId, currentTerm, reason)) {
            const previous = row?.masterNodeId ?? null;
            const durationMs = previous && row?.lastHeartbeatAt
                ? Math.max(0, Date.now() - Date.parse(row.lastHeartbeatAt))
                : null;

            this.clusterNodeRepository.recordMasterHistory(winner.nodeId, currentTerm + 1, reason, durationMs);
            this.lastTakeoverAt = Date.now();

            const event: MasterChangedEvent = {
                nodeId: winner.nodeId,
                term: currentTerm + 1,
                electedAt: new Date().toISOString(),
                reason,
            };
            this.logger.log(
                `Master elected: ${winner.nodeId} (term=${String(event.term)}, reason=${reason}${previous ? `, previous=${previous}` : ""})`,
            );
            this.eventSink?.notifyMasterChanged(event);
        }
    }

    /** Engine-probe fallback metrics provider (self-latency 0, no telemetry). */
    private async engineMetrics(): Promise<MasterCandidateMetrics[]> {
        const [snapshot, nodes] = await Promise.all([
            this.clusterService.getLocalClusterSnapshot(),
            this.clusterService.listSwarmNodes(),
        ]);

        const localId = snapshot.localNode.nodeId;
        return nodes
            .filter((node) => node.Spec.Role === "manager")
            .map((node) => ({
                nodeId: node.ID,
                latency: node.ID === localId ? 0 : 0.5,
                jitter: node.ID === localId ? 0 : 0.1,
                memoryPressure: 0,
                cpuHeadroom: 1,
                stability: 1,
                isManager: true,
                isCurrentMaster: node.ID === (snapshot.master?.nodeId ?? null),
            }));
    }
}
