import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    makeSwarmLeadership,
    type ClusterMetricsProvider,
} from './swarm-leadership'

import type { SwarmClusterShape } from '../cluster/swarm-cluster'
import type { SwarmElectionConfig } from '../config'

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

const config: SwarmElectionConfig = {
    evalStableMs: 10_000,
    evalVolatileMs: 1_000,
    cooldownMs: 0,
    deltaMaster: 0.1,
    heartbeatTtlMs: 5_000,
    masterGraceMs: 1_000,
}

const candidate = (
    nodeId: string,
    quality: number,
    isCurrentMaster = false
) => ({
    nodeId,
    latency: 1 - quality,
    jitter: 1 - quality,
    memoryPressure: 1 - quality,
    cpuHeadroom: quality,
    stability: quality,
    isManager: true,
    isCurrentMaster,
})

function build(options: {
    row?: Record<string, unknown> | null
    metrics?: ReturnType<typeof candidate>[]
    claim?: boolean
    state?: string
    nodeCount?: number
    managerCount?: number
}) {
    const cluster = {
        getLocalClusterSnapshot: () =>
            Effect.succeed({
                localNodeState: options.state ?? 'active',
                nodeCount: options.nodeCount ?? 3,
                managerCount: options.managerCount ?? 3,
                localNode: { nodeId: 'n1' },
                master: null,
            }),
        listSwarmNodes: () => Effect.succeed([]),
    } as unknown as SwarmClusterShape
    const clusterNode = {
        find: vi.fn(() => Effect.succeed(options.row ?? null)),
        claimMaster: vi.fn(() => Effect.succeed(options.claim ?? true)),
        touchMasterHeartbeat: vi.fn(() => Effect.void),
        recordMasterHistory: vi.fn(() => Effect.void),
    }
    const notifyMasterChanged = vi.fn(() => Effect.void)
    const metricsProvider: ClusterMetricsProvider = {
        getCandidateMetrics: () => Effect.succeed(options.metrics ?? []),
    }
    const leadership = makeSwarmLeadership({
        cluster,
        clusterNode: clusterNode as never,
        config,
        metricsProvider,
        eventSink: { notifyMasterChanged },
    })
    return { leadership, clusterNode, notifyMasterChanged }
}

describe('SwarmLeadership.evaluateNow', () => {
    it('does nothing while the engine is not in an active cluster', async () => {
        const { leadership, clusterNode } = build({ state: 'inactive' })

        await run(leadership.evaluateNow())

        expect(clusterNode.claimMaster).not.toHaveBeenCalled()
    })

    it('elects the best candidate when there is no master yet, recording history and notifying', async () => {
        const { leadership, clusterNode, notifyMasterChanged } = build({
            row: null,
            metrics: [
                candidate('n1', 0.9),
                candidate('n2', 0.5),
                candidate('n3', 0.4),
            ],
        })

        await run(leadership.evaluateNow())

        expect(clusterNode.claimMaster).toHaveBeenCalledWith(
            'n1',
            0,
            'better_candidate'
        )
        expect(clusterNode.recordMasterHistory).toHaveBeenCalledWith(
            'n1',
            1,
            'better_candidate',
            null
        )
        expect(notifyMasterChanged).toHaveBeenCalledWith(
            expect.objectContaining({ nodeId: 'n1', term: 1 })
        )
    })

    it('leaves a healthy incumbent alone', async () => {
        const { leadership, clusterNode } = build({
            row: {
                masterNodeId: 'n1',
                masterTerm: 2,
                isMaster: false,
                lastHeartbeatAt: new Date().toISOString(),
            },
            metrics: [
                candidate('n1', 0.9, true),
                candidate('n2', 0.5),
                candidate('n3', 0.4),
            ],
        })

        await run(leadership.evaluateNow())

        expect(clusterNode.claimMaster).not.toHaveBeenCalled()
    })

    it('takes over from a master whose heartbeat went stale', async () => {
        const stale = new Date(Date.now() - 60_000).toISOString()
        const { leadership, clusterNode } = build({
            row: {
                masterNodeId: 'n3',
                masterTerm: 2,
                isMaster: false,
                lastHeartbeatAt: stale,
            },
            metrics: [candidate('n1', 0.9), candidate('n3', 0.2, true)],
        })

        await run(leadership.evaluateNow())

        expect(clusterNode.claimMaster).toHaveBeenCalledWith(
            'n1',
            2,
            'master_heartbeat_stale'
        )
    })

    it('pauses the election when the quorum is lost', async () => {
        const { leadership, clusterNode } = build({
            metrics: [candidate('n1', 0.9)],
            nodeCount: 3,
            managerCount: 3,
        })

        await run(leadership.evaluateNow())

        expect(clusterNode.claimMaster).not.toHaveBeenCalled()
    })

    it('steps down when the persisted master is someone else', async () => {
        const { leadership, clusterNode } = build({
            row: {
                masterNodeId: 'n2',
                masterTerm: 3,
                isMaster: true,
                lastHeartbeatAt: new Date().toISOString(),
            },
            metrics: [candidate('n1', 0.9)],
        })

        await run(leadership.evaluateNow())

        expect(clusterNode.claimMaster).not.toHaveBeenCalled()
    })
})
