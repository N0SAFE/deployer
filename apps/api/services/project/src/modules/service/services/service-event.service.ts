import * as z from "zod";
import { BasePooledEventService } from "@deployer/nest-events";
import { Context, Effect, Layer } from "effect";

import { CoreEventStreamPool } from "@project/core/ports/core-event-stream-pool.port";
import { contractBuilder } from "@deployer/nest-events";
import { CoreEventStreamPoolService } from "@deployer/nest-events";

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

export class ServiceEventServiceImpl extends BasePooledEventService<ServiceEventContracts, "service"> {
	constructor(streamPool: CoreEventStreamPoolService) {
		super("service", serviceEventContracts, streamPool);
	}
}

/** What consumers may do with the bus: publish and subscribe. */
export type ServiceEventServiceShape = Pick<ServiceEventServiceImpl, "emitEffect" | "subscribeEffect">;

/** Effect key = NestJS token; instances come from `ServiceEventServiceLayer`. */
export class ServiceEventService extends Context.Service<ServiceEventService, ServiceEventServiceShape>()(
	"project/ServiceEventService",
) {}

/** Built by the runtime, not by Nest: the bus needs the shared stream pool. */
export const ServiceEventServiceLayer = Layer.effect(
	ServiceEventService,
	Effect.gen(function* () {
		const pool = yield* CoreEventStreamPool;
		return new ServiceEventServiceImpl(pool as unknown as CoreEventStreamPoolService);
	}),
);
