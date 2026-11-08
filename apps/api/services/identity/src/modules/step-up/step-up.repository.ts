import { and, desc, eq, gte } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { StepUpMethod } from '@deployer/auth/authz'
import { stepUpEvents } from '@deployer/nest-schema/global/identity/step-up'

import {
    DatabasePort,
    type DatabaseShape,
} from '@identity/core/database/database.port'

/** The newest proof one session holds, if any arrived after `since`. */
export type StepUpProof = {
    readonly id: string
    readonly method: StepUpMethod
    readonly verifiedAt: Date
}

export type StepUpRepositoryShape = {
    readonly latestForSession: (
        sessionId: string,
        since: Date
    ) => Effect.Effect<StepUpProof | null, never, DatabasePort>
}

/**
 * Append-only reads over `step_up_events`.
 *
 * The database is yielded inside the method that queries with it, so this is a class the module provides
 * with `useClass` — no `serviceOver` closure and no factory holding the query.
 */
export class StepUpRepository extends Context.Service<
    StepUpRepository,
    StepUpRepositoryShape
>()('identity/StepUpRepository') {
    static readonly live = class StepUpRepositoryImpl
        implements StepUpRepositoryShape
    {
        latestForSession(
            sessionId: string,
            since: Date
        ): ReturnType<StepUpRepositoryShape['latestForSession']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(async () => {
                    const [row] = await database.db
                        .select({
                            id: stepUpEvents.id,
                            method: stepUpEvents.method,
                            verifiedAt: stepUpEvents.verifiedAt,
                        })
                        .from(stepUpEvents)
                        .where(
                            and(
                                eq(stepUpEvents.sessionId, sessionId),
                                gte(stepUpEvents.verifiedAt, since)
                            )
                        )
                        .orderBy(desc(stepUpEvents.verifiedAt))
                        .limit(1)

                    if (row === undefined) return null
                    return {
                        id: row.id,
                        method: row.method === 'totp' ? 'totp' : 'passkey',
                        verifiedAt: row.verifiedAt,
                    } satisfies StepUpProof
                })
            })
        }
    }
}
