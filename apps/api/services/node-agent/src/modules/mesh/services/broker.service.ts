import { Context, Effect } from 'effect'

import { MeshNoReplica, MeshRedirectExhausted } from '../mesh.errors'

import { MeshDirectory } from './directory.service'
import { KeyHints } from './key-hints.service'

import type { MeshClock } from './mesh-clock.service'
import type { NodeIdentity } from './node-identity.service'
import type { MeshDirectoryRepository } from '../repositories/directory.repository'
import type { ReplicaRecord } from '../rules/replica-record'

/**
 * What one attempt on one replica came to. The wire layer maps the oRPC error code `MESH_REDIRECT` to `redirect`,
 * so the broker works on data and never has to inspect an error union.
 */
export type CallOutcome<A> =
    | { readonly kind: 'ok'; readonly value: A }
    | {
          readonly kind: 'redirect'
          readonly replicaId: string
          readonly reason: string
      }

export type BrokerInput<A, E, R> = {
    readonly service: string
    readonly key?: string
    /** Never leave this agent's node: the call was pinned to it. */
    readonly localOnly?: boolean
    readonly maxHops: number
    readonly hintTtlMs: number
    readonly invoke: (
        replica: ReplicaRecord
    ) => Effect.Effect<CallOutcome<A>, E, R>
}

export type MeshBrokerShape = {
    readonly call: <A, E, R>(
        input: BrokerInput<A, E, R>
    ) => Effect.Effect<
        A,
        E | MeshNoReplica | MeshRedirectExhausted,
        | R
        | MeshDirectory
        | KeyHints
        | MeshDirectoryRepository
        | NodeIdentity
        | MeshClock
    >
}

/**
 * Sends a call to the right replica and answers `MESH_REDIRECT` itself.
 *
 * The caller never sees a redirect: the agent resolves the named replica, replays the call there, and stops after
 * `maxHops` or when only replicas it already tried are left. A key that was served by a replica is remembered, so
 * the next call for it skips the detour.
 */
export class MeshBroker extends Context.Service<MeshBroker, MeshBrokerShape>()(
    'node-agent/MeshBroker'
) {
    /**
     * The implementation, as a class that implements the shape.
     *
     * Same capabilities, different form: a class can be `useClass`-provided (Nest instantiates it), it can be extended by a
     * spec that wants to override one method, and `implements MeshBrokerShape` makes the compiler check the shape on the
     * class itself rather than on an object literal. It has no constructor dependencies on purpose — everything is yielded
     * from the Effect context when a call runs.
     */
    static readonly live = class MeshBrokerImpl implements MeshBrokerShape {
        call<A, E, R>(input: BrokerInput<A, E, R>) {
            return Effect.gen(function* () {
                const directory = yield* MeshDirectory
                const hints = yield* KeyHints
                const visited = new Set<string>()

                const attempt = (
                    replica: ReplicaRecord,
                    hop: number
                ): Effect.Effect<
                    A,
                    E | MeshNoReplica | MeshRedirectExhausted,
                    | R
                    | MeshDirectoryRepository
                    | NodeIdentity
                    | MeshClock
                    | KeyHints
                    | MeshDirectory
                > =>
                    Effect.gen(function* () {
                        visited.add(replica.replicaId)
                        const outcome = yield* input.invoke(replica)

                        if (outcome.kind === 'ok') {
                            if (input.key !== undefined) {
                                yield* hints.remember(
                                    input.service,
                                    input.key,
                                    replica.replicaId,
                                    input.hintTtlMs
                                )
                            }
                            return outcome.value
                        }

                        if (hop + 1 > input.maxHops) {
                            return yield* new MeshRedirectExhausted({
                                service: input.service,
                                hops: hop + 1,
                            })
                        }

                        const named = yield* directory.get(outcome.replicaId)
                        const next =
                            named && !visited.has(named.replicaId)
                                ? named
                                : yield* directory
                                      .resolve({
                                          service: input.service,
                                          key: input.key,
                                          localOnly: input.localOnly,
                                          exclude: [...visited],
                                      })
                                      .pipe(
                                          Effect.map(
                                              (resolution) => resolution.replica
                                          ),
                                          Effect.catchTag('MeshNoReplica', () =>
                                              Effect.succeed(undefined)
                                          )
                                      )

                        if (!next) {
                            return yield* new MeshRedirectExhausted({
                                service: input.service,
                                hops: hop + 1,
                            })
                        }
                        return yield* attempt(next, hop + 1)
                    })

                const hinted =
                    input.key === undefined
                        ? undefined
                        : yield* hints.lookup(input.service, input.key)
                const hintedReplica =
                    hinted === undefined
                        ? undefined
                        : yield* directory.get(hinted)
                const first =
                    hintedReplica ??
                    (yield* directory.resolve({
                        service: input.service,
                        key: input.key,
                        localOnly: input.localOnly,
                    })).replica

                return yield* attempt(first, 0)
            })
        }
    }
}
