import { and, eq, ne } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { projectDomains } from '@deployer/nest-schema/global/project/domain'

import { DatabasePort, StorageFailure, storage } from '../../database/storage'

type ProjectDomain = typeof projectDomains.$inferSelect
type InsertProjectDomain = typeof projectDomains.$inferInsert

export type ProjectDomainRepositoryShape = {
    /** Domains attach directly to a project. */
    readonly create: (
        data: InsertProjectDomain
    ) => Effect.Effect<ProjectDomain, StorageFailure, DatabasePort>
    readonly findById: (
        id: string
    ) => Effect.Effect<ProjectDomain | null, StorageFailure, DatabasePort>
    readonly findByProjectId: (
        projectId: string
    ) => Effect.Effect<ProjectDomain[], StorageFailure, DatabasePort>
    readonly findByProjectAndDomain: (
        projectId: string,
        domain: string
    ) => Effect.Effect<
        ProjectDomain | null,
        StorageFailure,
        DatabasePort
    >
    /** Whether the project already has this domain name (optionally ignoring one row). */
    readonly hasProjectDomain: (
        projectId: string,
        domain: string,
        excludeId?: string
    ) => Effect.Effect<boolean, StorageFailure, DatabasePort>
    /** Pending domains, for the auto-verification sweep. */
    readonly findPending: () => Effect.Effect<
        ProjectDomain[],
        StorageFailure,
        DatabasePort
    >
    /** The project's own verified domains (direct-domain model, no org). */
    readonly getAvailableDomainsForProject: (
        projectId: string
    ) => Effect.Effect<
        { id: string; domain: string; verifiedAt: Date }[],
        StorageFailure,
        DatabasePort
    >
    /** `null` when the row does not exist. */
    readonly update: (
        id: string,
        data: Partial<ProjectDomain>
    ) => Effect.Effect<
        ProjectDomain | null,
        StorageFailure,
        DatabasePort
    >
    readonly updateAllowedSubdomains: (
        id: string,
        allowedSubdomains: string[]
    ) => Effect.Effect<
        ProjectDomain | null,
        StorageFailure,
        DatabasePort
    >
    /** Whether a row was deleted. */
    readonly delete: (
        id: string
    ) => Effect.Effect<boolean, StorageFailure, DatabasePort>
    readonly countByProjectId: (
        projectId: string
    ) => Effect.Effect<number, StorageFailure, DatabasePort>
}

const first = <A>(rows: A[]): A | null => rows[0] ?? null

export class ProjectDomainRepository extends Context.Service<
    ProjectDomainRepository,
    ProjectDomainRepositoryShape
>()('shared/ProjectDomainRepository') {
    static readonly live = class ProjectDomainRepositoryImpl
        implements ProjectDomainRepositoryShape
    {
        create(
            data: InsertProjectDomain
        ): ReturnType<ProjectDomainRepositoryShape['create']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const [domain] = yield* storage(database, (db) =>
                    db.insert(projectDomains).values(data).returning()
                )
                if (!domain) {
                    return yield* Effect.fail(
                        new StorageFailure({
                            cause: new Error('insert returned no row'),
                        })
                    )
                }
                yield* Effect.logDebug(
                    `Created project domain ${domain.domain} for project ${domain.projectId}`
                )
                return domain
            })
        }

        findById(
            id: string
        ): ReturnType<ProjectDomainRepositoryShape['findById']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select()
                        .from(projectDomains)
                        .where(eq(projectDomains.id, id))
                        .limit(1)
                )
                return first(rows)
            })
        }

        findByProjectId(
            projectId: string
        ): ReturnType<ProjectDomainRepositoryShape['findByProjectId']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* storage(database, (db) =>
                    db
                        .select()
                        .from(projectDomains)
                        .where(eq(projectDomains.projectId, projectId))
                )
            })
        }

        findByProjectAndDomain(
            projectId: string,
            domain: string
        ): ReturnType<ProjectDomainRepositoryShape['findByProjectAndDomain']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select()
                        .from(projectDomains)
                        .where(
                            and(
                                eq(projectDomains.projectId, projectId),
                                eq(projectDomains.domain, domain)
                            )
                        )
                        .limit(1)
                )
                return first(rows)
            })
        }

        hasProjectDomain(
            projectId: string,
            domain: string,
            excludeId?: string
        ): ReturnType<ProjectDomainRepositoryShape['hasProjectDomain']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select({ id: projectDomains.id })
                        .from(projectDomains)
                        .where(
                            and(
                                eq(projectDomains.projectId, projectId),
                                eq(projectDomains.domain, domain),
                                ...(excludeId
                                    ? [ne(projectDomains.id, excludeId)]
                                    : [])
                            )
                        )
                        .limit(1)
                )
                return rows.length > 0
            })
        }

        findPending(): ReturnType<ProjectDomainRepositoryShape['findPending']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* storage(database, (db) =>
                    db
                        .select()
                        .from(projectDomains)
                        .where(eq(projectDomains.verificationStatus, 'pending'))
                )
            })
        }

        getAvailableDomainsForProject(
            projectId: string
        ): ReturnType<
            ProjectDomainRepositoryShape['getAvailableDomainsForProject']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select({
                            id: projectDomains.id,
                            domain: projectDomains.domain,
                            verifiedAt: projectDomains.verifiedAt,
                        })
                        .from(projectDomains)
                        .where(
                            and(
                                eq(projectDomains.projectId, projectId),
                                eq(
                                    projectDomains.verificationStatus,
                                    'verified'
                                )
                            )
                        )
                )
                return rows.filter(
                    (d): d is typeof d & { verifiedAt: Date } =>
                        d.verifiedAt !== null
                )
            })
        }

        update(
            id: string,
            data: Partial<ProjectDomain>
        ): ReturnType<ProjectDomainRepositoryShape['update']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .update(projectDomains)
                        .set({ ...data, updatedAt: new Date() })
                        .where(eq(projectDomains.id, id))
                        .returning()
                )
                const updated = first(rows)
                if (updated)
                    yield* Effect.logDebug(`Updated project domain: ${id}`)
                return updated
            })
        }

        updateAllowedSubdomains(
            id: string,
            allowedSubdomains: string[]
        ): ReturnType<
            ProjectDomainRepositoryShape['updateAllowedSubdomains']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .update(projectDomains)
                        .set({ allowedSubdomains, updatedAt: new Date() })
                        .where(eq(projectDomains.id, id))
                        .returning()
                )
                const updated = first(rows)
                if (updated)
                    yield* Effect.logInfo(
                        `Updated allowed subdomains for project domain ${id}: [${allowedSubdomains.join(', ')}]`
                    )
                return updated
            })
        }

        delete(
            id: string
        ): ReturnType<ProjectDomainRepositoryShape['delete']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const result = yield* storage(database, (db) =>
                    db.delete(projectDomains).where(eq(projectDomains.id, id))
                )
                const deleted = (result.rowCount ?? 0) > 0
                if (deleted)
                    yield* Effect.logDebug(`Deleted project domain: ${id}`)
                return deleted
            })
        }

        countByProjectId(
            projectId: string
        ): ReturnType<ProjectDomainRepositoryShape['countByProjectId']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select({ count: projectDomains.id })
                        .from(projectDomains)
                        .where(eq(projectDomains.projectId, projectId))
                )
                return rows.length
            })
        }
    }
}
