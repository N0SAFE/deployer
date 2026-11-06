import { Context, type Effect } from 'effect'

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

export class SecretsDoor extends Context.Service<SecretsDoor, SecretsDoorShape>()(
    'fleet/SecretsDoor'
) {}
