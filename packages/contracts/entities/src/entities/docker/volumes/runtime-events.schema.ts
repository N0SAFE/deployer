import z from 'zod/v4'

export const dockerVolumeRuntimeActionSchema = z.enum(['create', 'mount', 'unmount', 'destroy', 'prune'])
export type DockerVolumeRuntimeAction = z.infer<typeof dockerVolumeRuntimeActionSchema>

export const dockerVolumeRuntimeEventPayloadSchema = z.object({
  volumeName: z.string().nullable(),
  driver: z.string().nullable(),
  mountpoint: z.string().nullable(),
  containerId: z.string().nullable(),
})
export type DockerVolumeRuntimeEventPayload = z.infer<typeof dockerVolumeRuntimeEventPayloadSchema>

const dockerVolumeRuntimeEventCommonSchema = z.object({
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

export const dockerVolumeRuntimeEventSchema = dockerVolumeRuntimeEventCommonSchema.extend({
  source: z.literal('volume'),
  action: dockerVolumeRuntimeActionSchema,
  payload: dockerVolumeRuntimeEventPayloadSchema,
})
export type DockerVolumeRuntimeEvent = z.infer<typeof dockerVolumeRuntimeEventSchema>