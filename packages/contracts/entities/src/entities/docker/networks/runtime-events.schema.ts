import z from 'zod/v4'

export const dockerNetworkRuntimeActionSchema = z.enum([
  'create',
  'connect',
  'disconnect',
  'destroy',
  'update',
  'remove',
  'prune',
])
export type DockerNetworkRuntimeAction = z.infer<typeof dockerNetworkRuntimeActionSchema>

export const dockerNetworkRuntimeEventPayloadSchema = z.object({
  networkId: z.string().nullable(),
  networkName: z.string().nullable(),
  containerId: z.string().nullable(),
  containerName: z.string().nullable(),
})
export type DockerNetworkRuntimeEventPayload = z.infer<typeof dockerNetworkRuntimeEventPayloadSchema>

const dockerNetworkRuntimeEventCommonSchema = z.object({
  type: z.literal('docker_event'),
  actorId: z.string().nullable(),
  actorAttributes: z.record(z.string(), z.string()).default({}),
  scope: z.string().nullable(),
  from: z.string().nullable(),
  eventId: z.string().nullable(),
  nodeId: z.string().nullable(),
  timestamp: z.string(),
  timestampNano: z.number().int().nonnegative().nullable(),
  raw: z.record(z.string(), z.unknown()),
})

export const dockerNetworkRuntimeEventSchema = dockerNetworkRuntimeEventCommonSchema.extend({
  source: z.literal('network'),
  action: dockerNetworkRuntimeActionSchema,
  payload: dockerNetworkRuntimeEventPayloadSchema,
})
export type DockerNetworkRuntimeEvent = z.infer<typeof dockerNetworkRuntimeEventSchema>