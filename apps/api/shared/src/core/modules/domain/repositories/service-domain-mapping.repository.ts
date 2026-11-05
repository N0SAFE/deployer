import { and, eq, isNull, ne } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { serviceOver, type Over } from '@deployer/effect-core'
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
    ) => Effect.Effect<ServiceDomainMapping, Failure>
    readonly findById: (
        id: string
    ) => Effect.Effect<ServiceDomainMapping | null, Failure>
    readonly findByServiceId: (
        serviceId: string
    ) => Effect.Effect<ServiceDomainMapping[], Failure>
    readonly findByProjectDomainId: (
        projectDomainId: string
    ) => Effect.Effect<ServiceDomainMapping[], Failure>
    readonly findByServiceAndProjectDomain: (
        serviceId: string,
        projectDomainId: string
    ) => Effect.Effect<ServiceDomainMapping | null, Failure>
    /** True when no other row uses this subdomain + base path on the project domain. */
    readonly isCombinationAvailable: (
        projectDomainId: string,
        subdomain: string | null,
        basePath: string,
        excludeId?: string
    ) => Effect.Effect<boolean, Failure>
    readonly hasProjectDomainMappings: (
        projectDomainId: string
    ) => Effect.Effect<boolean, Failure>
    /** `null` when the mapping is gone. */
    readonly getFullUrl: (
        mappingId: string
    ) => Effect.Effect<string | null, Failure>
    readonly findByServiceIdWithUrls: (
        serviceId: string
    ) => Effect.Effect<(ServiceDomainMapping & { fullUrl: string })[], Failure>
    readonly update: (
        id: string,
        data: Partial<ServiceDomainMapping>
    ) => Effect.Effect<ServiceDomainMapping | null, Failure>
    /** Whether a row was deleted. */
    readonly delete: (id: string) => Effect.Effect<boolean, Failure>
    readonly countByServiceId: (
        serviceId: string
    ) => Effect.Effect<number, Failure>
    readonly countByProjectDomainId: (
        projectDomainId: string
    ) => Effect.Effect<number, Failure>
    readonly findBySubdomain: (
        projectDomainId: string,
        subdomain: string | null
    ) => Effect.Effect<ServiceDomainMapping[], Failure>
    /** Mapping + project-domain rows of a service, oldest first. */
    readonly findServiceUrlRows: (
        serviceId: string
    ) => Effect.Effect<ServiceUrlRow[], Failure>
    /** The project-domain id a mapping belongs to (`null` when the mapping is gone). */
    readonly findProjectDomainIdByMappingId: (
        mappingId: string
    ) => Effect.Effect<string | null, Failure>
    /**
     * Mark every preview-environment row pointing at `fullDomain` inactive (promote-preview-to-stable flow).
     * Writes the global schema directly: this repository is the routing domain's data-access layer.
     */
    readonly deactivatePreviewEnvironmentsByFullDomain: (
        fullDomain: string
    ) => Effect.Effect<void, Failure>
    readonly findByProjectDomainAndPathWithServiceNames: (
        projectDomainId: string,
        subdomain: string | null,
        basePath?: string | null,
        excludeServiceId?: string
    ) => Effect.Effect<MappingWithServiceName[], Failure>
}

type Ports = { readonly database: Context.Service.Shape<typeof DatabasePort> }

const subdomainIs = (subdomain: string | null) =>
    subdomain === null
        ? isNull(serviceDomainMappings.subdomain)
        : eq(serviceDomainMappings.subdomain, subdomain)

function makeServiceDomainMappingRepository({
    database,
}: Ports): ServiceDomainMappingRepositoryShape {
    const first = <A>(rows: A[]): A | null => rows[0] ?? null

    const getFullUrl: ServiceDomainMappingRepositoryShape['getFullUrl'] = (
        mappingId
    ) =>
        storage(database, (db) =>
            db
                .select({
                    subdomain: serviceDomainMappings.subdomain,
                    basePath: serviceDomainMappings.basePath,
                    orgDomain: projectDomains.domain,
                })
                .from(serviceDomainMappings)
                .innerJoin(
                    projectDomains,
                    eq(serviceDomainMappings.projectDomainId, projectDomains.id)
                )
                .where(eq(serviceDomainMappings.id, mappingId))
                .limit(1)
        ).pipe(
            Effect.map((rows) => {
                const row = rows[0]
                if (!row) return null
                const domain = row.subdomain
                    ? `${row.subdomain}.${row.orgDomain}`
                    : row.orgDomain
                return `https://${domain}${row.basePath ?? ''}` // HTTPS by default, for security
            })
        )

    const findByServiceId: ServiceDomainMappingRepositoryShape['findByServiceId'] =
        (serviceId) =>
            storage(database, (db) =>
                db
                    .select()
                    .from(serviceDomainMappings)
                    .where(eq(serviceDomainMappings.serviceId, serviceId))
            )

    const existsAny = (
        run: (
            db: Parameters<Parameters<typeof storage>[1]>[0]
        ) => Promise<unknown[]>
    ) => storage(database, run).pipe(Effect.map((rows) => rows.length > 0))

    return {
        create: (data) =>
            storage(database, (db) =>
                db.insert(serviceDomainMappings).values(data).returning()
            ).pipe(
                Effect.flatMap(([mapping]) =>
                    mapping
                        ? Effect.logDebug(
                              `Created service domain mapping for service ${mapping.serviceId}`
                          ).pipe(Effect.as(mapping))
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
                    .from(serviceDomainMappings)
                    .where(eq(serviceDomainMappings.id, id))
                    .limit(1)
            ).pipe(Effect.map(first)),

        findByServiceId,

        findByProjectDomainId: (projectDomainId) =>
            storage(database, (db) =>
                db
                    .select()
                    .from(serviceDomainMappings)
                    .where(
                        eq(
                            serviceDomainMappings.projectDomainId,
                            projectDomainId
                        )
                    )
            ),

        findByServiceAndProjectDomain: (serviceId, projectDomainId) =>
            storage(database, (db) =>
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
            ).pipe(Effect.map(first)),

        isCombinationAvailable: (
            projectDomainId,
            subdomain,
            basePath,
            excludeId
        ) =>
            existsAny((db) =>
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
            ).pipe(Effect.map((taken) => !taken)),

        hasProjectDomainMappings: (projectDomainId) =>
            existsAny((db) =>
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
            ),

        getFullUrl,

        findByServiceIdWithUrls: (serviceId) =>
            findByServiceId(serviceId).pipe(
                Effect.flatMap((mappings) =>
                    Effect.all(
                        mappings.map((mapping) =>
                            getFullUrl(mapping.id).pipe(
                                Effect.map((fullUrl) => ({
                                    ...mapping,
                                    fullUrl: fullUrl ?? '',
                                }))
                            )
                        )
                    )
                )
            ),

        update: (id, data) =>
            storage(database, (db) =>
                db
                    .update(serviceDomainMappings)
                    .set({ ...data, updatedAt: new Date() })
                    .where(eq(serviceDomainMappings.id, id))
                    .returning()
            ).pipe(
                Effect.map(first),
                Effect.tap((updated) =>
                    updated
                        ? Effect.logDebug(
                              `Updated service domain mapping: ${id}`
                          )
                        : Effect.void
                )
            ),

        delete: (id) =>
            storage(database, (db) =>
                db
                    .delete(serviceDomainMappings)
                    .where(eq(serviceDomainMappings.id, id))
            ).pipe(
                Effect.map((result) => (result.rowCount ?? 0) > 0),
                Effect.tap((deleted) =>
                    deleted
                        ? Effect.logDebug(
                              `Deleted service domain mapping: ${id}`
                          )
                        : Effect.void
                )
            ),

        countByServiceId: (serviceId) =>
            storage(database, (db) =>
                db
                    .select({ count: serviceDomainMappings.id })
                    .from(serviceDomainMappings)
                    .where(eq(serviceDomainMappings.serviceId, serviceId))
            ).pipe(Effect.map((rows) => rows.length)),

        countByProjectDomainId: (projectDomainId) =>
            storage(database, (db) =>
                db
                    .select({ count: serviceDomainMappings.id })
                    .from(serviceDomainMappings)
                    .where(
                        eq(
                            serviceDomainMappings.projectDomainId,
                            projectDomainId
                        )
                    )
            ).pipe(Effect.map((rows) => rows.length)),

        findBySubdomain: (projectDomainId, subdomain) =>
            storage(database, (db) =>
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
            ),

        findServiceUrlRows: (serviceId) =>
            storage(database, (db) =>
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
            ),

        findProjectDomainIdByMappingId: (mappingId) =>
            storage(database, (db) =>
                db
                    .select({
                        projectDomainId: serviceDomainMappings.projectDomainId,
                    })
                    .from(serviceDomainMappings)
                    .where(eq(serviceDomainMappings.id, mappingId))
                    .limit(1)
            ).pipe(Effect.map((rows) => rows[0]?.projectDomainId ?? null)),

        deactivatePreviewEnvironmentsByFullDomain: (fullDomain) =>
            storage(database, (db) =>
                db
                    .update(previewEnvironments)
                    .set({ isActive: false, updatedAt: new Date() })
                    .where(eq(previewEnvironments.fullDomain, fullDomain))
            ).pipe(Effect.asVoid),

        findByProjectDomainAndPathWithServiceNames: (
            projectDomainId,
            subdomain,
            _basePath,
            excludeServiceId
        ) =>
            storage(database, (db) =>
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
            ),
    }
}

export class ServiceDomainMappingRepository extends Context.Service<
    ServiceDomainMappingRepository,
    Over<ServiceDomainMappingRepositoryShape, DatabasePort>
>()('shared/ServiceDomainMappingRepository') {
    static readonly live = serviceOver(
        Effect.all({ database: DatabasePort }),
        makeServiceDomainMappingRepository
    )
}
