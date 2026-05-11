import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import { dockerRuntimeEventSourceSchema } from "@repo/contracts-entities";
import z from "zod/v4";

export const dockerRuntimeStreamFilterEntitySchema = z.object({
  source: dockerRuntimeEventSourceSchema,
  action: z.string().min(1),
  actorId: z.string().min(1),
  scope: z.string().min(1),
  from: z.string().min(1),
  eventId: z.string().min(1),
  nodeId: z.string().min(1),
  timestamp: z.date(),
  containerId: z.string().min(1),
  containerName: z.string().min(1),
  image: z.string().min(1),
  imageId: z.string().min(1),
  imageName: z.string().min(1),
  repository: z.string().min(1),
  tag: z.string().min(1),
  networkId: z.string().min(1),
  networkName: z.string().min(1),
  volumeName: z.string().min(1),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  swarmNodeId: z.string().min(1),
  secretId: z.string().min(1),
  secretName: z.string().min(1),
  configId: z.string().min(1),
  configName: z.string().min(1),
  builderId: z.string().min(1),
  builderName: z.string().min(1),
});

const dockerRuntimeStreamFilterOps = standard.zod(
  dockerRuntimeStreamFilterEntitySchema,
  "dockerRuntimeStreamFilter",
);

const dockerRuntimeStreamFilterBuilder = createFilterConfig(dockerRuntimeStreamFilterOps)
  .withFiltering({
    source: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.source,
      operators: ["eq", "in", "notIn"] as const,
    },
    action: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.action,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    actorId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.actorId,
      operators: ["eq", "in", "notIn"] as const,
    },
    scope: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.scope,
      operators: ["eq", "in", "notIn"] as const,
    },
    from: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.from,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    eventId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.eventId,
      operators: ["eq", "in", "notIn"] as const,
    },
    nodeId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.nodeId,
      operators: ["eq", "in", "notIn"] as const,
    },
    timestamp: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.timestamp,
      operators: ["eq", "gt", "gte", "lt", "lte", "between"] as const,
    },
    containerId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.containerId,
      operators: ["eq", "in", "notIn"] as const,
    },
    containerName: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.containerName,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    image: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.image,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    imageId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.imageId,
      operators: ["eq", "in", "notIn"] as const,
    },
    imageName: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.imageName,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    repository: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.repository,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    tag: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.tag,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    networkId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.networkId,
      operators: ["eq", "in", "notIn"] as const,
    },
    networkName: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.networkName,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    volumeName: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.volumeName,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    serviceId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.serviceId,
      operators: ["eq", "in", "notIn"] as const,
    },
    serviceName: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.serviceName,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    swarmNodeId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.swarmNodeId,
      operators: ["eq", "in", "notIn"] as const,
    },
    secretId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.secretId,
      operators: ["eq", "in", "notIn"] as const,
    },
    secretName: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.secretName,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    configId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.configId,
      operators: ["eq", "in", "notIn"] as const,
    },
    configName: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.configName,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
    builderId: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.builderId,
      operators: ["eq", "in", "notIn"] as const,
    },
    builderName: {
      schema: dockerRuntimeStreamFilterEntitySchema.shape.builderName,
      operators: ["eq", "in", "notIn", "like", "ilike", "startsWith", "endsWith"] as const,
    },
  });

export const dockerRuntimeStreamFilterConfigSchemas = dockerRuntimeStreamFilterBuilder.buildConfig();
export const dockerRuntimeStreamFilterInputSchema = dockerRuntimeStreamFilterBuilder.buildInputSchema();

export type DockerRuntimeStreamFilterInput = ComputeInputSchema<typeof dockerRuntimeStreamFilterConfigSchemas>;

export const dockerRuntimeEventsStreamQuerySchema = dockerRuntimeStreamFilterInputSchema.and(
  z.object({
    since: z.date().optional(),
    until: z.date().optional(),
  }),
);

export type DockerRuntimeEventsStreamQueryInput = z.infer<typeof dockerRuntimeEventsStreamQuerySchema>;