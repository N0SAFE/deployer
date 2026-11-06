import { Context, Effect } from 'effect'

import { actionHash } from '@deployer/auth/server'
import { ForbiddenError } from '@deployer/errors'
import { approvalContract } from '@deployer/identity-contracts'

import { signSystemActorClaim } from '../auth/system-actor/system-actor'

import type { ServiceClientShape } from '../../../server/service-client'
import type { PlatformSecretShape } from '../auth/orpc/secrets'

/** What a peer service may ask before a protected action. */
export type ApprovalGuardShape = {
    /**
     * Verify that `requesterId` may perform exactly `action` now.
     *
     * Succeeds when the account's role grants the capability, or when an approval for that hash is consumed; fails with
     * the refusal otherwise. `ForbiddenError` carries the API's own message, including the digest a caller needs to FILE
     * the matching request.
     */
    readonly require: (
        requesterId: string,
        permission: string,
        action: string,
        parts: readonly (string | number)[]
    ) => Effect.Effect<void, ForbiddenError>
}

/**
 * The cross-service approval guard (`SEC-069`, `SEC-072`).
 *
 * The service authenticated the caller; this asks identity the ONE question it cannot answer alone — "is this caller
 * allowed, by capability or by approval, to do this exact action". The digest is computed by the same helper on both
 * sides, so the request a peer files is the request the guard spends.
 *
 * The question is asked AS THE SYSTEM: the call carries a claim signed with the platform secret, addressed to identity and
 * bound (`subject`) to the requester it is about, so a peer that merely reaches identity's port cannot ask on anyone's behalf,
 * and a claim captured for one requester names no other. The platform secret is the one that rotates and that every node
 * shares; nothing here reads the environment.
 *
 * Fail-closed: identity unreachable or refusing, or no platform secret to sign with, all answer `ForbiddenError`. An approval
 * system that silently allows when its ledger is down is not a control.
 *
 * The collaborators are captured by the constructor (they are plain Nest providers, not Effect requirements), so the module
 * provides it with `new ApprovalGuard.live(serviceClient, platformSecret)` and callers keep a requirement-free shape.
 */
export class ApprovalGuard extends Context.Service<
    ApprovalGuard,
    ApprovalGuardShape
>()('approval/Guard') {
    static readonly live = class ApprovalGuardImpl implements ApprovalGuardShape {
        constructor(
            private readonly services: ServiceClientShape,
            private readonly secrets: PlatformSecretShape
        ) {}

        require(
            requesterId: string,
            permission: string,
            action: string,
            parts: readonly (string | number)[]
        ): Effect.Effect<void, ForbiddenError> {
            const { services, secrets } = this
            return Effect.gen(function* () {
                const secret = yield* secrets.get()
                if (secret === null || secret === '') {
                    return yield* Effect.fail(
                        new ForbiddenError(
                            'approval cannot be checked: the platform secret is not configured'
                        )
                    )
                }
                const token = signSystemActorClaim(
                    {
                        source: 'approval-guard',
                        subject: requesterId,
                        aud: 'identity',
                    },
                    secret
                )
                yield* Effect.tryPromise({
                    try: async () => {
                        await services
                            .systemActorClientFor(
                                'identity',
                                approvalContract,
                                token
                            )
                            .require({
                                requesterId,
                                permission,
                                actionHash: actionHash(action, ...parts),
                            })
                    },
                    catch: (cause) =>
                        new ForbiddenError(
                            cause instanceof Error
                                ? cause.message
                                : 'approval required'
                        ),
                })
            })
        }
    }
}
