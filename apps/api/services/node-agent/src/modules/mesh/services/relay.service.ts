import { ORPCError } from '@orpc/client'
import { Context, Effect, Option } from 'effect'

import {
    type MeshRelayEvent,
    type MeshRelayInput,
    grantDirect,
    readRedirect,
} from '@deployer/node-agent-contracts'

import { relayDebug } from '../../../config/node-agent.env'
import {
    MeshNoReplica,
    MeshNoRoute,
    MeshRedirectExhausted,
    MeshRelayLoop,
} from '../mesh.errors'
import { leaseReason } from '../rules/lease-policy'

import { AgentLoad } from './agent-load.service'
import { type CallOutcome, MeshBroker } from './broker.service'
import { MeshDirectory } from './directory.service'
import { LeaseSigner } from './lease-signer.service'
import { NodeAgents, type KnownAgent } from './node-agents.service'
import { NodeIdentity } from './node-identity.service'
import { RelayMetrics } from './relay-metrics.service'
import { RelaySettings } from './relay-settings.service'
import { ReplicaLinks } from './replica-links.service'

import type { AgentLinkFactory } from './agent-link-factory.service'
import type { KeyHints } from './key-hints.service'
import type { MeshClock } from './mesh-clock.service'
import type { MeshDirectoryRepository } from '../repositories/directory.repository'

/** What a relayed call came to. A stream stays a stream: the agent forwards it element by element, never buffers it. */
export type RelayOutcome =
    | { readonly kind: 'value'; readonly value: unknown }
    | { readonly kind: 'stream'; readonly items: AsyncIterator<unknown> }
    /** Another node's agent already answered in the relay's own events; they pass through untouched. */
    | {
          readonly kind: 'events'
          readonly events: AsyncIterator<MeshRelayEvent>
      }

export type MeshRelayShape = {
    readonly relay: (
        request: MeshRelayInput
    ) => Effect.Effect<
        RelayOutcome,
        | ORPCError<string, unknown>
        | MeshNoReplica
        | MeshRedirectExhausted
        | MeshNoRoute
        | MeshRelayLoop,
        | MeshDirectory
        | MeshBroker
        | KeyHints
        | MeshDirectoryRepository
        | NodeIdentity
        | MeshClock
        | NodeAgents
        | ReplicaLinks
        | AgentLoad
        | LeaseSigner
        | AgentLinkFactory
        | RelaySettings
        | RelayMetrics
    >
}

const MAX_HOPS = 3
const HINT_TTL_MS = 5_000
const RELAY_PATH = ['relay', 'call']

const isAsyncIterator = (value: unknown): value is AsyncIterator<unknown> =>
    typeof value === 'object' &&
    value !== null &&
    'next' in value &&
    typeof value.next === 'function'

/** Whether the failure is the target's own answer: it reached the node and said no. Never a reason to try elsewhere. */
const isTargetAnswer = (error: unknown): error is ORPCError<string, unknown> =>
    error instanceof ORPCError ||
    (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        'data' in error)

/** An upstream failure as the oRPC error the caller should see: the target's own errors keep their code and data. */
const toOrpcError = (error: unknown): ORPCError<string, unknown> =>
    isTargetAnswer(error)
        ? error
        : new ORPCError('BAD_GATEWAY', {
              message:
                  error instanceof Error
                      ? error.message
                      : 'The target could not be reached',
              cause: error,
          })

/** Counts a stream as open until it ends, however it ends, so the load the lease policy reads is true. */
function trackStream(
    items: AsyncIterator<unknown>,
    load: { streamOpened: () => void; streamClosed: () => void }
): AsyncIterator<unknown> {
    load.streamOpened()
    let closed = false
    const close = () => {
        if (!closed) {
            closed = true
            load.streamClosed()
        }
    }
    return {
        async next() {
            try {
                const step = await items.next()
                if (step.done) {
                    close()
                }
                return step
            } catch (error) {
                close()
                throw error
            }
        },
        async return(value) {
            close()
            return (
                (await items.return?.(value)) ?? {
                    done: true as const,
                    value: undefined,
                }
            )
        },
        async throw(error) {
            close()
            return (
                (await items.throw?.(error)) ??
                Promise.reject(toOrpcError(error))
            )
        },
    }
}

/**
 * The direct hop: this agent's own link to `target`, carrying the call as it stands.
 *
 * The failure is kept raw on purpose: the relay has to tell "the link never opened" (forward it) from "the node said no"
 * (return it), and `toOrpcError` would erase that distinction by wrapping both as `BAD_GATEWAY`. A call that outlives
 * `callTimeoutMs` is a transport failure too: the peer hung, so the relay forwards or answers `MeshNoRoute`.
 */
const direct = (target: string, request: MeshRelayInput) =>
    Effect.gen(function* () {
        const agents = yield* NodeAgents
        const settings = yield* RelaySettings
        const link = yield* agents
            .linkTo(target)
            .pipe(Effect.mapError((error): unknown => error))
        return yield* Effect.tryPromise({
            try: () =>
                link.call(RELAY_PATH, request, {
                    context: { headers: request.headers ?? {} },
                }) as Promise<AsyncIterator<MeshRelayEvent>>,
            catch: (error): unknown => error,
        }).pipe(Effect.timeout(settings.callTimeoutMs))
    })

/**
 * The indirect hop: hand the call to an agent that may reach `target`, and let it run this same algorithm.
 *
 * Candidates are the known agents this call has not been through, minus the ones known to be unreachable. The agents
 * that taught this one about the target come first: they demonstrably exchange with it. Then node id, so the choice is
 * the same on every call. At most `nextHopAttempts` are tried; the first answer wins and the rest are never called.
 */
const forward = (
    target: string,
    request: MeshRelayInput,
    selfId: string,
    visited: readonly string[],
    ttl: number
) =>
    Effect.gen(function* () {
        const metrics = yield* RelayMetrics
        if (ttl <= 0) {
            yield* metrics.count('noRoute')
            return yield* Effect.fail(
                new MeshNoRoute({ nodeId: target, hops: [...visited] })
            )
        }

        const agents = yield* NodeAgents
        const settings = yield* RelaySettings
        const teachers = new Set(yield* agents.sourcesOf(target))
        const skipped = new Set([selfId, target, ...visited])

        const reachable: KnownAgent[] = []
        for (const agent of yield* agents.known()) {
            if (skipped.has(agent.nodeId)) continue
            if (yield* agents.isUnreachable(agent.nodeId)) continue
            reachable.push(agent)
        }
        const ordered = reachable.sort(
            (left, right) =>
                Number(teachers.has(right.nodeId)) -
                    Number(teachers.has(left.nodeId)) ||
                left.nodeId.localeCompare(right.nodeId)
        )

        const tried: string[] = []
        for (const candidate of ordered.slice(0, settings.nextHopAttempts)) {
            tried.push(candidate.nodeId)
            const next: MeshRelayInput = {
                ...request,
                via: { visited: [...visited, selfId], ttl: ttl - 1 },
            }
            const answer = yield* direct(candidate.nodeId, next).pipe(
                Effect.option
            )
            if (Option.isSome(answer)) {
                yield* metrics.count('forwarded')
                if (relayDebug()) {
                    console.warn(
                        `[node-agent] relayed ${target} through ${candidate.nodeId} (${String(ttl - 1)} hops left)`
                    )
                }
                return {
                    kind: 'events',
                    events: answer.value,
                } as const satisfies RelayOutcome
            }
            if (relayDebug()) {
                console.warn(
                    `[node-agent] next hop ${candidate.nodeId} did not answer for ${target}; trying another`
                )
            }
        }

        yield* metrics.count('noRoute')
        console.warn(
            `[node-agent] no route to node ${target} from ${selfId}; hops tried: ${tried.join(', ') || 'none'}`
        )
        return yield* Effect.fail(
            new MeshNoRoute({ nodeId: target, hops: tried })
        )
    })

/**
 * The agent's answer to a relayed call, and the reason services never address each other.
 *
 * Every call arrives here. The agent either pins it to another node (forwarding it to that node's agent, which never
 * leaves its own node), hands it to an agent that can reach it when the direct link fails, grants a direct link when
 * brokering would load it, or brokers it: resolve the replica by key, then locality, then load; call it over the pooled
 * link; and answer `MESH_REDIRECT` itself by replaying the call on the replica the redirect names. The caller sees the
 * target's own result, or its own errors, unchanged.
 */
export class MeshRelay extends Context.Service<MeshRelay, MeshRelayShape>()(
    'node-agent/MeshRelay'
) {
    static readonly live = class MeshRelayImpl implements MeshRelayShape {
        relay(request: MeshRelayInput) {
            return Effect.gen(function* () {
                const self = yield* NodeIdentity

                if (
                    request.node !== undefined &&
                    request.node !== self.nodeId
                ) {
                    const target = request.node
                    const visited = request.via?.visited ?? []
                    // A call that came back to a node it has been through would loop for as long as the ttl allows: refuse it here.
                    const looped = visited.includes(target)
                        ? target
                        : visited.includes(self.nodeId)
                          ? self.nodeId
                          : undefined
                    if (looped !== undefined) {
                        return yield* Effect.fail(
                            new MeshRelayLoop({ nodeId: looped })
                        )
                    }

                    const settings = yield* RelaySettings
                    const ttl = request.via?.ttl ?? settings.maxHops
                    if (request.via !== undefined && ttl === 0) {
                        return yield* Effect.fail(
                            new MeshNoRoute({ nodeId: target, hops: visited })
                        )
                    }

                    const agents = yield* NodeAgents
                    const metrics = yield* RelayMetrics

                    if (yield* agents.isUnreachable(target)) {
                        return yield* forward(
                            target,
                            request,
                            self.nodeId,
                            visited,
                            ttl
                        )
                    }

                    const attempt = yield* direct(target, request).pipe(
                        Effect.map((events) => ({ events }) as const),
                        Effect.catch((error) =>
                            isTargetAnswer(error)
                                ? Effect.fail(error)
                                : Effect.succeed({ transport: error } as const)
                        )
                    )
                    if ('events' in attempt) {
                        // The address works again: a stale negative cache entry must not survive it.
                        yield* agents.clearUnreachable(target)
                        return {
                            kind: 'events',
                            events: attempt.events,
                        } as const satisfies RelayOutcome
                    }
                    yield* agents.markUnreachable(
                        target,
                        settings.unreachableMs
                    )
                    yield* metrics.count('unreachable')
                    return yield* forward(
                        target,
                        request,
                        self.nodeId,
                        visited,
                        ttl
                    )
                }

                const localOnly = request.node === self.nodeId
                const load = yield* AgentLoad
                // A call an agent forwarded was pinned by a caller that cannot reach the target itself: a lease would be useless
                // to it, so a forwarded call is always brokered, whatever it asks for.
                if (request.via === undefined) {
                    const directory = yield* MeshDirectory

                    const reason = leaseReason({
                        heavy: request.heavy === true,
                        callerWantsDirect: request.direct === true,
                        agent: load.sample(),
                        pairCallsPerSecond: load.callStarted(request.service),
                    })
                    if (reason !== undefined) {
                        const resolution = yield* directory.resolve({
                            service: request.service,
                            key: request.key,
                            localOnly,
                        })
                        const signer = yield* LeaseSigner
                        return yield* Effect.fail(
                            grantDirect(yield* signer.issue(resolution.replica))
                        )
                    }
                }

                const links = yield* ReplicaLinks
                const broker = yield* MeshBroker
                const value = yield* broker.call({
                    service: request.service,
                    key: request.key,
                    localOnly,
                    maxHops: MAX_HOPS,
                    hintTtlMs: HINT_TTL_MS,
                    invoke: (replica) =>
                        Effect.tryPromise({
                            try: () =>
                                links
                                    .linkTo(replica)
                                    .call(request.path, request.input, {
                                        context: {
                                            headers: request.headers ?? {},
                                        },
                                    }),
                            catch: (error) => error,
                        }).pipe(
                            Effect.map((answer): CallOutcome<unknown> => ({
                                kind: 'ok',
                                value: answer,
                            })),
                            Effect.catch((error) => {
                                const redirect = readRedirect(error)
                                return redirect
                                    ? Effect.succeed<CallOutcome<unknown>>({
                                          kind: 'redirect',
                                          replicaId: redirect.replicaId,
                                          reason: redirect.reason,
                                      })
                                    : Effect.fail(toOrpcError(error))
                            })
                        ),
                })

                return isAsyncIterator(value)
                    ? ({
                          kind: 'stream',
                          items: trackStream(value, load),
                      } as const)
                    : ({ kind: 'value', value } as const)
            })
        }
    }
}

/** The relay's outcome as the events the contract declares: one `value`, or `stream` then one `item` per element. */
export async function* relayEvents(
    outcome: RelayOutcome
): AsyncGenerator<MeshRelayEvent> {
    if (outcome.kind === 'value') {
        yield { kind: 'value', value: outcome.value }
        return
    }
    if (outcome.kind === 'events') {
        try {
            for (
                let step = await outcome.events.next();
                !step.done;
                step = await outcome.events.next()
            ) {
                yield step.value
            }
        } finally {
            await outcome.events.return?.()
        }
        return
    }
    yield { kind: 'stream' }
    try {
        for (
            let step = await outcome.items.next();
            !step.done;
            step = await outcome.items.next()
        ) {
            yield { kind: 'item', value: step.value }
        }
    } finally {
        await outcome.items.return?.()
    }
}
