import { Context, type Effect } from 'effect'

import type { StoredKeyReport } from '@deployer/nest-schema/codecs/reseal'

import type {
    DoorOutcome,
    NodeDoorFleetSecrets,
    NodeDoorSecretRetirement,
    NodeDoorSecretRotation,
} from '@deployer/mesh-client'

/**
 * The one thing the secrets inventory needs from outside: this node's agent, asked for the fleet's secrets. Null is the agent
 * that does not answer (no agent on this node, or it predates the procedure), which the service turns into a typed failure.
 */
export type SecretsDoorShape = {
    readonly fleetSecrets: () => Effect.Effect<NodeDoorFleetSecrets | null>
    readonly rotate: () => Effect.Effect<DoorOutcome<NodeDoorSecretRotation>>
    readonly retire: (
        generation: number
    ) => Effect.Effect<DoorOutcome<NodeDoorSecretRetirement>>
}

/**
 * The stored encrypted values, counted by key. Counts only: the values are never read. Fails with whatever the database
 * failed with; the service turns that into a typed error.
 */
export type StoredSecretsShape = {
    readonly report: () => Effect.Effect<StoredKeyReport, unknown>
}

export class StoredSecretsPort extends Context.Service<
    StoredSecretsPort,
    StoredSecretsShape
>()('fleet/StoredSecretsPort') {}

export class SecretsDoor extends Context.Service<SecretsDoor, SecretsDoorShape>()(
    'fleet/SecretsDoor'
) {}
