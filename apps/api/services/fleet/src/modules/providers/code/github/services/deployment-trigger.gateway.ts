import { Context, Effect } from 'effect'

import { deploymentContract } from '@deployer/runtime-contracts'
import { PlatformSecret } from '@deployer/shared/core/modules/auth/orpc/secrets'
import { signSystemActorClaim } from '@deployer/shared/core/modules/auth/system-actor/system-actor'

import { attempt, attemptSync } from '@/core/effects'
import { SystemActorClients } from '@/core/ports/system-actor-clients.port'

export type TriggerRelayResult = {
    dispatched: boolean
    sourceId: string | null
    deploymentId: string | null
    reason: string | null
}

/**
 * Hands a verified provider event to `svc-runtime`, which owns deployments.
 *
 * Fleet receives the webhook and has authenticated it (signature + idempotency), but it does
 * not decide what to deploy: the runtime's trigger registry does. A webhook has no user, so
 * the call is made AS THE SYSTEM, with a signed claim naming the source and the delivery
 * (`auth/system-actor`). Runtime verifies it; a peer that merely reaches the port cannot.
 *
 * Fleet depends on runtime's CONTRACT only — never on its internals.
 */
export type DeploymentTriggerGatewayShape = {
    readonly relay: (event: {
        provider: string
        eventName: string
        deliveryId: string
        payload: unknown
    }) => Effect.Effect<
        TriggerRelayResult,
        unknown,
        SystemActorClients | PlatformSecret
    >
}

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class DeploymentTriggerGateway extends Context.Service<
    DeploymentTriggerGateway,
    DeploymentTriggerGatewayShape
>()('fleet/DeploymentTriggerGateway') {
    static readonly live = class DeploymentTriggerGatewayImpl
        implements DeploymentTriggerGatewayShape
    {
        relay(
            event: {
                provider: string
                eventName: string
                deliveryId: string
                payload: unknown
            }
        ): ReturnType<DeploymentTriggerGatewayShape['relay']> {
            return Effect.gen(function* () {
                const secrets = yield* PlatformSecret
                const secret = yield* secrets.get()
                if (secret === null || secret === '') {
                    return yield* Effect.fail(
                        new Error(
                            'Cannot sign a system-actor claim: the platform secret is not configured'
                        )
                    )
                }

                const token = yield* attemptSync(() =>
                    signSystemActorClaim(
                        {
                            source: `${event.provider}-${event.eventName}`,
                            deliveryId: event.deliveryId,
                            aud: 'runtime',
                        },
                        secret
                    )
                )
                const clients = yield* SystemActorClients
                const client = yield* attemptSync(() =>
                    clients.systemActorClientFor(
                        'runtime',
                        deploymentContract,
                        token
                    )
                )
                return yield* attempt((): Promise<TriggerRelayResult> =>
                    client.triggerFromEvent({
                        provider: event.provider,
                        eventName: event.eventName,
                        deliveryId: event.deliveryId,
                        payload: event.payload,
                    })
                )
            })
        }
    }
}
