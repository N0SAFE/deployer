/**
 * GitHub Repository Config Repository
 *
 * PURPOSE: Database access layer for GitHub repository configurations
 *
 * RESPONSIBILITIES:
 * - All database queries for GitHub repository configs
 * - Raw data retrieval and persistence
 * - No business logic or transformations
 *
 * PATTERN: Repository Pattern
 * - Encapsulates all data access for GitHub configs
 * - Returns raw database entities
 * - Used by service layer
 */

import { eq, and, or, SQL } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { githubRepositoryConfigs } from '@deployer/nest-schema/global/fleet/github-provider'

import {
    storage,
    type DatabasePort,
    type StorageFailure,
} from '../../../database/storage'
// Type inference from schema
type GithubRepositoryConfig = typeof githubRepositoryConfigs.$inferSelect
type GithubRepositoryConfigInsert = typeof githubRepositoryConfigs.$inferInsert

export type GithubRepositoryConfigRepositoryShape = {
    readonly findById: (
        id: string
    ) => Effect.Effect<GithubRepositoryConfig | null, StorageFailure>
    readonly findByRepositoryId: (
        repositoryId: string
    ) => Effect.Effect<GithubRepositoryConfig | null, StorageFailure>
    readonly findByFullName: (
        fullName: string
    ) => Effect.Effect<GithubRepositoryConfig | null, StorageFailure>
    readonly findByRepositoryIdOrFullName: (
        repositoryId?: string,
        fullName?: string
    ) => Effect.Effect<GithubRepositoryConfig | null, StorageFailure>
    readonly findByProjectId: (
        projectId: string
    ) => Effect.Effect<GithubRepositoryConfig[], StorageFailure>
    readonly findByProjectAndRepository: (
        projectId: string,
        repositoryId: string
    ) => Effect.Effect<GithubRepositoryConfig | null, StorageFailure>
    readonly create: (
        data: GithubRepositoryConfigInsert
    ) => Effect.Effect<GithubRepositoryConfig, StorageFailure>
    readonly update: (
        id: string,
        data: Partial<GithubRepositoryConfigInsert>
    ) => Effect.Effect<GithubRepositoryConfig | null, StorageFailure>
    readonly delete: (id: string) => Effect.Effect<boolean, StorageFailure>
}

export class GithubRepositoryConfigRepository extends Context.Service<
    GithubRepositoryConfigRepository,
    GithubRepositoryConfigRepositoryShape
>()('shared/GithubRepositoryConfigRepository') {
    /**
     * The pool is the only collaborator, so it is a constructor argument: the
     * shape's channel is `StorageFailure` alone.
     */
    static readonly live = class GithubRepositoryConfigRepositoryImpl
        implements GithubRepositoryConfigRepositoryShape
    {
        constructor(
            private readonly database: Context.Service.Shape<
                typeof DatabasePort
            >
        ) {}

        /** Find config by ID. */
        findById(
            id: string
        ): Effect.Effect<GithubRepositoryConfig | null, StorageFailure> {
            const { database } = this
            return Effect.logDebug(`Finding GitHub config by ID: ${id}`).pipe(
                Effect.andThen(
                    storage(database, async (db) => {
                        const [config] = await db
                            .select()
                            .from(githubRepositoryConfigs)
                            .where(eq(githubRepositoryConfigs.id, id))
                            .limit(1)

                        return config ?? null
                    })
                )
            )
        }

        /** Find config by repository ID. */
        findByRepositoryId(
            repositoryId: string
        ): Effect.Effect<GithubRepositoryConfig | null, StorageFailure> {
            const { database } = this
            return Effect.logDebug(
                `Finding GitHub config by repository ID: ${repositoryId}`
            ).pipe(
                Effect.andThen(
                    storage(database, async (db) => {
                        const [config] = await db
                            .select()
                            .from(githubRepositoryConfigs)
                            .where(
                                eq(
                                    githubRepositoryConfigs.repositoryId,
                                    repositoryId
                                )
                            )
                            .limit(1)

                        return config ?? null
                    })
                )
            )
        }

        /** Find config by repository full name (owner/repo). */
        findByFullName(
            fullName: string
        ): Effect.Effect<GithubRepositoryConfig | null, StorageFailure> {
            const { database } = this
            return Effect.logDebug(
                `Finding GitHub config by full name: ${fullName}`
            ).pipe(
                Effect.andThen(
                    storage(database, async (db) => {
                        const [config] = await db
                            .select()
                            .from(githubRepositoryConfigs)
                            .where(
                                eq(
                                    githubRepositoryConfigs.repositoryFullName,
                                    fullName
                                )
                            )
                            .limit(1)

                        return config ?? null
                    })
                )
            )
        }

        /** Find config by repository ID or full name. */
        findByRepositoryIdOrFullName(
            repositoryId?: string,
            fullName?: string
        ): Effect.Effect<GithubRepositoryConfig | null, StorageFailure> {
            const { database } = this
            return Effect.logDebug(
                `Finding GitHub config by ID or full name`
            ).pipe(
                Effect.andThen(
                    storage(database, async (db) => {
                        if (!repositoryId && !fullName) {
                            return null
                        }

                        const conditions: SQL[] = []
                        if (repositoryId) {
                            conditions.push(
                                eq(
                                    githubRepositoryConfigs.repositoryId,
                                    repositoryId
                                )
                            )
                        }
                        if (fullName) {
                            conditions.push(
                                eq(
                                    githubRepositoryConfigs.repositoryFullName,
                                    fullName
                                )
                            )
                        }

                        const [config] = await db
                            .select()
                            .from(githubRepositoryConfigs)
                            .where(or(...conditions))
                            .limit(1)

                        return config ?? null
                    })
                )
            )
        }

        /** Find all configs for a project. */
        findByProjectId(
            projectId: string
        ): Effect.Effect<GithubRepositoryConfig[], StorageFailure> {
            const { database } = this
            return Effect.logDebug(
                `Finding GitHub configs for project: ${projectId}`
            ).pipe(
                Effect.andThen(
                    storage(database, async (db) => {
                        return await db
                            .select()
                            .from(githubRepositoryConfigs)
                            .where(
                                eq(githubRepositoryConfigs.projectId, projectId)
                            )
                    })
                )
            )
        }

        /** Find config by project and repository. */
        findByProjectAndRepository(
            projectId: string,
            repositoryId: string
        ): Effect.Effect<GithubRepositoryConfig | null, StorageFailure> {
            const { database } = this
            return Effect.logDebug(
                `Finding GitHub config for project ${projectId} and repository ${repositoryId}`
            ).pipe(
                Effect.andThen(
                    storage(database, async (db) => {
                        const [config] = await db
                            .select()
                            .from(githubRepositoryConfigs)
                            .where(
                                and(
                                    eq(
                                        githubRepositoryConfigs.projectId,
                                        projectId
                                    ),
                                    eq(
                                        githubRepositoryConfigs.repositoryId,
                                        repositoryId
                                    )
                                )
                            )
                            .limit(1)

                        return config ?? null
                    })
                )
            )
        }

        /** Create a new GitHub repository config. */
        create(
            data: GithubRepositoryConfigInsert
        ): Effect.Effect<GithubRepositoryConfig, StorageFailure> {
            const { database } = this
            return Effect.logInfo(
                `Creating GitHub repository config for: ${data.repositoryFullName}`
            ).pipe(
                Effect.andThen(
                    storage(database, async (db) => {
                        const [config] = await db
                            .insert(githubRepositoryConfigs)
                            .values(data)
                            .returning()

                        if (!config) {
                            throw new Error(
                                'Failed to create GitHub repository config'
                            )
                        }

                        return config
                    })
                )
            )
        }

        /** Update a GitHub repository config. */
        update(
            id: string,
            data: Partial<GithubRepositoryConfigInsert>
        ): Effect.Effect<GithubRepositoryConfig | null, StorageFailure> {
            const { database } = this
            return Effect.logInfo(
                `Updating GitHub repository config: ${id}`
            ).pipe(
                Effect.andThen(
                    storage(database, async (db) => {
                        const [config] = await db
                            .update(githubRepositoryConfigs)
                            .set({
                                ...data,
                                updatedAt: new Date(),
                            })
                            .where(eq(githubRepositoryConfigs.id, id))
                            .returning()

                        return config ?? null
                    })
                )
            )
        }

        /** Delete a GitHub repository config. */
        delete(id: string): Effect.Effect<boolean, StorageFailure> {
            const { database } = this
            return Effect.logInfo(
                `Deleting GitHub repository config: ${id}`
            ).pipe(
                Effect.andThen(
                    storage(database, async (db) => {
                        const result = await db
                            .delete(githubRepositoryConfigs)
                            .where(eq(githubRepositoryConfigs.id, id))

                        return result.rowCount ? result.rowCount > 0 : false
                    })
                )
            )
        }
    }
}
