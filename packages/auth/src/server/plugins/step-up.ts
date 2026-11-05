import { createAuthMiddleware } from 'better-auth/api'

import type { StepUpMethod } from '../../authz/step-up'
import type { BetterAuthPlugin } from 'better-auth'

/** One completed verification, bound to the session that performed it. */
export interface StepUpEvent {
    readonly sessionId: string
    readonly userId: string
    readonly method: StepUpMethod
    /** Why the caller asked, when the request carried a reason. */
    readonly reason?: string
}

/**
 * Where step-up proofs go.
 *
 * A sink rather than a table, for the same reason the audit hook takes one: `packages/auth` builds an instance for
 * callers that own no database, and the deployment that has one passes `drizzleStepUpSink`.
 */
export interface StepUpSink {
    record(event: StepUpEvent): void
}

/**
 * The endpoints that PROVE a factor.
 *
 * Only a successful verification reaches the `after` hook — Better Auth runs it on a 2xx response. `/passkey/verify-
 * authentication` is the passkey ceremony; `/two-factor/verify-totp` is AAL2 and is recorded so an operator can see it,
 * but `isCriticalStepUp` refuses it for critical actions.
 */
const VERIFYING_PATHS: readonly {
    readonly path: string
    readonly method: StepUpMethod
}[] = [
    { path: '/passkey/verify-authentication', method: 'passkey' },
    { path: '/two-factor/verify-totp', method: 'totp' },
]

/** What these endpoints return: the session they MINTED, which is the one the browser now holds. */
interface VerifiedSession {
    readonly session?: { readonly id?: string; readonly userId?: string }
    readonly user?: { readonly id?: string }
}

/**
 * Record every factor verification as a step-up for the session it produced (`AUTH-062`).
 *
 * ── WHY THE RETURNED SESSION, NOT `ctx.context.session` ─────────────────────
 * `/passkey/verify-authentication` has no `sessionMiddleware`: it verifies the credential, then CALLS
 * `createSession` and `setSessionCookie` itself. Reading `ctx.context.session` there is `null`, and reading the
 * pre-existing session would bind the proof to a session the browser has just replaced. The response is the only
 * place that names the session the caller now holds, so it is preferred and the current session is the fallback (the
 * TOTP endpoint behaves the same way).
 *
 * Silent on failure, like the audit hook: a missing proof row must not turn a successful ceremony into a browser error;
 * the consequence is a refused critical action, which is the safe direction.
 */
export const stepUpPlugin = (sink: StepUpSink): BetterAuthPlugin => ({
    id: 'step-up',
    hooks: {
        after: [
            {
                matcher: (context) =>
                    VERIFYING_PATHS.some(
                        (candidate) => candidate.path === context.path
                    ),
                handler: createAuthMiddleware((ctx) => {
                    const verifying = VERIFYING_PATHS.find(
                        (candidate) => candidate.path === ctx.path
                    )
                    if (verifying === undefined) return Promise.resolve()

                    const returned = (
                        ctx.context as { returned?: VerifiedSession }
                    ).returned
                    const current = ctx.context.session
                    const sessionId =
                        returned?.session?.id ?? current?.session.id
                    const userId =
                        returned?.session?.userId ??
                        returned?.user?.id ??
                        current?.user.id
                    if (sessionId === undefined || userId === undefined)
                        return Promise.resolve()

                    const reason = (
                        ctx.body as { reason?: unknown } | undefined
                    )?.reason
                    sink.record({
                        sessionId,
                        userId,
                        method: verifying.method,
                        ...(typeof reason === 'string' && reason.length > 0
                            ? { reason }
                            : {}),
                    })
                    return Promise.resolve()
                }),
            },
        ],
    },
})
