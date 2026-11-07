import { eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { nodeNetworkConfig } from '@deployer/nest-schema/global/fleet/node-network-config'

import {
    storage,
    type DatabasePort,
    type StorageFailure,
} from '../../database/storage'

export type NodeNetworkConfigRow = typeof nodeNetworkConfig.$inferSelect

/** The single data-access layer for the global `node_network_config` table. */
export type NodeNetworkConfigRepositoryShape = {
    /** A node's network config row; `null` when never configured. */
    readonly findByNodeId: (
        nodeId: string
    ) => Effect.Effect<NodeNetworkConfigRow | null, StorageFailure>
    /** Every node's network config, oldest update first. */
    readonly list: () => Effect.Effect<NodeNetworkConfigRow[], StorageFailure>
    /** Insert or update on `nodeId` conflict. */
    readonly upsert: (input: {
        nodeId: string
        publicAddress: string | null
        addressKind: 'ip' | 'hostname' | null
    }) => Effect.Effect<void, StorageFailure>
}

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * The connection is a constructor argument (the Effect port, not the Nest service that owns it), so a query reads the
 * CURRENT pool: the global database is a placeholder at boot and is initialised later.
 */
export class NodeNetworkConfigRepository extends Context.Service<
    NodeNetworkConfigRepository,
    NodeNetworkConfigRepositoryShape
>()('shared/NodeNetworkConfigRepository') {
    static readonly live = class NodeNetworkConfigRepositoryImpl
        implements NodeNetworkConfigRepositoryShape
    {
        constructor(
            private readonly database: Context.Service.Shape<
                typeof DatabasePort
            >
        ) {}

        findByNodeId(
            nodeId: string
        ): ReturnType<NodeNetworkConfigRepositoryShape['findByNodeId']> {
            return storage(this.database, (db) =>
                db
                    .select()
                    .from(nodeNetworkConfig)
                    .where(eq(nodeNetworkConfig.nodeId, nodeId))
                    .limit(1)
            ).pipe(Effect.map((rows) => rows[0] ?? null))
        }

        list(): ReturnType<NodeNetworkConfigRepositoryShape['list']> {
            return storage(this.database, (db) =>
                db
                    .select()
                    .from(nodeNetworkConfig)
                    .orderBy(nodeNetworkConfig.updatedAt)
            )
        }

        upsert(
            input: Parameters<NodeNetworkConfigRepositoryShape['upsert']>[0]
        ): ReturnType<NodeNetworkConfigRepositoryShape['upsert']> {
            const values = {
                nodeId: input.nodeId,
                publicAddress: input.publicAddress,
                addressKind: input.addressKind,
                updatedAt: new Date(),
            }
            return storage(this.database, (db) =>
                db
                    .insert(nodeNetworkConfig)
                    .values(values)
                    .onConflictDoUpdate({
                        target: nodeNetworkConfig.nodeId,
                        set: values,
                    })
            ).pipe(Effect.asVoid)
        }
    }
}
