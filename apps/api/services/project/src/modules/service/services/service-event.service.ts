import { Context } from 'effect'
import * as z from 'zod'

import { contractBuilder } from '@deployer/events'
import { BasePooledEventService } from '@deployer/shared/core/modules/events/base/index'
import { type CoreEventStreamPoolServiceShape } from '@deployer/shared/core/modules/events/base/index'

export const serviceEventContracts = {
    serviceCreated: contractBuilder()
        .input(z.object({ projectId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                projectId: z.string(),
                name: z.string(),
                type: z.string(),
                isActive: z.boolean(),
                timestamp: z.string(),
            })
        )
        .build(),

    serviceUpdated: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                projectId: z.string(),
                changedFields: z.array(z.string()),
                timestamp: z.string(),
            })
        )
        .build(),

    serviceDeleted: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                projectId: z.string(),
                timestamp: z.string(),
            })
        )
        .build(),

    serviceActivationChanged: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                projectId: z.string(),
                isActive: z.boolean(),
                timestamp: z.string(),
            })
        )
        .build(),

    serviceDependencyAdded: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                dependsOnServiceId: z.string(),
                isRequired: z.boolean(),
                timestamp: z.string(),
            })
        )
        .build(),

    serviceDependencyRemoved: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                dependencyId: z.string(),
                timestamp: z.string(),
            })
        )
        .build(),
} as const

export type ServiceEventContracts = typeof serviceEventContracts

export class ServiceEventServiceImpl extends BasePooledEventService<
    ServiceEventContracts,
    'service'
> {
    constructor(streamPool: CoreEventStreamPoolServiceShape) {
        super('service', serviceEventContracts, streamPool)
    }
}

/** What consumers may do with the bus: publish and subscribe. */
export type ServiceEventServiceShape = Pick<
    ServiceEventServiceImpl,
    'emitEffect' | 'subscribeEffect'
>

/** Effect key = NestJS token; the module builds the instance over the shared stream pool. */
export class ServiceEventService extends Context.Service<
    ServiceEventService,
    ServiceEventServiceShape
>()('project/ServiceEventService') {}
