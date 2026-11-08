/**
 * GitHub Deployment Cache Repository
 *
 * PURPOSE: Database access layer for GitHub deployment cache
 *
 * RESPONSIBILITIES:
 * - All database queries for deployment cache
 * - Raw data retrieval and persistence
 * - No business logic or transformations
 *
 * PATTERN: Repository Pattern
 * - Encapsulates all data access for deployment cache
 * - Returns raw database entities
 * - Used by service layer
 */

import { eq, and, desc } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { deploymentCache } from '@deployer/nest-schema/global'

import {
    DatabasePort,
    storage,
    type StorageFailure,
} from '../../../database/storage'
// Type inference from schema
type DeploymentCache = typeof deploymentCache.$inferSelect
type DeploymentCacheInsert = typeof deploymentCache.$inferInsert

export type GithubDeploymentCacheRepositoryShape = {
    readonly create: (
        data: DeploymentCacheInsert
    ) => Effect.Effect<DeploymentCache, StorageFailure, DatabasePort>
    readonly findLatestByBranch: (
        projectId: string,
        repositoryId: string,
        branch: string
    ) => Effect.Effect<
        DeploymentCache | null,
        StorageFailure,
        DatabasePort
    >
    readonly findByCommitSha: (
        projectId: string,
        repositoryId: string,
        commitSha: string
    ) => Effect.Effect<
        DeploymentCache | null,
        StorageFailure,
        DatabasePort
    >
    readonly findByProjectId: (
        projectId: string
    ) => Effect.Effect<DeploymentCache[], StorageFailure, DatabasePort>
    readonly findByRepository: (
        projectId: string,
        repositoryId: string
    ) => Effect.Effect<DeploymentCache[], StorageFailure, DatabasePort>
    readonly updateDeploymentId: (
        id: string,
        deploymentId: string
    ) => Effect.Effect<
        DeploymentCache | null,
        StorageFailure,
        DatabasePort
    >
    readonly delete: (
        id: string
    ) => Effect.Effect<boolean, StorageFailure, DatabasePort>
    readonly deleteByBranch: (
        projectId: string,
        repositoryId: string,
        branch: string
    ) => Effect.Effect<number, StorageFailure, DatabasePort>
    readonly deleteMany: (
        ids: string[]
    ) => Effect.Effect<number, StorageFailure, DatabasePort>
}

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * Every operation yields `DatabasePort` when it runs, so the requirement channel names the connection it
 * reads and a spec provides only that.
 */
export class GithubDeploymentCacheRepository extends Context.Service<
    GithubDeploymentCacheRepository,
    GithubDeploymentCacheRepositoryShape
>()('shared/GithubDeploymentCacheRepository') {
    static readonly live = class GithubDeploymentCacheRepositoryImpl
        implements GithubDeploymentCacheRepositoryShape
    {
        /**
         * Create a new cache entry
         */
        create(
            data: DeploymentCacheInsert
        ): ReturnType<GithubDeploymentCacheRepositoryShape['create']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                yield* Effect.logInfo(
                    `Creating cache entry for ${data.repositoryId}@${data.branch} - ${data.commitSha}`
                )
                return yield* storage(database, async (db) => {
                    const [entry] = await db
                        .insert(deploymentCache)
                        .values(data)
                        .returning()

                    if (!entry) {
                        throw new Error(
                            'Failed to create deployment cache entry'
                        )
                    }

                    return entry
                })
            })
        }

        /**
         * Find the latest cache entry for a branch
         */
        findLatestByBranch(
            projectId: string,
            repositoryId: string,
            branch: string
        ): ReturnType<GithubDeploymentCacheRepositoryShape['findLatestByBranch']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                yield* Effect.logDebug(
                    `Finding latest cache entry for ${repositoryId}@${branch}`
                )
                return yield* storage(database, async (db) => {
                    const [entry] = await db
                        .select()
                        .from(deploymentCache)
                        .where(
                            and(
                                eq(deploymentCache.projectId, projectId),
                                eq(deploymentCache.repositoryId, repositoryId),
                                eq(deploymentCache.branch, branch)
                            )
                        )
                        .orderBy(desc(deploymentCache.createdAt))
                        .limit(1)

                    return entry ?? null
                })
            })
        }

        /**
         * Find cache entry by commit SHA
         */
        findByCommitSha(
            projectId: string,
            repositoryId: string,
            commitSha: string
        ): ReturnType<GithubDeploymentCacheRepositoryShape['findByCommitSha']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                yield* Effect.logDebug(
                    `Finding cache entry for commit: ${commitSha}`
                )
                return yield* storage(database, async (db) => {
                    const [entry] = await db
                        .select()
                        .from(deploymentCache)
                        .where(
                            and(
                                eq(deploymentCache.projectId, projectId),
                                eq(deploymentCache.repositoryId, repositoryId),
                                eq(deploymentCache.commitSha, commitSha)
                            )
                        )
                        .limit(1)

                    return entry ?? null
                })
            })
        }

        /**
         * Find all cache entries for a project
         */
        findByProjectId(
            projectId: string
        ): ReturnType<GithubDeploymentCacheRepositoryShape['findByProjectId']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                yield* Effect.logDebug(
                    `Finding cache entries for project: ${projectId}`
                )
                return yield* storage(database, async (db) =>
                    db
                        .select()
                        .from(deploymentCache)
                        .where(eq(deploymentCache.projectId, projectId))
                        .orderBy(desc(deploymentCache.createdAt))
                )
            })
        }

        /**
         * Find all cache entries for a repository
         */
        findByRepository(
            projectId: string,
            repositoryId: string
        ): ReturnType<GithubDeploymentCacheRepositoryShape['findByRepository']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                yield* Effect.logDebug(
                    `Finding cache entries for repository: ${repositoryId}`
                )
                return yield* storage(database, async (db) =>
                    db
                        .select()
                        .from(deploymentCache)
                        .where(
                            and(
                                eq(deploymentCache.projectId, projectId),
                                eq(deploymentCache.repositoryId, repositoryId)
                            )
                        )
                        .orderBy(desc(deploymentCache.createdAt))
                )
            })
        }

        /**
         * Update cache entry with deployment ID
         */
        updateDeploymentId(
            id: string,
            deploymentId: string
        ): ReturnType<GithubDeploymentCacheRepositoryShape['updateDeploymentId']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                yield* Effect.logInfo(
                    `Updating cache entry ${id} with deployment ${deploymentId}`
                )
                return yield* storage(database, async (db) => {
                    const [entry] = await db
                        .update(deploymentCache)
                        .set({ deploymentId })
                        .where(eq(deploymentCache.id, id))
                        .returning()

                    return entry ?? null
                })
            })
        }

        /**
         * Delete a cache entry
         */
        delete(
            id: string
        ): ReturnType<GithubDeploymentCacheRepositoryShape['delete']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                yield* Effect.logInfo(`Deleting cache entry: ${id}`)
                return yield* storage(database, async (db) => {
                    const result = await db
                        .delete(deploymentCache)
                        .where(eq(deploymentCache.id, id))

                    return result.rowCount ? result.rowCount > 0 : false
                })
            })
        }

        /**
         * Delete all cache entries for a branch
         */
        deleteByBranch(
            projectId: string,
            repositoryId: string,
            branch: string
        ): ReturnType<GithubDeploymentCacheRepositoryShape['deleteByBranch']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                yield* Effect.logInfo(
                    `Deleting cache entries for ${repositoryId}@${branch}`
                )
                return yield* storage(database, async (db) => {
                    const result = await db
                        .delete(deploymentCache)
                        .where(
                            and(
                                eq(deploymentCache.projectId, projectId),
                                eq(deploymentCache.repositoryId, repositoryId),
                                eq(deploymentCache.branch, branch)
                            )
                        )

                    return result.rowCount ?? 0
                })
            })
        }

        /**
         * Delete multiple cache entries by IDs
         */
        deleteMany(
            ids: string[]
        ): ReturnType<GithubDeploymentCacheRepositoryShape['deleteMany']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                yield* Effect.logInfo(
                    `Deleting ${String(ids.length)} cache entries`
                )
                return yield* storage(database, async (db) => {
                    let deletedCount = 0
                    for (const id of ids) {
                        const result = await db
                            .delete(deploymentCache)
                            .where(eq(deploymentCache.id, id))

                        if (result.rowCount) {
                            deletedCount += result.rowCount
                        }
                    }

                    return deletedCount
                })
            })
        }
    }
}
