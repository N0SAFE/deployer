import { eq, inArray } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { DbError } from '@deployer/effect-infra'
import { dockerImageSecurityLifecycle } from '@deployer/nest-schema/global/runtime/docker-security-scan'

import {
    RuntimeDatabasePort,
    RuntimeDb,
} from '../../../../../core/database/runtime-db'
import { tolerateMissingScanTable } from '../security/tolerate-missing-scan-table'

import { planAliveLifecycle } from './image-lifecycle-plan'

/** What the database layer reads while it runs. */
type DbRequirements = RuntimeDb | RuntimeDatabasePort

export type AliveLifecycle = {
    readonly imageGeneration: number
    readonly revived: boolean
    /** The lifecycle event the change calls for, or `null` when nothing changed. */
    readonly event: 'image_created' | 'image_revived' | null
}

export type DockerImageLifecycleRepositoryShape = {
    /** Mark the image alive: create its row, revive a deleted one into a new generation, or refresh `lastSeenAt`. */
    readonly ensureAlive: (
        identifier: string
    ) => Effect.Effect<AliveLifecycle, DbError, DbRequirements>
    /** Identifiers of every image currently marked alive. */
    readonly listAlive: () => Effect.Effect<string[], DbError, DbRequirements>
    /** Mark these identifiers deleted. */
    readonly markDeleted: (
        identifiers: readonly string[]
    ) => Effect.Effect<void, DbError, DbRequirements>
}

/** The scan lifecycle of images: a constant that reads the database from the Effect context when a method runs. */
export class DockerImageLifecycleRepository extends Context.Service<
    DockerImageLifecycleRepository,
    DockerImageLifecycleRepositoryShape
>()('runtime/DockerImageLifecycleRepository') {
    static readonly live = class DockerImageLifecycleRepositoryImpl implements DockerImageLifecycleRepositoryShape {
        ensureAlive = (identifier) =>
            Effect.gen(function* () {
                const database = yield* RuntimeDb
                const now = new Date()
                const existing = yield* database.use((db) =>
                    db
                        .select({
                            currentGeneration:
                                dockerImageSecurityLifecycle.currentGeneration,
                            lifecycleState:
                                dockerImageSecurityLifecycle.lifecycleState,
                        })
                        .from(dockerImageSecurityLifecycle)
                        .where(
                            eq(
                                dockerImageSecurityLifecycle.imageIdentifierNormalized,
                                identifier
                            )
                        )
                        .limit(1)
                        .then((rows) => rows[0] ?? null)
                )
                const plan = planAliveLifecycle(existing)

                yield* database.use(async (db) => {
                    if (plan.action === 'create') {
                        await db.insert(dockerImageSecurityLifecycle).values({
                            imageIdentifierNormalized: identifier,
                            currentGeneration: 1,
                            lifecycleState: 'alive',
                            firstSeenAt: now,
                            lastSeenAt: now,
                            deletedAt: null,
                            revivedAt: null,
                            createdAt: now,
                            updatedAt: now,
                        })
                        return
                    }
                    await db
                        .update(dockerImageSecurityLifecycle)
                        .set(
                            plan.action === 'revive'
                                ? {
                                      currentGeneration: plan.generation,
                                      lifecycleState: 'alive',
                                      lastSeenAt: now,
                                      deletedAt: null,
                                      revivedAt: now,
                                      updatedAt: now,
                                  }
                                : {
                                      lifecycleState: 'alive',
                                      lastSeenAt: now,
                                      updatedAt: now,
                                  }
                        )
                        .where(
                            eq(
                                dockerImageSecurityLifecycle.imageIdentifierNormalized,
                                identifier
                            )
                        )
                })

                return {
                    imageGeneration: plan.generation,
                    revived: plan.action === 'revive',
                    event: plan.event,
                }
            })

        listAlive = () =>
            Effect.flatMap(RuntimeDb, (database) =>
                database.use(async (db) => {
                    const rows = await db
                        .select({
                            imageIdentifierNormalized:
                                dockerImageSecurityLifecycle.imageIdentifierNormalized,
                        })
                        .from(dockerImageSecurityLifecycle)
                        .where(
                            eq(
                                dockerImageSecurityLifecycle.lifecycleState,
                                'alive'
                            )
                        )
                    return rows.map((row) => row.imageIdentifierNormalized)
                })
            ).pipe(tolerateMissingScanTable([] as string[]))

        markDeleted = (identifiers) =>
            identifiers.length === 0
                ? Effect.void
                : Effect.flatMap(RuntimeDb, (database) =>
                      database.use(async (db) => {
                          const now = new Date()
                          await db
                              .update(dockerImageSecurityLifecycle)
                              .set({
                                  lifecycleState: 'deleted',
                                  deletedAt: now,
                                  updatedAt: now,
                              })
                              .where(
                                  inArray(
                                      dockerImageSecurityLifecycle.imageIdentifierNormalized,
                                      [...identifiers]
                                  )
                              )
                      })
                  )
    }
}
