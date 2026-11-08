import { and, eq, isNull, ne } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { previewEnvironments } from '@deployer/nest-schema/global/fleet/deployment'
import { services } from '@deployer/nest-schema/global/project/deployment'
import {
    serviceDomainMappings,
    projectDomains,
} from '@deployer/nest-schema/global/project/domain'

import { DatabasePort, StorageFailure, storage } from '../../database/storage'

type ServiceDomainMapping = typeof serviceDomainMappings.$inferSelect
type InsertServiceDomainMapping = typeof serviceDomainMappings.$inferInsert

/** Joined mapping + project-domain row, used by URL resolution. */
export type ServiceUrlRow = {
    mappingId: string
    subdomain: string | null
    basePath: string | null
    isPrimary: boolean
    sslEnabled: boolean
    sslProvider: ServiceDomainMapping['sslProvider']
    orgDomain: string
}

export type MappingWithServiceName = {
    serviceId: string
    serviceName: string
    subdomain: string | null
    basePath: string | null
}

type Failure = StorageFailure

export type ServiceDomainMappingRepositoryShape = {
    readonly create: (
        data: InsertServiceDomainMapping
    ) => Effect.Effect<ServiceDomainMapping, Failure, DatabasePort>
    readonly findById: (
        id: string
    ) => Effect.Effect<ServiceDomainMapping | null, Failure, DatabasePort>
    readonly findByServiceId: (
        serviceId: string
    ) => Effect.Effect<ServiceDomainMapping[], Failure, DatabasePort>
    readonly findByProjectDomainId: (
        projectDomainId: string
    ) => Effect.Effect<ServiceDomainMapping[], Failure, DatabasePort>
    readonly findByServiceAndProjectDomain: (
        serviceId: string,
        projectDomainId: string
    ) => Effect.Effect<
        ServiceDomainMapping | null,
        Failure,
        DatabasePort
    >
    /** True when no other row uses this subdomain + base path on the project domain. */
    readonly isCombinationAvailable: (
        projectDomainId: string,
        subdomain: string | null,
        basePath: string,
        excludeId?: string
    ) => Effect.Effect<boolean, Failure, DatabasePort>
    readonly hasProjectDomainMappings: (
        projectDomainId: string
    ) => Effect.Effect<boolean, Failure, DatabasePort>
    /** `null` when the mapping is gone. */
    readonly getFullUrl: (
        mappingId: string
    ) => Effect.Effect<string | null, Failure, DatabasePort>
    readonly findByServiceIdWithUrls: (
        serviceId: string
    ) => Effect.Effect<
        (ServiceDomainMapping & { fullUrl: string })[],
        Failure,
        DatabasePort
    >
    readonly update: (
        id: string,
        data: Partial<ServiceDomainMapping>
    ) => Effect.Effect<
        ServiceDomainMapping | null,
        Failure,
        DatabasePort
    >
    /** Whether a row was deleted. */
    readonly delete: (
        id: string
    ) => Effect.Effect<boolean, Failure, DatabasePort>
    readonly countByServiceId: (
        serviceId: string
    ) => Effect.Effect<number, Failure, DatabasePort>
    readonly countByProjectDomainId: (
        projectDomainId: string
    ) => Effect.Effect<number, Failure, DatabasePort>
    readonly findBySubdomain: (
        projectDomainId: string,
        subdomain: string | null
    ) => Effect.Effect<ServiceDomainMapping[], Failure, DatabasePort>
    /** Mapping + project-domain rows of a service, oldest first. */
    readonly findServiceUrlRows: (
        serviceId: string
    ) => Effect.Effect<ServiceUrlRow[], Failure, DatabasePort>
    /** The project-domain id a mapping belongs to (`null` when the mapping is gone). */
    readonly findProjectDomainIdByMappingId: (
        mappingId: string
    ) => Effect.Effect<string | null, Failure, DatabasePort>
    /**
     * Mark every preview-environment row pointing at `fullDomain` inactive (promote-preview-to-stable flow).
     * Writes the global schema directly: this repository is the routing domain's data-access layer.
     */
    readonly deactivatePreviewEnvironmentsByFullDomain: (
        fullDomain: string
    ) => Effect.Effect<void, Failure, DatabasePort>
    readonly findByProjectDomainAndPathWithServiceNames: (
        projectDomainId: string,
        subdomain: string | null,
        basePath?: string | null,
        excludeServiceId?: string
    ) => Effect.Effect<MappingWithServiceName[], Failure, DatabasePort>
}

const subdomainIs = (subdomain: string | null) =>
    subdomain === null
        ? isNull(serviceDomainMappings.subdomain)
        : eq(serviceDomainMappings.subdomain, subdomain)

const first = <A>(rows: A[]): A | null => rows[0] ?? null

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * Every operation yields `DatabasePort` when it runs, so the requirement channel names the connection
 * it reads and a spec provides only that.
 */
export class ServiceDomainMappingRepository extends Context.Service<
    ServiceDomainMappingRepository,
    ServiceDomainMappingRepositoryShape
>()('shared/ServiceDomainMappingRepository') {
    static readonly live = class ServiceDomainMappingRepositoryImpl
        implements ServiceDomainMappingRepositoryShape
    {
        /** Whether the query returns any row; the query decides, so nothing is materialized. */
        private existsAny(
            run: (
                db: Parameters<Parameters<typeof storage>[1]>[0]
            ) => Promise<unknown[]>
        ): Effect.Effect<boolean, Failure, DatabasePort> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, run)
                return rows.length > 0
            })
        }

        getFullUrl(
            mappingId: string
        ): ReturnType<ServiceDomainMappingRepositoryShape['getFullUrl']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select({
                            subdomain: serviceDomainMappings.subdomain,
                            basePath: serviceDomainMappings.basePath,
                            orgDomain: projectDomains.domain,
                        })
                        .from(serviceDomainMappings)
                        .innerJoin(
                            projectDomains,
                            eq(
                                serviceDomainMappings.projectDomainId,
                                projectDomains.id
                            )
                        )
                        .where(eq(serviceDomainMappings.id, mappingId))
                        .limit(1)
                )
                const row = rows[0]
                if (!row) return null
                const domain = row.subdomain
                    ? `${row.subdomain}.${row.orgDomain}`
                    : row.orgDomain
                return `https://${domain}${row.basePath ?? ''}` // HTTPS by default, for security
            })
        }

        findByServiceId(
            serviceId: string
        ): ReturnType<ServiceDomainMappingRepositoryShape['findByServiceId']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* storage(database, (db) =>
                    db
                        .select()
                        .from(serviceDomainMappings)
                        .where(eq(serviceDomainMappings.serviceId, serviceId))
                )
            })
        }

        create(
            data: InsertServiceDomainMapping
        ): ReturnType<ServiceDomainMappingRepositoryShape['create']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const [mapping] = yield* storage(database, (db) =>
                    db.insert(serviceDomainMappings).values(data).returning()
                )
                if (!mapping)
                    return yield* Effect.fail(
                        new StorageFailure({
                            cause: new Error('insert returned no row'),
                        })
                    )
                yield* Effect.logDebug(
                    `Created service domain mapping for service ${mapping.serviceId}`
                )
                return mapping
            })
        }

        findById(
            id: string
        ): ReturnType<ServiceDomainMappingRepositoryShape['findById']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select()
                        .from(serviceDomainMappings)
                        .where(eq(serviceDomainMappings.id, id))
                        .limit(1)
                )
                return first(rows)
            })
        }

        findByProjectDomainId(
            projectDomainId: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['findByProjectDomainId']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* storage(database, (db) =>
                    db
                        .select()
                        .from(serviceDomainMappings)
                        .where(
                            eq(
                                serviceDomainMappings.projectDomainId,
                                projectDomainId
                            )
                        )
                )
            })
        }

        findByServiceAndProjectDomain(
            serviceId: string,
            projectDomainId: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['findByServiceAndProjectDomain']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select()
                        .from(serviceDomainMappings)
                        .where(
                            and(
                                eq(serviceDomainMappings.serviceId, serviceId),
                                eq(
                                    serviceDomainMappings.projectDomainId,
                                    projectDomainId
                                )
                            )
                        )
                        .limit(1)
                )
                return first(rows)
            })
        }

        isCombinationAvailable(
            projectDomainId: string,
            subdomain: string | null,
            basePath: string,
            excludeId?: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['isCombinationAvailable']
        > {
            return this.existsAny((db) =>
                db
                    .select({ id: serviceDomainMappings.id })
                    .from(serviceDomainMappings)
                    .where(
                        and(
                            eq(
                                serviceDomainMappings.projectDomainId,
                                projectDomainId
                            ),
                            subdomainIs(subdomain),
                            eq(serviceDomainMappings.basePath, basePath),
                            ...(excludeId
                                ? [ne(serviceDomainMappings.id, excludeId)]
                                : [])
                        )
                    )
                    .limit(1)
            ).pipe(Effect.map((taken) => !taken))
        }

        hasProjectDomainMappings(
            projectDomainId: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['hasProjectDomainMappings']
        > {
            return this.existsAny((db) =>
                db
                    .select({ id: serviceDomainMappings.id })
                    .from(serviceDomainMappings)
                    .where(
                        eq(
                            serviceDomainMappings.projectDomainId,
                            projectDomainId
                        )
                    )
                    .limit(1)
            )
        }

        findByServiceIdWithUrls(
            serviceId: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['findByServiceIdWithUrls']
        > {
            return Effect.gen({ self: this }, function* () {
                const mappings = yield* this.findByServiceId(serviceId)
                return yield* Effect.all(
                    mappings.map((mapping) =>
                        this.getFullUrl(mapping.id).pipe(
                            Effect.map((fullUrl) => ({
                                ...mapping,
                                fullUrl: fullUrl ?? '',
                            }))
                        )
                    )
                )
            })
        }

        update(
            id: string,
            data: Partial<ServiceDomainMapping>
        ): ReturnType<ServiceDomainMappingRepositoryShape['update']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .update(serviceDomainMappings)
                        .set({ ...data, updatedAt: new Date() })
                        .where(eq(serviceDomainMappings.id, id))
                        .returning()
                )
                const updated = first(rows)
                if (updated)
                    yield* Effect.logDebug(
                        `Updated service domain mapping: ${id}`
                    )
                return updated
            })
        }

        delete(
            id: string
        ): ReturnType<ServiceDomainMappingRepositoryShape['delete']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const result = yield* storage(database, (db) =>
                    db
                        .delete(serviceDomainMappings)
                        .where(eq(serviceDomainMappings.id, id))
                )
                const deleted = (result.rowCount ?? 0) > 0
                if (deleted)
                    yield* Effect.logDebug(
                        `Deleted service domain mapping: ${id}`
                    )
                return deleted
            })
        }

        countByServiceId(
            serviceId: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['countByServiceId']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select({ count: serviceDomainMappings.id })
                        .from(serviceDomainMappings)
                        .where(eq(serviceDomainMappings.serviceId, serviceId))
                )
                return rows.length
            })
        }

        countByProjectDomainId(
            projectDomainId: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['countByProjectDomainId']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select({ count: serviceDomainMappings.id })
                        .from(serviceDomainMappings)
                        .where(
                            eq(
                                serviceDomainMappings.projectDomainId,
                                projectDomainId
                            )
                        )
                )
                return rows.length
            })
        }

        findBySubdomain(
            projectDomainId: string,
            subdomain: string | null
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['findBySubdomain']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* storage(database, (db) =>
                    db
                        .select()
                        .from(serviceDomainMappings)
                        .where(
                            and(
                                eq(
                                    serviceDomainMappings.projectDomainId,
                                    projectDomainId
                                ),
                                subdomainIs(subdomain)
                            )
                        )
                )
            })
        }

        findServiceUrlRows(
            serviceId: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['findServiceUrlRows']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* storage(database, (db) =>
                    db
                        .select({
                            mappingId: serviceDomainMappings.id,
                            subdomain: serviceDomainMappings.subdomain,
                            basePath: serviceDomainMappings.basePath,
                            isPrimary: serviceDomainMappings.isPrimary,
                            sslEnabled: serviceDomainMappings.sslEnabled,
                            sslProvider: serviceDomainMappings.sslProvider,
                            orgDomain: projectDomains.domain,
                        })
                        .from(serviceDomainMappings)
                        .innerJoin(
                            projectDomains,
                            eq(
                                serviceDomainMappings.projectDomainId,
                                projectDomains.id
                            )
                        )
                        .where(eq(serviceDomainMappings.serviceId, serviceId))
                        .orderBy(serviceDomainMappings.createdAt)
                )
            })
        }

        findProjectDomainIdByMappingId(
            mappingId: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['findProjectDomainIdByMappingId']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                const rows = yield* storage(database, (db) =>
                    db
                        .select({
                            projectDomainId:
                                serviceDomainMappings.projectDomainId,
                        })
                        .from(serviceDomainMappings)
                        .where(eq(serviceDomainMappings.id, mappingId))
                        .limit(1)
                )
                return rows[0]?.projectDomainId ?? null
            })
        }

        deactivatePreviewEnvironmentsByFullDomain(
            fullDomain: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['deactivatePreviewEnvironmentsByFullDomain']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                yield* storage(database, (db) =>
                    db
                        .update(previewEnvironments)
                        .set({ isActive: false, updatedAt: new Date() })
                        .where(eq(previewEnvironments.fullDomain, fullDomain))
                )
            })
        }

        findByProjectDomainAndPathWithServiceNames(
            projectDomainId: string,
            subdomain: string | null,
            _basePath?: string | null,
            excludeServiceId?: string
        ): ReturnType<
            ServiceDomainMappingRepositoryShape['findByProjectDomainAndPathWithServiceNames']
        > {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* storage(database, (db) =>
                    db
                        .select({
                            serviceId: serviceDomainMappings.serviceId,
                            serviceName: services.name,
                            subdomain: serviceDomainMappings.subdomain,
                            basePath: serviceDomainMappings.basePath,
                        })
                        .from(serviceDomainMappings)
                        .innerJoin(
                            services,
                            eq(services.id, serviceDomainMappings.serviceId)
                        )
                        .where(
                            and(
                                eq(
                                    serviceDomainMappings.projectDomainId,
                                    projectDomainId
                                ),
                                subdomainIs(subdomain),
                                ...(excludeServiceId
                                    ? [
                                          ne(
                                              serviceDomainMappings.serviceId,
                                              excludeServiceId
                                          ),
                                      ]
                                    : [])
                            )
                        )
                )
            })
        }
    }
}
