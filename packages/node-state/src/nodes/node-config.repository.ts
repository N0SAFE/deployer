import { randomBytes } from 'node:crypto'

import { Context, Effect, Layer } from 'effect'

import { nodeConfig } from '@deployer/nest-schema/local'

import {
    isMissingTable,
    LocalDatabaseError,
    NodeStateConflict,
} from '../database/errors'
import {
    LocalDatabase,
    type LocalDatabaseShape,
} from '../database/local-database'

export type NodeConfigRow = typeof nodeConfig.$inferSelect

export type NewNodeConfigRow = typeof nodeConfig.$inferInsert

/**
 * A second home for the node's record: the node's agent, once one answers.
 *
 * Both members are total — null means "no answer" (no agent, an agent that predates the record, or a
 * timeout), which is the caller's cue to use the local file instead.
 */
export type NodeConfigRecordStore = {
    readonly read: () => Effect.Effect<NodeConfigRow | null>
    readonly write: (
        row: NewNodeConfigRow
    ) => Effect.Effect<NodeConfigRow | null>
}

export type NodeConfigRepositoryShape = {
    /** This node's own config, or null before it has one (including before the table exists). */
    readonly find: () => Effect.Effect<NodeConfigRow | null, LocalDatabaseError>
    /** Creates or replaces the node's config row and returns it. */
    readonly upsert: (
        data: Omit<typeof nodeConfig.$inferInsert, 'id'>
    ) => Effect.Effect<NodeConfigRow, LocalDatabaseError | NodeStateConflict>
    /** The mesh shared secret, or null when there is no row or the column is empty. */
    readonly getMeshSharedSecret: () => Effect.Effect<
        string | null,
        LocalDatabaseError
    >
    /** The platform secret, or null when there is no row yet or this node has neither generated nor received one. */
    readonly getPlatformSecret: () => Effect.Effect<
        string | null,
        LocalDatabaseError
    >
    /**
     * The platform secret, generated and stored on first use. Null only before the node has a config row at all (an
     * unconfigured node signs nothing yet); never read from the environment.
     *
     * shortcut: two services of one node calling this at the same instant can each store a value and the last write wins
     * (the agent has no compare-and-set); upgrade when the agent's record write takes the expected previous value (SEC-100).
     */
    readonly ensurePlatformSecret: () => Effect.Effect<
        string | null,
        LocalDatabaseError | NodeStateConflict
    >
    /** Merges `peerUrls` into the stored peer snapshot, deduplicated; null when there is no row yet. */
    readonly updateMeshPeers: (
        peerUrls: string[]
    ) => Effect.Effect<
        NodeConfigRow | null,
        LocalDatabaseError | NodeStateConflict
    >
}

/** The node's own config: the cluster decision the setup app records before the global Postgres exists. */
export class NodeConfigRepository extends Context.Service<
    NodeConfigRepository,
    NodeConfigRepositoryShape
>()('node-state/NodeConfigRepository') {
    static readonly layer: Layer.Layer<
        NodeConfigRepository,
        never,
        LocalDatabase
    > = Layer.effect(
        NodeConfigRepository,
        Effect.gen(function* () {
            return makeNodeConfigRepository(yield* LocalDatabase)
        })
    )
}

export function makeNodeConfigRepository(
    database: LocalDatabaseShape
): NodeConfigRepositoryShape {
    const find: NodeConfigRepositoryShape['find'] = () =>
        database
            .use(
                'read node_config',
                (db) => db.select().from(nodeConfig).limit(1).all()[0] ?? null
            )
            .pipe(
                Effect.catch((error: LocalDatabaseError) =>
                    isMissingTable(new Error(error.reason), 'node_config')
                        ? Effect.succeed(null)
                        : Effect.fail(error)
                )
            )

    const upsert: NodeConfigRepositoryShape['upsert'] = (data) =>
        Effect.gen(function* () {
            const now = new Date().toISOString()
            yield* database.use('write node_config', (db) => {
                db.insert(nodeConfig)
                    .values({ id: 1, ...data, updatedAt: now })
                    .onConflictDoUpdate({
                        target: nodeConfig.id,
                        set: { ...data, updatedAt: now },
                    })
                    .run()
            })
            const row = yield* find()
            if (row === null)
                return yield* Effect.fail(
                    new NodeStateConflict({
                        reason: 'NodeConfig upsert succeeded but row was not found',
                    })
                )
            return row
        })

    return nodeConfigOperations({ find, upsert })
}

/**
 * Agent first, local file second: the node's agent owns the record, so an answer it gives IS the row and
 * the local copy is neither read nor written. A silent agent leaves the file as the source, unchanged.
 */
export function makeAgentFirstNodeConfigRepository(
    database: LocalDatabaseShape,
    records: NodeConfigRecordStore
): NodeConfigRepositoryShape {
    const local = makeNodeConfigRepository(database)

    return nodeConfigOperations({
        find: () =>
            records
                .read()
                .pipe(
                    Effect.flatMap((row) =>
                        row === null ? local.find() : Effect.succeed(row)
                    )
                ),
        upsert: (data) =>
            records
                .write(data)
                .pipe(
                    Effect.flatMap((row) =>
                        row === null ? local.upsert(data) : Effect.succeed(row)
                    )
                ),
    })
}

/** The members both homes share: the ones derived from `find`/`upsert`, so they follow the same source. */
function nodeConfigOperations(
    ops: Pick<NodeConfigRepositoryShape, 'find' | 'upsert'>
): NodeConfigRepositoryShape {
    return {
        ...ops,
        getMeshSharedSecret: () =>
            ops.find().pipe(
                Effect.map((row) => {
                    if (row === null) return null
                    const record = row as Record<string, unknown>
                    return (record.meshSharedSecret ??
                        record.mesh_shared_secret ??
                        null) as string | null
                })
            ),
        getPlatformSecret: () =>
            ops.find().pipe(Effect.map((row) => row?.platformSecret ?? null)),
        ensurePlatformSecret: () =>
            Effect.gen(function* () {
                const row = yield* ops.find()
                if (row === null) return null
                if (row.platformSecret !== null && row.platformSecret !== '')
                    return row.platformSecret
                const { id: _id, ...rest } = row
                const now = new Date().toISOString()
                const stored = yield* ops.upsert({
                    ...rest,
                    platformSecret: randomBytes(32).toString('hex'),
                    platformSecretUpdatedAt: now,
                })
                return stored.platformSecret
            }),
        updateMeshPeers: (peerUrls) =>
            Effect.gen(function* () {
                const existing = yield* ops.find()
                if (existing === null) return null
                const merged = [
                    ...new Set([
                        ...(existing.meshUrlsSnapshot ?? []),
                        ...peerUrls,
                    ]),
                ]
                return yield* ops.upsert({
                    ...existing,
                    meshUrlsSnapshot: merged,
                    updatedAt: new Date().toISOString(),
                })
            }),
    }
}
