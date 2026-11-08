/**
 * GlobalClusterNodesRepository — enrolls the LOCAL platform node into the shared (Postgres) `cluster_nodes` table.
 *
 * Why: `resource_ownership_index.owner_node_id` and `cluster_join_grants` have hard FKs → `cluster_nodes.node_id` (the
 * platform UUID). If the node is never enrolled, every mesh resource registration fails with a foreign key violation. The
 * fleet view (`FleetRepository.listServersWithMetrics`) also reads this table.
 *
 * The row is keyed by the PLATFORM node UUID (`SystemMeshConfigService.getNodeId()`, same as `node_config.nodeId`) — NOT
 * the docker engine node id (non-uuid).
 */

import { Context, Effect } from 'effect'

import { clusterNodes } from '@deployer/nest-schema/global/fleet/cluster'

import {
    storage,
    type DatabasePort,
    type StorageFailure,
} from '../../database/storage'

import type { SystemMeshConfigServiceShape } from '../../mesh/services/system-mesh-config.service'

export type GlobalClusterNodesRepositoryShape = {
    /**
     * Upsert the local platform node (idempotent by the unique `node_id`). Resolves true when the node is enrolled, false
     * when its identity is unresolvable (callers treat that as best-effort).
     */
    readonly enrollLocalNode: (options?: {
        swarmNodeId?: string
    }) => Effect.Effect<boolean, StorageFailure>
}

/** The mesh-identity fields this repository reads, and nothing else. */
type MeshIdentity = Pick<
    SystemMeshConfigServiceShape,
    'getNodeId' | 'getNodeServerUrl'
>

export class GlobalClusterNodesRepository extends Context.Service<
    GlobalClusterNodesRepository,
    GlobalClusterNodesRepositoryShape
>()('shared/GlobalClusterNodesRepository') {
    /**
     * Both collaborators are constructor arguments: the shape's channel is
     * `StorageFailure` alone, and yielding a tag here would widen it.
     */
    static readonly live = class GlobalClusterNodesRepositoryImpl
        implements GlobalClusterNodesRepositoryShape
    {
        constructor(
            private readonly database: Context.Service.Shape<
                typeof DatabasePort
            >,
            private readonly meshConfig: MeshIdentity
        ) {}

        enrollLocalNode(options?: {
            swarmNodeId?: string
        }): Effect.Effect<boolean, StorageFailure> {
            const { database, meshConfig } = this
            return Effect.gen(function* () {
                const nodeId = meshConfig.getNodeId()
                if (nodeId.length === 0) return false

                const serverUrl =
                    meshConfig.getNodeServerUrl() ?? 'http://localhost'
                const displayName = `node-${nodeId.slice(0, 8)}`
                const now = new Date()
                yield* storage(database, (db) =>
                    db
                        .insert(clusterNodes)
                        .values({
                            nodeId,
                            serverUrl,
                            displayName,
                            swarmNodeId: options?.swarmNodeId ?? null,
                            status: 'active',
                            healthy: true,
                            lastSeenAt: now,
                            updatedAt: now,
                        })
                        .onConflictDoUpdate({
                            target: clusterNodes.nodeId,
                            set: {
                                serverUrl,
                                displayName,
                                swarmNodeId: options?.swarmNodeId ?? undefined,
                                status: 'active',
                                healthy: true,
                                lastSeenAt: now,
                                updatedAt: now,
                            },
                        })
                )
                return true
            })
        }
    }
}
