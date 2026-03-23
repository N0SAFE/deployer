import * as z from "zod";
import { route } from "@repo/orpc-utils/builder";

const streamEventMetaShape = {
    sequence: z.number().int().nonnegative().optional(),
    replayed: z.boolean().optional(),
    emittedAt: z.string().optional(),
} as const;

export const serviceStreamEventTypeSchema = z.enum([
    "serviceCreated",
    "serviceUpdated",
    "serviceDeleted",
    "serviceActivationChanged",
    "serviceDependencyAdded",
    "serviceDependencyRemoved",
]);

export const serviceStreamEventSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("serviceCreated"),
        serviceId: z.uuid(),
        projectId: z.uuid(),
        name: z.string(),
        serviceType: z.string(),
        isActive: z.boolean(),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("serviceUpdated"),
        serviceId: z.uuid(),
        projectId: z.uuid(),
        changedFields: z.array(z.string()),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("serviceDeleted"),
        serviceId: z.uuid(),
        projectId: z.uuid(),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("serviceActivationChanged"),
        serviceId: z.uuid(),
        projectId: z.uuid(),
        isActive: z.boolean(),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("serviceDependencyAdded"),
        serviceId: z.uuid(),
        dependsOnServiceId: z.uuid(),
        isRequired: z.boolean(),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("serviceDependencyRemoved"),
        serviceId: z.uuid(),
        dependencyId: z.uuid(),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
]);

export type ServiceStreamEvent = z.infer<typeof serviceStreamEventSchema>;

export const serviceStreamQueryFiltersSchema = z
    .object({
        serviceId: z.uuid().optional(),
        projectId: z.uuid().optional(),
        serviceType: z.string().optional(),
        isActive: z.coerce.boolean().optional(),
        eventTypes: z.array(serviceStreamEventTypeSchema).optional(),
        fuzzy: z.string().trim().min(1).optional(),
        replay: z.coerce.boolean().default(false),
        replayLimit: z.coerce.number().int().min(1).max(500).default(100),
    })
    .refine((value) => Boolean(value.serviceId || value.projectId || value.fuzzy), {
        message: "At least one stream selector is required (serviceId, projectId, or fuzzy)",
    });

export type ServiceStreamQueryInput = z.infer<typeof serviceStreamQueryFiltersSchema>;

export const serviceQueryStreamContract = route({
    method: "GET",
    path: "/stream/query",
    summary: "Stream service events with typed filters (SSE)",
    description:
        "Subscribe to service lifecycle events with fuzzy search and custom filters (serviceId/projectId/type/isActive/eventTypes).",
})
    .input((b) => b.query(serviceStreamQueryFiltersSchema))
    .output((b) => b.streamed(serviceStreamEventSchema))
    .build();
