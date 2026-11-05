import { and, eq, ne } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { serviceOver, type Over } from '@deployer/effect-core'
import { projectDomains } from '@deployer/nest-schema/global/project/domain'

import { DatabasePort, StorageFailure, storage } from '../../database/storage'

type ProjectDomain = typeof projectDomains.$inferSelect
type InsertProjectDomain = typeof projectDomains.$inferInsert

export type ProjectDomainRepositoryShape = {
    /** Domains attach directly to a project. */
    readonly create: (
        data: InsertProjectDomain
    ) => Effect.Effect<ProjectDomain, StorageFailure>
    readonly findById: (
        id: string
    ) => Effect.Effect<ProjectDomain | null, StorageFailure>
    readonly findByProjectId: (
        projectId: string
    ) => Effect.Effect<ProjectDomain[], StorageFailure>
    readonly findByProjectAndDomain: (
        projectId: string,
        domain: string
    ) => Effect.Effect<ProjectDomain | null, StorageFailure>
    /** Whether the project already has this domain name (optionally ignoring one row). */
    readonly hasProjectDomain: (
        projectId: string,
        domain: string,
        excludeId?: string
    ) => Effect.Effect<boolean, StorageFailure>
    /** Pending domains, for the auto-verification sweep. */
    readonly findPending: () => Effect.Effect<ProjectDomain[], StorageFailure>
    /** The project's own verified domains (direct-domain model, no org). */
    readonly getAvailableDomainsForProject: (
        projectId: string
    ) => Effect.Effect<
        { id: string; domain: string; verifiedAt: Date }[],
        StorageFailure
    >
    /** `null` when the row does not exist. */
    readonly update: (
        id: string,
        data: Partial<ProjectDomain>
    ) => Effect.Effect<ProjectDomain | null, StorageFailure>
    readonly updateAllowedSubdomains: (
        id: string,
        allowedSubdomains: string[]
    ) => Effect.Effect<ProjectDomain | null, StorageFailure>
    /** Whether a row was deleted. */
    readonly delete: (id: string) => Effect.Effect<boolean, StorageFailure>
    readonly countByProjectId: (
        projectId: string
    ) => Effect.Effect<number, StorageFailure>
}

type Ports = { readonly database: Context.Service.Shape<typeof DatabasePort> }

export function makeProjectDomainRepository({
    database,
}: Ports): ProjectDomainRepositoryShape {
    const first = <A>(rows: A[]): A | null => rows[0] ?? null
    return {
        create: (data) =>
            storage(database, (db) =>
                db.insert(projectDomains).values(data).returning()
            ).pipe(
                Effect.flatMap(([domain]) =>
                    domain
                        ? Effect.logDebug(
                              `Created project domain ${domain.domain} for project ${domain.projectId}`
                          ).pipe(Effect.as(domain))
                        : Effect.fail(
                              new StorageFailure({
                                  cause: new Error('insert returned no row'),
                              })
                          )
                )
            ),

        findById: (id) =>
            storage(database, (db) =>
                db
                    .select()
                    .from(projectDomains)
                    .where(eq(projectDomains.id, id))
                    .limit(1)
            ).pipe(Effect.map(first)),

        findByProjectId: (projectId) =>
            storage(database, (db) =>
                db
                    .select()
                    .from(projectDomains)
                    .where(eq(projectDomains.projectId, projectId))
            ),

        findByProjectAndDomain: (projectId, domain) =>
            storage(database, (db) =>
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
            ).pipe(Effect.map(first)),

        hasProjectDomain: (projectId, domain, excludeId) =>
            storage(database, (db) =>
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
            ).pipe(Effect.map((rows) => rows.length > 0)),

        findPending: () =>
            storage(database, (db) =>
                db
                    .select()
                    .from(projectDomains)
                    .where(eq(projectDomains.verificationStatus, 'pending'))
            ),

        getAvailableDomainsForProject: (projectId) =>
            storage(database, (db) =>
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
                            eq(projectDomains.verificationStatus, 'verified')
                        )
                    )
            ).pipe(
                Effect.map((rows) =>
                    rows.filter(
                        (d): d is typeof d & { verifiedAt: Date } =>
                            d.verifiedAt !== null
                    )
                )
            ),

        update: (id, data) =>
            storage(database, (db) =>
                db
                    .update(projectDomains)
                    .set({ ...data, updatedAt: new Date() })
                    .where(eq(projectDomains.id, id))
                    .returning()
            ).pipe(
                Effect.map(first),
                Effect.tap((updated) =>
                    updated
                        ? Effect.logDebug(`Updated project domain: ${id}`)
                        : Effect.void
                )
            ),

        updateAllowedSubdomains: (id, allowedSubdomains) =>
            storage(database, (db) =>
                db
                    .update(projectDomains)
                    .set({ allowedSubdomains, updatedAt: new Date() })
                    .where(eq(projectDomains.id, id))
                    .returning()
            ).pipe(
                Effect.map(first),
                Effect.tap((updated) =>
                    updated
                        ? Effect.logInfo(
                              `Updated allowed subdomains for project domain ${id}: [${allowedSubdomains.join(', ')}]`
                          )
                        : Effect.void
                )
            ),

        delete: (id) =>
            storage(database, (db) =>
                db.delete(projectDomains).where(eq(projectDomains.id, id))
            ).pipe(
                Effect.map((result) => (result.rowCount ?? 0) > 0),
                Effect.tap((deleted) =>
                    deleted
                        ? Effect.logDebug(`Deleted project domain: ${id}`)
                        : Effect.void
                )
            ),

        countByProjectId: (projectId) =>
            storage(database, (db) =>
                db
                    .select({ count: projectDomains.id })
                    .from(projectDomains)
                    .where(eq(projectDomains.projectId, projectId))
            ).pipe(Effect.map((rows) => rows.length)),
    }
}

export class ProjectDomainRepository extends Context.Service<
    ProjectDomainRepository,
    Over<ProjectDomainRepositoryShape, DatabasePort>
>()('shared/ProjectDomainRepository') {
    static readonly live = serviceOver(
        Effect.all({ database: DatabasePort }),
        makeProjectDomainRepository
    )
}
