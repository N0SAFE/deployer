import { Context, Effect, Layer } from 'effect'

import {
    ClusterNodeRepository,
    type ClusterNodeRepositoryShape,
} from '@deployer/node-state'

import { SwarmCluster, type SwarmClusterShape } from '../cluster/swarm-cluster'
import { SwarmElectionConfigService, type SwarmElectionConfig } from '../config'

import {
    isEligibleAsMaster,
    scoreCandidate,
    selectMasterWinner,
    type MasterCandidateMetrics,
} from './master-scorer'
import { isQuorumIntact, planQuorum } from './quorum-planner'

export const MASTER_CHANGED_EVENT = 'cluster.master-changed'

export type MasterChangedEvent = {
    readonly nodeId: string
    readonly term: number
    readonly electedAt: string
    readonly reason: string
}

/** Seam for pushing leadership changes to consumers (the mesh stream, the UI). */
export type LeadershipEventSink = {
    readonly notifyMasterChanged: (
        event: MasterChangedEvent
    ) => Effect.Effect<void>
}

/** Candidate metrics for scoring. The engine-probe fallback is built in; a mesh-RTT provider plugs in here. */
export type ClusterMetricsProvider = {
    readonly getCandidateMetrics: () => Effect.Effect<
        MasterCandidateMetrics[],
        unknown
    >
}

export type SwarmLeadershipShape = {
    /** One full election pass. Public so a test drives it directly instead of waiting on intervals. */
    readonly evaluateNow: () => Effect.Effect<void, unknown>
}

/**
 * Master election, watchdog and takeover for the platform's controlling manager.
 *
 * An adaptive evaluation loop (stable or volatile cadence), candidate scoring, odd-quorum planning with
 * a Raft-intactness gate, a single-winner compare-and-set claim, cooldown and a hysteresis threshold
 * (no flapping), master heartbeat refresh with a watchdog grace, step-down when the persisted view says
 * leadership was lost, and audit history plus a `master-changed` notification.
 */
export class SwarmLeadership extends Context.Service<
    SwarmLeadership,
    SwarmLeadershipShape
>()('swarm/SwarmLeadership') {
    /**
     * Runs the election loop for the lifetime of the layer's scope. The package has no timing defaults:
     * the right cadence depends on the fleet's size and network, which only the app knows.
     */
    static readonly layer = (hooks: {
        readonly metricsProvider: ClusterMetricsProvider | null
        readonly eventSink: LeadershipEventSink | null
    }): Layer.Layer<
        SwarmLeadership,
        never,
        SwarmCluster | ClusterNodeRepository | SwarmElectionConfigService
    > =>
        Layer.effect(
            SwarmLeadership,
            Effect.gen(function* () {
                const leadership = makeSwarmLeadership({
                    cluster: yield* SwarmCluster,
                    clusterNode: yield* ClusterNodeRepository,
                    config: yield* SwarmElectionConfigService,
                    ...hooks,
                })
                yield* Effect.forkScoped(leadership.run)
                return { evaluateNow: leadership.evaluateNow }
            })
        )
}

export function makeSwarmLeadership(deps: {
    readonly cluster: SwarmClusterShape
    readonly clusterNode: ClusterNodeRepositoryShape
    readonly config: SwarmElectionConfig
    readonly metricsProvider: ClusterMetricsProvider | null
    readonly eventSink: LeadershipEventSink | null
}): SwarmLeadershipShape & { readonly run: Effect.Effect<void> } {
    const { cluster, clusterNode, config, metricsProvider, eventSink } = deps
    let lastTakeoverAt = 0
    let volatile = false

    /** Engine-probe fallback: the managers `docker node ls` reports, local latency 0, no telemetry. */
    const engineMetrics = Effect.gen(function* () {
        const [snapshot, nodes] = yield* Effect.all(
            [cluster.getLocalClusterSnapshot(), cluster.listSwarmNodes()],
            { concurrency: 'unbounded' }
        )
        const localId = snapshot.localNode.nodeId
        return nodes
            .filter((node) => node.Spec.Role === 'manager')
            .map((node): MasterCandidateMetrics => ({
                nodeId: node.ID,
                latency: node.ID === localId ? 0 : 0.5,
                jitter: node.ID === localId ? 0 : 0.1,
                memoryPressure: 0,
                cpuHeadroom: 1,
                stability: 1,
                isManager: true,
                isCurrentMaster: node.ID === (snapshot.master?.nodeId ?? null),
            }))
    })

    const evaluateNow: SwarmLeadershipShape['evaluateNow'] = Effect.fn(
        'SwarmLeadership.evaluateNow'
    )(function* () {
        const snapshot = yield* cluster.getLocalClusterSnapshot()
        if (snapshot.localNodeState !== 'active') return

        const row = yield* clusterNode.find()
        const currentTerm = row?.masterTerm ?? 0
        const currentMasterId = row?.masterNodeId ?? null
        const currentHeartbeatAt = row?.lastHeartbeatAt
            ? Date.parse(row.lastHeartbeatAt)
            : 0

        if (row?.isMaster && row.masterNodeId === snapshot.localNode.nodeId)
            yield* clusterNode.touchMasterHeartbeat()
        if (row?.isMaster && row.masterNodeId !== snapshot.localNode.nodeId) {
            return yield* Effect.logWarning(
                `Local node believes it is master but persisted master is ${String(row.masterNodeId)} — stepping down`
            )
        }

        const masterStale =
            currentMasterId !== null &&
            currentHeartbeatAt > 0 &&
            Date.now() - currentHeartbeatAt >
                config.heartbeatTtlMs + config.masterGraceMs

        const candidates = metricsProvider
            ? yield* metricsProvider.getCandidateMetrics()
            : yield* engineMetrics
        const winner = selectMasterWinner(candidates)
        const reachableManagers = candidates.filter(
            (candidate) => candidate.isManager
        ).length
        const plan = planQuorum(snapshot.nodeCount, snapshot.managerCount)
        if (
            plan.managerCount > 0 &&
            !isQuorumIntact(reachableManagers, plan.managerCount)
        ) {
            volatile = true
            return yield* Effect.logError(
                `Quorum loss detected (reachable ${String(reachableManagers)}/${String(plan.managerCount)} managers) — election paused`
            )
        }
        volatile = false

        if (!winner)
            return yield* Effect.logDebug('No eligible master candidate')
        if (winner.nodeId === currentMasterId && !masterStale) return // incumbent healthy

        if (!masterStale && currentMasterId !== null) {
            const incumbent = candidates.find(
                (candidate) => candidate.nodeId === currentMasterId
            )
            if (incumbent && isEligibleAsMaster(incumbent)) {
                const delta = scoreCandidate(incumbent) - scoreCandidate(winner)
                if (delta < config.deltaMaster) {
                    return yield* Effect.logDebug(
                        `Incumbent ${currentMasterId} within hysteresis (delta=${delta.toFixed(3)}) — no takeover`
                    )
                }
            }
        }
        if (
            Date.now() - lastTakeoverAt < config.cooldownMs &&
            lastTakeoverAt > 0
        ) {
            return yield* Effect.logDebug(
                'Within election cooldown — skipping takeover'
            )
        }

        const reason = masterStale
            ? 'master_heartbeat_stale'
            : 'better_candidate'
        if (
            !(yield* clusterNode.claimMaster(
                winner.nodeId,
                currentTerm,
                reason
            ))
        )
            return

        const previous = row?.masterNodeId ?? null
        const durationMs =
            previous && row?.lastHeartbeatAt
                ? Math.max(0, Date.now() - Date.parse(row.lastHeartbeatAt))
                : null
        yield* clusterNode.recordMasterHistory(
            winner.nodeId,
            currentTerm + 1,
            reason,
            durationMs
        )
        lastTakeoverAt = Date.now()
        const event: MasterChangedEvent = {
            nodeId: winner.nodeId,
            term: currentTerm + 1,
            electedAt: new Date().toISOString(),
            reason,
        }
        yield* Effect.logInfo(
            `Master elected: ${winner.nodeId} (term=${String(event.term)}, reason=${reason}${previous ? `, previous=${previous}` : ''})`
        )
        if (eventSink) yield* eventSink.notifyMasterChanged(event)
    })

    /** An immediate pass, then one per cadence (shorter while the quorum is in doubt); a failed pass is logged, never fatal. */
    const run = Effect.gen(function* () {
        const pass = evaluateNow().pipe(
            Effect.catch((error: unknown) =>
                Effect.logError(
                    `Election evaluation failed: ${error instanceof Error ? error.message : String(error)}`
                )
            )
        )
        yield* pass
        for (;;) {
            yield* Effect.sleep(
                volatile ? config.evalVolatileMs : config.evalStableMs
            )
            yield* pass
        }
    })

    return { evaluateNow, run }
}
