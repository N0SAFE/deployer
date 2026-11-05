/**
 * PlatformController — ORPC implementation of the platform surface.
 *
 * Public:   registerAppInstance (credential-gated, rate-limited via middleware),
 *           heartbeatAppInstance (token verified via requireAppInstance
 *           middleware; header typed through detailed input).
 * Admin:    list/revoke instances (requireAuth).
 *
 * The HTML management console lives in PlatformConsoleController.
 */

import { Controller, Inject } from '@nestjs/common'
import { Implement } from '@orpc/nest'
import { Effect } from 'effect'

import {
    heartbeatAppInstanceContract,
    listAppInstancesContract,
    registerAppInstanceContract,
    revokeAppInstanceContract,
} from '@deployer/fleet-contracts'
import { procedure } from '@deployer/nest-effect'
import { standardErrorOptions } from '@deployer/orpc-utils'
import { rateLimit } from '@deployer/rate-limit'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'
import { AuthCoreService } from '@deployer/shared/core/modules/auth/services/auth-core.service'
import {
    AppInstanceService,
    STALE_AFTER_MS,
    type AppInstanceServiceShape,
} from '@deployer/shared/core/modules/platform-ingress/services/app-instance.service'

import { requireAppInstance } from '../orpc/middlewares'

/** Registration rate limit: sliding window per source IP. */
const REGISTER_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 5 } as const

@Controller()
export class PlatformController {
    constructor(
        @Inject(AppInstanceService)
        private readonly appInstances: AppInstanceServiceShape
    ) {}
    @Implement(registerAppInstanceContract)
    register() {
        return procedure(registerAppInstanceContract)
            .use(
                rateLimit({
                    ...REGISTER_RATE_LIMIT,
                    message: 'Too many registration attempts — try again later',
                })
            )
            .effect(function* ({ input, errors }) {
                const appInstances = yield* AppInstanceService
                const authCore = yield* AuthCoreService
                // Verify the account exists on THIS API — the anti-abuse boundary:
                // only legitimate account holders can introduce web instances.
                yield* Effect.tryPromise(() =>
                    authCore.api.signInEmail({
                        body: { email: input.email, password: input.password },
                    })
                ).pipe(
                    Effect.catch((error) =>
                        // Log the underlying cause (request-id correlated) — never swallow infrastructure failures as
                        // "bad credentials".
                        Effect.logError(
                            `credential verification failed: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`
                        ).pipe(
                            Effect.andThen(
                                Effect.fail(
                                    errors.UNAUTHORIZED(
                                        standardErrorOptions(
                                            'unauthorized',
                                            'Invalid account credentials'
                                        )
                                    )
                                )
                            )
                        )
                    )
                )

                const minted = yield* appInstances.create({
                    label: input.instanceLabel,
                    kind: 'external',
                })

                return {
                    status: 201 as const,
                    body: {
                        instanceId: minted.instanceId,
                        appToken: minted.appToken,
                        heartbeatIntervalMs: Math.floor(STALE_AFTER_MS / 3),
                    },
                }
            })
    }
    @Implement(heartbeatAppInstanceContract)
    heartbeat() {
        // `requireAppInstance` resolves the token and narrows the context:
        // after it, `context.appInstance` is guaranteed present — never
        // null-checked in the handler.
        return procedure(heartbeatAppInstanceContract)
            .use(requireAppInstance(this.appInstances))
            .handler(async () => {
                return {
                    status: 201,
                    body: { renewUntil: new Date(Date.now() + STALE_AFTER_MS) },
                }
            })
    }

    @Implement(listAppInstancesContract)
    list() {
        return procedure(listAppInstancesContract)
            .use(requireAuth())
            .effect(function* () {
                const appInstances = yield* AppInstanceService
                yield* appInstances.sweepStale()
                const instances = yield* appInstances.list()
                return {
                    instances: instances.map((row) => ({
                        id: row.id,
                        label: row.label,
                        kind: row.kind,
                        status: row.status,
                        lastSeenAt: row.lastSeenAt,
                        createdAt: row.createdAt,
                    })),
                }
            })
    }

    @Implement(revokeAppInstanceContract)
    revoke() {
        return procedure(revokeAppInstanceContract)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const appInstances = yield* AppInstanceService
                // Delete verbs envelope the input: body + default params.
                return {
                    revoked: yield* appInstances.revoke(input.body.instanceId),
                }
            })
    }
}
