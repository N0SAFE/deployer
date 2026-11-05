import { Context, Effect } from 'effect'

import { serviceOver, type Over } from '@deployer/effect-core'

import { DatabasePort, type StorageFailure } from '../../database/storage'
import {
    ServiceDomainMappingRepository,
    type MappingWithServiceName,
} from '../repositories/service-domain-mapping.repository'

import type {
    ServiceDomainMapping,
    InsertServiceDomainMapping,
    ServiceDomainMappingWithUrls,
} from '../interfaces'

type Failure = StorageFailure
/** What the repository the service forwards to needs from the container. */
type Needs = DatabasePort

export type ServiceDomainMappingServiceShape = {
    readonly create: (
        data: InsertServiceDomainMapping
    ) => Effect.Effect<ServiceDomainMapping, Failure, Needs>
    readonly findById: (
        id: string
    ) => Effect.Effect<ServiceDomainMapping | null, Failure, Needs>
    readonly findByServiceId: (
        serviceId: string
    ) => Effect.Effect<ServiceDomainMapping[], Failure, Needs>
    readonly findByServiceIdWithUrls: (
        serviceId: string
    ) => Effect.Effect<ServiceDomainMappingWithUrls[], Failure, Needs>
    readonly findByProjectDomainId: (
        projectDomainId: string
    ) => Effect.Effect<ServiceDomainMapping[], Failure, Needs>
    readonly findByProjectDomainAndPath: (
        projectDomainId: string,
        subdomain: string | null,
        basePath?: string | null,
        excludeServiceId?: string
    ) => Effect.Effect<Partial<ServiceDomainMapping>[], Failure, Needs>
    readonly findByExactMatch: (
        projectDomainId: string,
        subdomain: string | null,
        basePath: string | null
    ) => Effect.Effect<ServiceDomainMapping | null, Failure, Needs>
    readonly update: (
        id: string,
        data: Partial<ServiceDomainMapping>
    ) => Effect.Effect<ServiceDomainMapping | null, Failure, Needs>
    readonly delete: (id: string) => Effect.Effect<boolean, Failure, Needs>
    /** How many mappings were deleted. */
    readonly deleteByServiceId: (
        serviceId: string
    ) => Effect.Effect<number, Failure, Needs>
    readonly countByProjectDomainId: (
        projectDomainId: string
    ) => Effect.Effect<number, Failure, Needs>
    readonly findByProjectDomainAndPathWithServiceNames: (
        projectDomainId: string,
        subdomain: string | null,
        basePath?: string | null,
        excludeServiceId?: string
    ) => Effect.Effect<MappingWithServiceName[], Failure, Needs>
}

type Ports = {
    readonly repository: Context.Service.Shape<
        typeof ServiceDomainMappingRepository
    >
}

function makeServiceDomainMappingService({
    repository,
}: Ports): ServiceDomainMappingServiceShape {
    return {
        create: (data) => repository.create(data),
        findById: (id) => repository.findById(id),
        findByServiceId: (serviceId) => repository.findByServiceId(serviceId),
        findByServiceIdWithUrls: (serviceId) =>
            repository.findByServiceIdWithUrls(serviceId),
        findByProjectDomainId: (projectDomainId) =>
            repository.findByProjectDomainId(projectDomainId),
        findByProjectDomainAndPath: (
            projectDomainId,
            subdomain,
            basePath,
            excludeServiceId
        ) =>
            repository
                .findByProjectDomainAndPathWithServiceNames(
                    projectDomainId,
                    subdomain,
                    basePath,
                    excludeServiceId
                )
                .pipe(
                    Effect.map((rows) =>
                        rows.map((r) => ({
                            serviceId: r.serviceId,
                            subdomain: r.subdomain,
                            basePath: r.basePath,
                        }))
                    )
                ),
        findByExactMatch: (projectDomainId, subdomain, basePath) =>
            repository
                .findByProjectDomainId(projectDomainId)
                .pipe(
                    Effect.map(
                        (mappings) =>
                            mappings.find(
                                (m) =>
                                    m.subdomain === subdomain &&
                                    m.basePath === basePath
                            ) ?? null
                    )
                ),
        update: (id, data) => repository.update(id, data),
        delete: (id) => repository.delete(id),
        deleteByServiceId: (serviceId) =>
            repository.findByServiceId(serviceId).pipe(
                Effect.flatMap((mappings) =>
                    Effect.forEach(mappings, (m) => repository.delete(m.id))
                ),
                Effect.map((results) => results.filter(Boolean).length)
            ),
        countByProjectDomainId: (projectDomainId) =>
            repository.countByProjectDomainId(projectDomainId),
        findByProjectDomainAndPathWithServiceNames: (
            projectDomainId,
            subdomain,
            basePath,
            excludeServiceId
        ) =>
            repository.findByProjectDomainAndPathWithServiceNames(
                projectDomainId,
                subdomain,
                basePath,
                excludeServiceId
            ),
    }
}

export class ServiceDomainMappingService extends Context.Service<
    ServiceDomainMappingService,
    Over<ServiceDomainMappingServiceShape, ServiceDomainMappingRepository>
>()('shared/ServiceDomainMappingService') {
    static readonly live = serviceOver(
        Effect.all({ repository: ServiceDomainMappingRepository }),
        makeServiceDomainMappingService
    )
}
