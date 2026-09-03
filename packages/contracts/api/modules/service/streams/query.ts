import z from "zod/v4";
import { serviceTypeSchema } from "@repo/contracts-common";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

const streamEventMetaShape = {
  sequence: z.number().int().nonnegative().optional(),
  replayed: z.boolean().optional(),
  emittedAt: z.date().optional(),
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
    timestamp: z.date(),
    ...streamEventMetaShape,
  }),
  z.object({
    type: z.literal("serviceUpdated"),
    serviceId: z.uuid(),
    projectId: z.uuid(),
    changedFields: z.array(z.string()),
    timestamp: z.date(),
    ...streamEventMetaShape,
  }),
  z.object({
    type: z.literal("serviceDeleted"),
    serviceId: z.uuid(),
    projectId: z.uuid(),
    timestamp: z.date(),
    ...streamEventMetaShape,
  }),
  z.object({
    type: z.literal("serviceActivationChanged"),
    serviceId: z.uuid(),
    projectId: z.uuid(),
    isActive: z.boolean(),
    timestamp: z.date(),
    ...streamEventMetaShape,
  }),
  z.object({
    type: z.literal("serviceDependencyAdded"),
    serviceId: z.uuid(),
    dependsOnServiceId: z.uuid(),
    isRequired: z.boolean(),
    timestamp: z.date(),
    ...streamEventMetaShape,
  }),
  z.object({
    type: z.literal("serviceDependencyRemoved"),
    serviceId: z.uuid(),
    dependencyId: z.uuid(),
    timestamp: z.date(),
    ...streamEventMetaShape,
  }),
]);

export type ServiceStreamEvent = z.infer<typeof serviceStreamEventSchema>;

export const serviceStreamQueryFiltersSchema = z
  .object({
    serviceId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    serviceType: serviceTypeSchema.optional(),
    isActive: z.coerce.boolean().optional(),
    eventTypes: z.array(serviceStreamEventTypeSchema).optional(),
    fuzzy: z.string().trim().min(1).optional(),
    replay: z.coerce.boolean().default(false),
    replayLimit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .refine((value) => Boolean(value.serviceId ?? value.projectId ?? value.fuzzy), {
    message: "At least one stream selector is required (serviceId, projectId, or fuzzy)",
  });

export type ServiceStreamQueryInput = z.infer<typeof serviceStreamQueryFiltersSchema>;

const serviceStreamEventContractEntitySchema = z.object({
  type: z.string(),
  timestamp: z.date(),
});

const serviceStreamEventOps = standard.zod(serviceStreamEventContractEntitySchema, "serviceStreamEvent");

export const serviceQueryStreamContract = serviceStreamEventOps
  .list()
  .path("/stream/query")
  .input((b) => b.query(serviceStreamQueryFiltersSchema))
  .output((b) => b.observable(serviceStreamEventSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
