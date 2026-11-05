/**
 * Platform ORPC middlewares.
 *
 * - `requireAppInstance(appInstances)` — verifies the X-App-Instance-Token
 *   header against the app_instances store and narrows the context with the
 *   instance identity. An Effect that asks the
 *   `AppInstanceService` (a service, so it is a requirement of the procedure, not a constructor argument): it is the ONLY place
 *   that resolves the token, so after it runs `context.appInstance` is guaranteed non-null — handlers never check for absence.
 *
 * The generic sliding-window `rateLimit(options)` middleware lives in `@deployer/rate-limit`.
 */

import { effectMiddleware, Unauthenticated } from '@deployer/nest-effect'
import { readHeader, type RequestContext } from '@deployer/rate-limit'
import { AppInstanceService } from '@deployer/shared/core/modules/platform-ingress/services/app-instance.service'

/** Context extension produced by `requireAppInstance()`. */
export type AppInstanceContext = {
    appInstance: {
        id: string
        label: string
        kind: 'managed' | 'external'
    }
}

/**
 * Verifies the X-App-Instance-Token header and narrows the context with the instance identity. Fails with `Unauthenticated`
 * (401) when the header is missing or the token does not resolve; after this middleware runs, `context.appInstance` is
 * guaranteed present, so handlers never null-check it.
 */
export function requireAppInstance() {
    return effectMiddleware<AppInstanceService, AppInstanceContext, unknown, RequestContext>(
        function* ({ context, next }) {
            const rawToken = readHeader(context.request, 'x-app-instance-token')

            // The two failures mean different things (a client that forgot the header versus a token that no longer resolves),
            // and a single message makes the first indistinguishable from a revoked instance in a log or an e2e run.
            if (rawToken === null || rawToken.length === 0) {
                return yield* new Unauthenticated({ reason: 'Missing X-App-Instance-Token header' })
            }
            const appInstances = yield* AppInstanceService
            const instance = yield* appInstances.verifyByToken(rawToken)
            if (instance === null) {
                return yield* new Unauthenticated({
                    reason: 'Invalid X-App-Instance-Token: no active instance matches it',
                })
            }
            return yield* next({
                context: {
                    appInstance: {
                        id: instance.id,
                        label: instance.label,
                        kind: instance.kind,
                    },
                },
            })
        }
    )
}
