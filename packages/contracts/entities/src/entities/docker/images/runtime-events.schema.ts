import z from 'zod/v4'

export const dockerImageRuntimeActionSchema = z.enum([
  'create',
  'delete',
  'import',
  'load',
  'pull',
  'push',
  'save',
  'tag',
  'untag',
  'prune',
  'scan_queued',
  'scan_start',
  'scan_progress',
  'scan_complete',
  'scan_error',
])
export type DockerImageRuntimeAction = z.infer<typeof dockerImageRuntimeActionSchema>

export const dockerImageRuntimeEventPayloadSchema = z.object({
  imageId: z.string().nullable(),
  imageName: z.string().nullable(),
  repository: z.string().nullable(),
  tag: z.string().nullable(),
})
export type DockerImageRuntimeEventPayload = z.infer<typeof dockerImageRuntimeEventPayloadSchema>

const dockerImageRuntimeEventCommonSchema = z.object({
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

export const dockerImageRuntimeEventSchema = dockerImageRuntimeEventCommonSchema.extend({
  source: z.literal('image'),
  action: dockerImageRuntimeActionSchema,
  payload: dockerImageRuntimeEventPayloadSchema,
})
export type DockerImageRuntimeEvent = z.infer<typeof dockerImageRuntimeEventSchema>
