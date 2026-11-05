import { Context, Effect } from 'effect'

import { MeshNoReplica } from '../mesh.errors'
import { MeshDirectoryRepository } from '../repositories/directory.repository'
import { resolveReplica } from '../rules/resolve-replica'

import { MeshClock } from './mesh-clock.service'
import { NodeIdentity } from './node-identity.service'

import type { ReplicaRecord, Resolution } from '../rules/replica-record'

/** What a replica announces. The agent adds the node, the generation and the expiry. */
export type ReplicaRegistration = {
    readonly service: string
    readonly replicaId: string
    readonly address: string
    readonly load: number
    readonly keys: readonly string[]
    readonly ttlMs: number
}

export type ReplicaQuery = {
    readonly service: string
    readonly key?: string
    /** Replicas the caller already tried; never returned. */
    readonly exclude?: readonly string[]
    /** Serve only from this agent's node. */
    readonly localOnly?: boolean
}

export type MeshDirectoryShape = {
    readonly register: (
        registration: ReplicaRegistration
    ) => Effect.Effect<
        ReplicaRecord,
        never,
        MeshDirectoryRepository | NodeIdentity | MeshClock
    >
    readonly unregister: (
        replicaId: string
    ) => Effect.Effect<boolean, never, MeshDirectoryRepository>
    readonly get: (
        replicaId: string
    ) => Effect.Effect<
        ReplicaRecord | undefined,
        never,
        MeshDirectoryRepository | MeshClock
    >
    readonly snapshot: () => Effect.Effect<
        readonly ReplicaRecord[],
        never,
        MeshDirectoryRepository | MeshClock
    >
    /**
     * Takes in the replicas another agent knows of. Replicas of this node are never taken from gossip: they register
     * here, so this agent is their authority and a peer's stale copy cannot overwrite them. Returns how many changed.
     */
    readonly merge: (
        records: readonly ReplicaRecord[]
    ) => Effect.Effect<
        number,
        never,
        MeshDirectoryRepository | NodeIdentity | MeshClock
    >
    readonly resolve: (
        query: ReplicaQuery
    ) => Effect.Effect<
        Resolution,
        MeshNoReplica,
        MeshDirectoryRepository | NodeIdentity | MeshClock
    >
}

/**
 * The agent's view of every replica of every service.
 *
 * A registration is stamped here, not trusted: the node is this agent's own, the generation grows with every refresh
 * of the same replica, and the expiry comes from the agent's clock, so a replica can neither claim another node nor
 * outlive its own heartbeat.
 */
export class MeshDirectory extends Context.Service<
    MeshDirectory,
    MeshDirectoryShape
>()('node-agent/MeshDirectory') {
    static readonly live = class MeshDirectoryImpl implements MeshDirectoryShape {
        register(registration: ReplicaRegistration) {
            return Effect.gen(function* () {
                const repository = yield* MeshDirectoryRepository
                const { nodeId } = yield* NodeIdentity
                const clock = yield* MeshClock

                const now = clock.now()
                const current = yield* repository.get(
                    registration.replicaId,
                    now
                )
                const record: ReplicaRecord = {
                    service: registration.service,
                    replicaId: registration.replicaId,
                    nodeId,
                    address: registration.address,
                    load: registration.load,
                    keys: registration.keys,
                    generation: (current?.generation ?? 0) + 1,
                    expiresAt: now + registration.ttlMs,
                }
                yield* repository.upsert(record)
                return record
            })
        }

        unregister(replicaId: string) {
            return Effect.gen(function* () {
                const repository = yield* MeshDirectoryRepository
                return yield* repository.remove(replicaId)
            })
        }

        get(replicaId: string) {
            return Effect.gen(function* () {
                const repository = yield* MeshDirectoryRepository
                const clock = yield* MeshClock
                return yield* repository.get(replicaId, clock.now())
            })
        }

        snapshot() {
            return Effect.gen(function* () {
                const repository = yield* MeshDirectoryRepository
                const clock = yield* MeshClock
                return yield* repository.snapshot(clock.now())
            })
        }

        merge(records: readonly ReplicaRecord[]) {
            return Effect.gen(function* () {
                const repository = yield* MeshDirectoryRepository
                const { nodeId } = yield* NodeIdentity
                const clock = yield* MeshClock

                const now = clock.now()
                let changed = 0
                for (const record of records) {
                    if (
                        record.nodeId !== nodeId &&
                        record.expiresAt > now &&
                        (yield* repository.upsert(record))
                    ) {
                        changed += 1
                    }
                }
                return changed
            })
        }

        resolve(query: ReplicaQuery) {
            return Effect.gen(function* () {
                const repository = yield* MeshDirectoryRepository
                const { nodeId } = yield* NodeIdentity
                const clock = yield* MeshClock

                const now = clock.now()
                const records = yield* repository.snapshot(now)
                const resolution = resolveReplica(records, {
                    ...query,
                    localNode: nodeId,
                    now,
                })
                if (!resolution) {
                    return yield* new MeshNoReplica({ service: query.service })
                }
                return resolution
            })
        }
    }
}
