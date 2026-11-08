import { Logger } from '@nestjs/common'
import { and, eq, gte } from 'drizzle-orm'

import { STEP_UP_WINDOW_SECONDS } from '@deployer/auth/authz'
import type { StepUpSink } from '@deployer/auth/server'
import { getErrorMessage } from '@deployer/errors'
import { stepUpEvents } from '@deployer/nest-schema/global/identity/step-up'

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { AnyRelations } from 'drizzle-orm'

const logger = new Logger('AuthStepUp')

/**
 * Append step-up proofs to `step_up_events` (`AUTH-062`).
 *
 * Fire-and-forget, like the audit sink: the passkey ceremony already succeeded by the time the hook runs, so a failed
 * insert must not surface as a failed verification. It is logged, and the caller's next critical action is refused —
 * the safe direction.
 */
export function drizzleStepUpSink<TSchema extends AnyRelations>(
    database: NodePgDatabase<TSchema>
): StepUpSink {
    return {
        record: (event) => {
            void database
                .insert(stepUpEvents)
                .values({
                    sessionId: event.sessionId,
                    userId: event.userId,
                    method: event.method,
                    reason: event.reason ?? null,
                })
                .catch((error: unknown) => {
                    logger.warn(
                        `step-up write failed for session ${event.sessionId}: ${getErrorMessage(error)}`
                    )
                })
        },
    }
}

/**
 * Whether THIS session holds a fresh passkey proof — what an impersonation requires (`AUTH-067`).
 *
 * Passkey only: a TOTP code can be phished in real time, which is why the design demands AAL3 to become someone else.
 */
export function makeHasStepUp<TSchema extends AnyRelations>(
    database: NodePgDatabase<TSchema>
): (sessionId: string) => Promise<boolean> {
    return async (sessionId) => {
        const since = new Date(Date.now() - STEP_UP_WINDOW_SECONDS * 1000)
        const [row] = await database
            .select({ id: stepUpEvents.id })
            .from(stepUpEvents)
            .where(
                and(
                    eq(stepUpEvents.sessionId, sessionId),
                    gte(stepUpEvents.verifiedAt, since),
                    eq(stepUpEvents.method, 'passkey')
                )
            )
            .limit(1)
        return row !== undefined
    }
}
