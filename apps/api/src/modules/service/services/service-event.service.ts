import { Injectable } from "@nestjs/common";
import * as z from "zod";
import { BasePooledEventService } from "@/core/modules/events/services/base-pooled-event.service";
import { contractBuilder } from "@/core/modules/events/event-contract.builder";
import { CoreEventStreamPoolService } from "@/core/modules/events/services/core-event-stream-pool.service";

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
            }),
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
            }),
        )
        .build(),

    serviceDeleted: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                projectId: z.string(),
                timestamp: z.string(),
            }),
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
            }),
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
            }),
        )
        .build(),

    serviceDependencyRemoved: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                dependencyId: z.string(),
                timestamp: z.string(),
            }),
        )
        .build(),
} as const;

export type ServiceEventContracts = typeof serviceEventContracts;

@Injectable()
export class ServiceEventService extends BasePooledEventService<ServiceEventContracts, "service"> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("service", serviceEventContracts, streamPool);
    }
}
