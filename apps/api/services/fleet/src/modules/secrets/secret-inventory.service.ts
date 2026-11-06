import { Context, Effect } from 'effect'

import { domainError, serviceOver, type Over } from '@deployer/effect-core'
import type { SecretInventory as SecretInventoryView } from '@deployer/fleet-contracts'

import { SecretsDoor } from './secrets.ports'

/** The agent did not answer, so the fleet's secrets cannot be listed. Said plainly: an empty list would look healthy. */
export class SecretInventoryUnavailable extends domainError(
    'SecretInventoryUnavailable',
    'dependency_missing'
)() {
    override publicMessage() {
        return "This node's agent did not answer, so the secrets of the fleet cannot be listed"
    }
}

/** The agent said no, and why: the fleet is not ready for it, or the node is not set up. `reason` is the agent's own sentence. */
export class SecretRotationNotAllowed extends domainError(
    'SecretRotationNotAllowed',
    'conflict'
)<{ readonly reason: string }>() {
    override publicMessage() {
        return this.reason
    }
}

/**
 * Which node holds which secret, and who is behind, as this node's agent sees the fleet.
 *
 * Nothing is measured here: the agent asks its peers (only an agent can call another agent) and compares what they say, so
 * this only reshapes that answer into the public view.
 */
const makeSecretInventory = ({
    door,
}: {
    readonly door: Context.Service.Shape<typeof SecretsDoor>
}) => ({
    inventory: Effect.fn('SecretInventory.inventory')(function* () {
        const fleet = yield* door.fleetSecrets()
        if (fleet === null) return yield* new SecretInventoryUnavailable({})
        const view: SecretInventoryView = {
            nodes: fleet.nodes.map((node) => ({
                nodeId: node.nodeId,
                reachable: node.reachable,
                secrets: node.secrets.map((secret) => ({
                    ...secret,
                    earlierGenerations: [...secret.earlierGenerations],
                    consumers: [...secret.consumers],
                })),
            })),
            adoption: fleet.adoption.map((entry) => ({
                ...entry,
                nodes: entry.nodes.map((node) => ({ ...node })),
            })),
        }
        return view
    }),

    /** A new generation of the platform secret becomes current; the earlier one stays accepted everywhere. */
    rotate: Effect.fn('SecretInventory.rotate')(function* () {
        const outcome = yield* door.rotate()
        if (outcome.kind === 'absent') return yield* new SecretInventoryUnavailable({})
        if (outcome.kind === 'refused') {
            return yield* new SecretRotationNotAllowed({ reason: outcome.message })
        }
        return outcome.value
    }),

    /** An earlier generation stops being accepted on every reachable node. */
    retire: Effect.fn('SecretInventory.retire')(function* (generation: number) {
        const outcome = yield* door.retire(generation)
        if (outcome.kind === 'absent') return yield* new SecretInventoryUnavailable({})
        if (outcome.kind === 'refused') {
            return yield* new SecretRotationNotAllowed({ reason: outcome.message })
        }
        return {
            generation: outcome.value.generation,
            reached: [...outcome.value.reached],
            unreachable: [...outcome.value.unreachable],
        }
    }),
})

export type SecretInventoryShape = Over<
    ReturnType<typeof makeSecretInventory>,
    SecretsDoor
>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class SecretInventory extends Context.Service<
    SecretInventory,
    SecretInventoryShape
>()('fleet/SecretInventory') {
    /** The door is yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: SecretInventoryShape = serviceOver(
        Effect.all({ door: SecretsDoor }),
        makeSecretInventory
    )
}
