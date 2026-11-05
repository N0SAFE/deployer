/**
 * NodeInventoryService — periodic fleet inventory sync (SW-030, docs/swarm-orchestration/P3). Every cadence it pulls
 * `docker node ls` through the SDK, upserts each node into the local `cluster_nodes` table, and marks previously-seen nodes
 * that vanished as `down` (drift).
 *
 * Best-effort: an engine/persist failure logs a warning; the platform keeps serving from the last good snapshot. Fully
 * unit-testable with mocks.
 */

import { Context, Effect } from 'effect'

import type { ServiceLifecycleShape } from '@deployer/nest-effect'
import {
    toEngineNodeRow,
    type ClusterNodeInventoryRepositoryShape,
} from '@deployer/node-state'
import type { SwarmClusterShape } from '@deployer/swarm'

import { DatabaseNotReadyReporter } from '../../database/services/db-not-ready'

import type { GlobalClusterNodesRepositoryShape } from '../repositories/global-cluster-nodes.repository'

/** Cadence of the fleet inventory sweep. */
const SYNC_INTERVAL_MS = 30_000
/** Grace before the first sweep so the engine can settle after boot. */
const START_DELAY_MS = 5_000

type SyncFailure =
    | Effect.Error<ReturnType<SwarmClusterShape['getLocalClusterSnapshot']>>
    | Effect.Error<
          ReturnType<ClusterNodeInventoryRepositoryShape['upsertFromEngine']>
      >

export type NodeInventoryServiceShape = ServiceLifecycleShape & {
    /**
     * One sync pass: engine nodes → upsert each → mark vanished as down. Resolves the number of nodes persisted (0 outside an
     * active swarm). Public for tests.
     */
    readonly syncOnce: () => Effect.Effect<number, SyncFailure>
}

type Ports = {
    readonly cluster: Pick<
        SwarmClusterShape,
        'getLocalClusterSnapshot' | 'listSwarmNodes'
    >
    readonly inventory: Pick<
        ClusterNodeInventoryRepositoryShape,
        'upsertFromEngine' | 'markMissingNodeDown'
    >
    readonly globalClusterNodes: GlobalClusterNodesRepositoryShape
    /** Overridable cadences, for a spec. */
    readonly timing?: {
        readonly intervalMs: number
        readonly startDelayMs: number
    }
}

export function makeNodeInventoryService({
    cluster,
    inventory,
    globalClusterNodes,
    timing = { intervalMs: SYNC_INTERVAL_MS, startDelayMs: START_DELAY_MS },
}: Ports): NodeInventoryServiceShape {
    const dbNotReady = new DatabaseNotReadyReporter()

    /** The shared enrollment is best-effort: a database that is not up yet is reported once, then quietly retried. */
    const enroll = (options?: { swarmNodeId?: string }) =>
        globalClusterNodes.enrollLocalNode(options).pipe(
            Effect.asVoid,
            Effect.catch((failure) =>
                dbNotReady.reportEffect(
                    'Global node enrollment failed',
                    failure.message,
                    failure.cause ?? failure
                )
            )
        )

    const syncOnce: NodeInventoryServiceShape['syncOnce'] = () =>
        Effect.gen(function* () {
            // Cluster gate: nothing to inventory outside an active swarm.
            const snapshot = yield* cluster.getLocalClusterSnapshot()
            if (snapshot.localNodeState !== 'active') return 0

            const nodes = yield* cluster.listSwarmNodes()
            for (const node of nodes) {
                yield* inventory.upsertFromEngine(toEngineNodeRow(node))
            }
            const markedDown = yield* inventory.markMissingNodeDown(
                nodes.map((node) => node.ID)
            )
            yield* Effect.logDebug(
                `Fleet inventory synced: ${String(nodes.length)} nodes, ${String(markedDown)} marked down`
            )

            // Keep the shared cluster_nodes enrollment fresh (heartbeat) on every sweep. Pass the Swarm node ID so the fleet
            // API can return it for navigation.
            yield* enroll({ swarmNodeId: snapshot.localNode.nodeId })
            return nodes.length
        })

    return {
        syncOnce,

        // Enroll the LOCAL platform node into the shared cluster_nodes table IMMEDIATELY (not after the first sweep) so mesh
        // resource-ownership inserts (FK → cluster_nodes.node_id) never fail at registration. Not awaited: the database may
        // not be up yet.
        onStart: () => Effect.forkDetach(enroll()).pipe(Effect.asVoid),

        run: () =>
            Effect.gen(function* () {
                yield* Effect.sleep(timing.startDelayMs)
                for (;;) {
                    yield* syncOnce().pipe(
                        Effect.catch((error) =>
                            Effect.logWarning(
                                `Fleet inventory sync failed: ${error instanceof Error ? error.message : String(error)}`
                            )
                        )
                    )
                    yield* Effect.sleep(timing.intervalMs)
                }
            }),
    }
}

export class NodeInventoryService extends Context.Service<
    NodeInventoryService,
    NodeInventoryServiceShape
>()('shared/NodeInventoryService') {}
