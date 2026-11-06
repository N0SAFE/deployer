import { Context, Effect } from 'effect'

import { CurrentActor, domainError } from '@deployer/effect-core'
import { stepUpContract } from '@deployer/identity-contracts'
import { PlatformSecret } from '@deployer/shared/core/modules/auth/orpc/secrets'
import { signSystemActorClaim } from '@deployer/shared/core/modules/auth/system-actor/system-actor'

import { SystemActorClients } from '@/core/ports/system-actor-clients.port'

/** The caller has not stepped up with a passkey recently. `reason` is the sentence identity gave, for the operator. */
export class StepUpRequired extends domainError('StepUpRequired', 'forbidden')<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}

/** Identity could not say, so the act is refused rather than allowed on a guess. */
export class StepUpUnavailable extends domainError(
    'StepUpUnavailable',
    'dependency_missing'
)() {
    override publicMessage() {
        return 'Step-up could not be checked right now, so this action was not allowed'
    }
}

const FORBIDDEN = 'FORBIDDEN'

const codeOf = (error: unknown): unknown =>
    typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined

export type StepUpGatewayShape = {
    /** Fails with `StepUpRequired` unless the caller's session just passed a passkey step-up. */
    readonly assertCritical: () => Effect.Effect<
        void,
        StepUpRequired | StepUpUnavailable,
        CurrentActor | SystemActorClients | PlatformSecret
    >
}

/**
 * The guard an act that needs a passkey calls first.
 *
 * Identity holds the step-up proofs, so this service asks it: as the SYSTEM, with a short-lived claim signed by the platform
 * secret that names the caller's SESSION (the claim's `subject`), the same way a webhook reaches the runtime. A peer that
 * merely reaches identity's port cannot ask on someone else's behalf, and the claim is good for a minute. Fails closed: if
 * identity does not answer, nothing is allowed.
 */
export class StepUpGateway extends Context.Service<
    StepUpGateway,
    StepUpGatewayShape
>()('fleet/StepUpGateway') {
    static readonly live = class StepUpGatewayImpl implements StepUpGatewayShape {
        assertCritical(): ReturnType<StepUpGatewayShape['assertCritical']> {
            return Effect.gen(function* () {
                const clients = yield* SystemActorClients
                const secrets = yield* PlatformSecret
                const actor = yield* CurrentActor
                if (actor.kind !== 'user' || actor.sessionId === null) {
                    return yield* new StepUpRequired({
                        reason: 'step-up needs a user session',
                    })
                }
                const secret = yield* secrets.get()
                if (secret === null) return yield* new StepUpUnavailable({})

                const token = signSystemActorClaim(
                    {
                        source: 'fleet-secrets',
                        subject: actor.sessionId,
                        aud: 'identity',
                    },
                    secret
                )
                const client = clients.systemActorClientFor(
                    'identity',
                    stepUpContract,
                    token
                )
                yield* Effect.tryPromise({
                    try: () => client.assertCritical({}),
                    catch: (error) => error,
                }).pipe(
                    Effect.mapError((error) =>
                        codeOf(error) === FORBIDDEN
                            ? new StepUpRequired({
                                  reason:
                                      error instanceof Error
                                          ? error.message
                                          : 'step-up required: verify with a passkey and retry',
                              })
                            : new StepUpUnavailable({ cause: error })
                    )
                )
            })
        }
    }
}
