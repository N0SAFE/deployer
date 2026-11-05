import { randomBytes } from 'node:crypto'

import { Context, Effect, Option } from 'effect'

import { AgentStore, type AgentStoreError } from '../../../local/agent-store'
import {
    ROTATION_GRACE_MS,
    SwarmCredential,
    type Rotation,
} from '../../../local/swarm-credential'

import { NodeAgents } from './node-agents.service'

import type { AgentLinkFactory } from './agent-link-factory.service'
import type { ClientContext, ClientLink } from '@orpc/client'

const ROTATE_PATH = ['roster', 'rotate']
const BROADCAST_TIMEOUT_MS = 5_000

export type CredentialRotationShape = {
    /**
     * Mints the next secret, tells every known agent about it, then installs it here.
     *
     * The broadcast comes first and the local install last, so the originator keeps answering with the old secret (still
     * accepted by its peers) until every peer it could reach has the new one. A peer that did not answer converges
     * through gossip.
     */
    readonly rotate: () => Effect.Effect<
        Rotation,
        AgentStoreError,
        RotationDeps
    >
    /** Takes in a rotation a peer broadcast: stale epochs are ignored, so a late duplicate changes nothing. */
    readonly adopt: (
        secret: string,
        validUntil: number,
        epoch: number
    ) => Effect.Effect<void, AgentStoreError, RotationDeps>
    /** The credential a peer asks for during the grace window: the current secret and the window in force. */
    readonly currentForPeer: () => Effect.Effect<
        Rotation,
        never,
        SwarmCredential
    >
}

export type RotationDeps =
    SwarmCredential | AgentStore | NodeAgents | AgentLinkFactory

export class CredentialRotation extends Context.Service<
    CredentialRotation,
    CredentialRotationShape
>()('node-agent/CredentialRotation') {
    static readonly live = class CredentialRotationImpl implements CredentialRotationShape {
        rotate() {
            return Effect.gen(function* () {
                const credential = yield* SwarmCredential
                const agents = yield* NodeAgents

                // Minted here, not by the cell: the peers must learn the same secret the originator installs, so the local
                // rotation takes it as an input (`rotateTo`) instead of minting a second one.
                const secret = randomBytes(32).toString('base64url')
                const validUntil = Date.now() + ROTATION_GRACE_MS
                // The epoch is fixed before the broadcast: a receiver that adopts it then fetches the same rotation from gossip
                // must see an equal epoch and do nothing, not rotate its "previous" secret into the new one.
                const epoch = Date.now()

                for (const agent of yield* agents.known()) {
                    // A link is opened for the broadcast only: a rotation is rare, and gossip catches up whatever it cannot reach.
                    const link = yield* agents
                        .linkTo(agent.nodeId)
                        .pipe(Effect.option)
                    const reached = Option.isSome(link)
                        ? yield* broadcast(link.value, {
                              secret,
                              validUntil,
                              epoch,
                          })
                        : false
                    if (!reached) {
                        // Not fatal: the peer converges from gossip, inside the window this rotation opened.
                        yield* Effect.sync(() => {
                            console.warn(
                                `[node-agent] ${agent.nodeId} did not take the rotation; gossip will catch it up`
                            )
                        })
                    }
                }

                return yield* credential.rotateTo(secret, validUntil, epoch)
            })
        }

        adopt(secret: string, validUntil: number, epoch: number) {
            return Effect.gen(function* () {
                const credential = yield* SwarmCredential
                yield* credential.adopt(secret, validUntil, epoch)
            })
        }

        currentForPeer() {
            return Effect.gen(function* () {
                const credential = yield* SwarmCredential
                // `validUntil` is the window the previous secret was granted, which is the transition still in force.
                return {
                    secret: credential.current(),
                    validUntil: credential.validUntil(),
                    epoch: credential.epoch(),
                }
            })
        }
    }
}

/** One peer, best effort: `false` means "did not answer", never a failure of the rotation. Bounded, so one dead peer
 * cannot hold the rotation open. */
const broadcast = (
    link: ClientLink<ClientContext>,
    input: {
        readonly secret: string
        readonly validUntil: number
        readonly epoch: number
    }
): Effect.Effect<boolean> =>
    Effect.tryPromise({
        try: () => link.call(ROTATE_PATH, input, { context: {} }),
        catch: (error) => new Error(String(error)),
    }).pipe(
        Effect.timeout(BROADCAST_TIMEOUT_MS),
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false))
    )
