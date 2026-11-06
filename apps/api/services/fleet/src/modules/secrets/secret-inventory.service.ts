import { Context, Effect } from 'effect'

import { domainError } from '@deployer/effect-core'
import type {
    SecretInventory as SecretInventoryView,
    SecretRetirement,
    SecretRotation,
    StoredSecrets,
} from '@deployer/fleet-contracts'

import { SecretsDoor, StoredSecretsPort } from './secrets.ports'

/** The agent did not answer, so the fleet's secrets cannot be listed. Said plainly: an empty list would look healthy. */
export class SecretInventoryUnavailable extends domainError(
    'SecretInventoryUnavailable',
    'dependency_missing'
)() {
    override publicMessage() {
        return "This node's agent did not answer, so the secrets of the fleet cannot be listed"
    }
}

/** The database could not be read, so the stored values could not be counted. */
export class StoredSecretsUnavailable extends domainError(
    'StoredSecretsUnavailable',
    'dependency_missing'
)() {
    override publicMessage() {
        return 'The stored secrets could not be counted right now'
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

export type SecretInventoryShape = {
    /** How many stored values sit under each key generation. Counts only. */
    readonly stored: () => Effect.Effect<
        StoredSecrets,
        StoredSecretsUnavailable,
        StoredSecretsPort
    >
    readonly inventory: () => Effect.Effect<
        SecretInventoryView,
        SecretInventoryUnavailable,
        SecretsDoor
    >
    /** A new generation of the platform secret becomes current; the earlier one stays accepted everywhere. */
    readonly rotate: () => Effect.Effect<
        SecretRotation,
        SecretInventoryUnavailable | SecretRotationNotAllowed,
        SecretsDoor
    >
    /** An earlier generation stops being accepted on every reachable node. */
    readonly retire: (
        generation: number
    ) => Effect.Effect<
        SecretRetirement,
        | StoredSecretsUnavailable
        | SecretInventoryUnavailable
        | SecretRotationNotAllowed,
        SecretsDoor | StoredSecretsPort
    >
}

/**
 * Which node holds which secret, and who is behind, as this node's agent sees the fleet.
 *
 * Nothing is measured here: the agent asks its peers (only an agent can call another agent) and compares what they say, so
 * this only reshapes that answer into the public view. The door and the database are yielded when a method runs.
 */
export class SecretInventory extends Context.Service<
    SecretInventory,
    SecretInventoryShape
>()('fleet/SecretInventory') {
    static readonly live = class SecretInventoryImpl
        implements SecretInventoryShape
    {
        stored(): ReturnType<SecretInventoryShape['stored']> {
            return Effect.gen(function* () {
                const stored = yield* StoredSecretsPort
                const report = yield* stored.report().pipe(
                    Effect.mapError((cause) => new StoredSecretsUnavailable({ cause }))
                )
                return {
                    totals: { ...report.totals },
                    columns: report.columns.map((column) => ({
                        table: column.table,
                        column: column.column,
                        byKey: { ...column.byKey },
                    })),
                }
            })
        }

        inventory(): ReturnType<SecretInventoryShape['inventory']> {
            return Effect.gen(function* () {
                const door = yield* SecretsDoor
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
            })
        }

        rotate(): ReturnType<SecretInventoryShape['rotate']> {
            return Effect.gen(function* () {
                const door = yield* SecretsDoor
                const outcome = yield* door.rotate()
                if (outcome.kind === 'absent') return yield* new SecretInventoryUnavailable({})
                if (outcome.kind === 'refused') {
                    return yield* new SecretRotationNotAllowed({ reason: outcome.message })
                }
                return outcome.value
            })
        }

        retire(generation: number): ReturnType<SecretInventoryShape['retire']> {
            return Effect.gen(function* () {
                const door = yield* SecretsDoor
                const stored = yield* StoredSecretsPort
                // Retiring makes what is sealed under the generation unreadable, so it is refused while any row still is. The
                // figure is read first and the act comes second: a refusal changes nothing.
                const report = yield* stored.report().pipe(
                    Effect.mapError((cause) => new StoredSecretsUnavailable({ cause }))
                )
                const left = report.totals[`column:${String(generation)}`] ?? 0
                if (left > 0) {
                    return yield* new SecretRotationNotAllowed({
                        reason: `${String(left)} stored value(s) are still sealed under generation ${String(generation)}. Rewrite them to the current generation first (reseal-secrets --to-current), then retire it.`,
                    })
                }
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
            })
        }
    }
}
