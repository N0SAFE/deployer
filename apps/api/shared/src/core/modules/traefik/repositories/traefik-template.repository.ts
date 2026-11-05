import { eq, and } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import {
    providerTraefikTemplates,
    serviceTraefikTemplates,
    type ProviderTraefikTemplate,
    type ServiceTraefikTemplate,
} from '@deployer/nest-schema/global/traefik/index'

import {
    storage,
    type DatabasePort,
    type StorageFailure,
} from '../../database/storage'

type Ports = { readonly database: Context.Service.Shape<typeof DatabasePort> }

export type TraefikTemplateRepositoryShape = {
    readonly findProviderByType: (
        providerType: string
    ) => Effect.Effect<ProviderTraefikTemplate | null, StorageFailure>
    /** The active template of a service. */
    readonly findActiveByServiceId: (
        serviceId: string
    ) => Effect.Effect<ServiceTraefikTemplate | null, StorageFailure>
    readonly createProviderTemplate: (data: {
        id: string
        providerType: string
        templateName: string
        templateContent: string
        description: string | null
        variables: unknown
        isDefault: boolean
    }) => Effect.Effect<ProviderTraefikTemplate | null, StorageFailure>
    readonly createServiceTemplate: (data: {
        id: string
        serviceId: string
        templateContent: string
        variables: unknown
        isActive: boolean
    }) => Effect.Effect<ServiceTraefikTemplate | null, StorageFailure>
    /** `null` when the template does not exist. */
    readonly updateServiceTemplate: (
        id: string,
        updateData: {
            templateContent?: string
            variables?: unknown
            isActive?: boolean
            updatedAt: Date
        }
    ) => Effect.Effect<ServiceTraefikTemplate | null, StorageFailure>
}

export function makeTraefikTemplateRepository({
    database,
}: Ports): TraefikTemplateRepositoryShape {
    return {
        findProviderByType: (providerType) =>
            storage(database, (db) =>
                db
                    .select()
                    .from(providerTraefikTemplates)
                    .where(
                        eq(providerTraefikTemplates.providerType, providerType)
                    )
                    .limit(1)
            ).pipe(Effect.map(([template]) => template ?? null)),

        findActiveByServiceId: (serviceId) =>
            storage(database, (db) =>
                db
                    .select()
                    .from(serviceTraefikTemplates)
                    .where(
                        and(
                            eq(serviceTraefikTemplates.serviceId, serviceId),
                            eq(serviceTraefikTemplates.isActive, true)
                        )
                    )
                    .limit(1)
            ).pipe(Effect.map(([template]) => template ?? null)),

        createProviderTemplate: (data) =>
            storage(database, (db) =>
                db.insert(providerTraefikTemplates).values(data).returning()
            ).pipe(Effect.map(([template]) => template ?? null)),

        createServiceTemplate: (data) =>
            storage(database, (db) =>
                db.insert(serviceTraefikTemplates).values(data).returning()
            ).pipe(Effect.map(([template]) => template ?? null)),

        updateServiceTemplate: (id, updateData) =>
            storage(database, (db) =>
                db
                    .update(serviceTraefikTemplates)
                    .set(updateData)
                    .where(eq(serviceTraefikTemplates.id, id))
                    .returning()
            ).pipe(Effect.map(([template]) => template ?? null)),
    }
}

export class TraefikTemplateRepository extends Context.Service<
    TraefikTemplateRepository,
    TraefikTemplateRepositoryShape
>()('shared/TraefikTemplateRepository') {}
