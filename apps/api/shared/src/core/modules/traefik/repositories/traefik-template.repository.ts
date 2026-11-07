import { eq, and } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import {
    providerTraefikTemplates,
    serviceTraefikTemplates,
    type ProviderTraefikTemplate,
    type ServiceTraefikTemplate,
} from '@deployer/nest-schema/global/traefik/index'

import { DatabasePort, storage, type StorageFailure } from '../../database/storage'

class TraefikTemplateRepositoryImpl {
    findProviderByType(
        providerType: string
    ) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, (db) =>
                db
                    .select()
                    .from(providerTraefikTemplates)
                    .where(
                        eq(
                            providerTraefikTemplates.providerType,
                            providerType
                        )
                    )
                    .limit(1)
            ).pipe(Effect.map(([template]) => template ?? null))
        })
    }

    findActiveByServiceId(
        serviceId: string
    ) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, (db) =>
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
            ).pipe(Effect.map(([template]) => template ?? null))
        })
    }

    createProviderTemplate(data: {
        id: string
        providerType: string
        templateName: string
        templateContent: string
        description: string | null
        variables: unknown
        isDefault: boolean
    }) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, (db) =>
                db
                    .insert(providerTraefikTemplates)
                    .values(data)
                    .returning()
            ).pipe(Effect.map(([template]) => template ?? null))
        })
    }

    createServiceTemplate(data: {
        id: string
        serviceId: string
        templateContent: string
        variables: unknown
        isActive: boolean
    }) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, (db) =>
                db.insert(serviceTraefikTemplates).values(data).returning()
            ).pipe(Effect.map(([template]) => template ?? null))
        })
    }

    updateServiceTemplate(
        id: string,
        updateData: {
            templateContent?: string
            variables?: unknown
            isActive?: boolean
            updatedAt: Date
        }
    ) {
        return Effect.gen(function* () {
            const database = yield* DatabasePort
            return yield* storage(database, (db) =>
                db
                    .update(serviceTraefikTemplates)
                    .set(updateData)
                    .where(eq(serviceTraefikTemplates.id, id))
                    .returning()
            ).pipe(Effect.map(([template]) => template ?? null))
        })
    }
}

export type TraefikTemplateRepositoryShape = TraefikTemplateRepositoryImpl

export class TraefikTemplateRepository extends Context.Service<
    TraefikTemplateRepository,
    TraefikTemplateRepositoryShape
>()('shared/TraefikTemplateRepository') {
    static readonly live = TraefikTemplateRepositoryImpl
}
