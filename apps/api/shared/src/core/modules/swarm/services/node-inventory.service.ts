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

export class NodeInventoryService extends Context.Service<
    NodeInventoryService,
    NodeInventoryServiceShape
>()('shared/NodeInventoryService') {
    /**
     * Collaborators are constructor arguments: every member of the shape has an
     * empty requirement channel (a lifecycle member cannot yield a tag).
     * `timing` stays overridable for a spec.
     */
    static readonly live = class NodeInventoryServiceImpl
        implements NodeInventoryServiceShape
    {
        private readonly dbNotReady = new DatabaseNotReadyReporter()
        private readonly intervalMs: number
        private readonly startDelayMs: number

        constructor(
            private readonly cluster: Pick<
                SwarmClusterShape,
                'getLocalClusterSnapshot' | 'listSwarmNodes'
            >,
            private readonly inventory: Pick<
                ClusterNodeInventoryRepositoryShape,
                'upsertFromEngine' | 'markMissingNodeDown'
            >,
            private readonly globalClusterNodes: GlobalClusterNodesRepositoryShape,
            timing?: {
                readonly intervalMs: number
                readonly startDelayMs: number
            }
        ) {
            this.intervalMs = timing?.intervalMs ?? SYNC_INTERVAL_MS
            this.startDelayMs = timing?.startDelayMs ?? START_DELAY_MS
        }

        /** The shared enrollment is best-effort: a database that is not up yet is reported once, then quietly retried. */
        private enroll(options?: {
            swarmNodeId?: string
        }): Effect.Effect<void> {
            const { dbNotReady, globalClusterNodes } = this
            return globalClusterNodes.enrollLocalNode(options).pipe(
                Effect.asVoid,
                Effect.catch((failure) =>
                    dbNotReady.reportEffect(
                        'Global node enrollment failed',
                        failure.message,
                        failure.cause ?? failure
                    )
                )
            )
        }

        syncOnce(): Effect.Effect<number, SyncFailure> {
            const { cluster, inventory } = this
            return Effect.gen({ self: this }, function* () {
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

                // Keep the shared cluster_nodes enrollment fresh (heartbeat) on every sweep. Pass the Swarm node ID so the
                // fleet API can return it for navigation.
                yield* this.enroll({ swarmNodeId: snapshot.localNode.nodeId })
                return nodes.length
            })
        }

        // Enroll the LOCAL platform node into the shared cluster_nodes table IMMEDIATELY (not after the first sweep) so mesh
        // resource-ownership inserts (FK → cluster_nodes.node_id) never fail at registration. Not awaited: the database may
        // not be up yet.
        onStart(): Effect.Effect<void> {
            return Effect.forkDetach(this.enroll()).pipe(Effect.asVoid)
        }

        run(): Effect.Effect<never> {
            const { intervalMs, startDelayMs } = this
            return Effect.gen({ self: this }, function* () {
                yield* Effect.sleep(startDelayMs)
                for (;;) {
                    yield* this.syncOnce().pipe(
                        Effect.catch((error) =>
                            Effect.logWarning(
                                `Fleet inventory sync failed: ${error instanceof Error ? error.message : String(error)}`
                            )
                        )
                    )
                    yield* Effect.sleep(intervalMs)
                }
            })
        }
    }
}
