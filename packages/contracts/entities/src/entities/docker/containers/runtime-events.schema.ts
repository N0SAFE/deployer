import z from 'zod/v4'
import { dockerContainerMetricPointSchema } from './logs.schema'

export const dockerContainerRuntimeActionSchema = z.enum([
  'attach',
  'commit',
  'copy',
  'create',
  'destroy',
  'detach',
  'die',
  'exec_create',
  'exec_detach',
  'exec_start',
  'exec_die',
  'export',
  'health_status',
  'kill',
  'oom',
  'pause',
  'rename',
  'resize',
  'restart',
  'start',
  'stop',
  'top',
  'unpause',
  'update',
  'prune',
  'metrics',
])
export type DockerContainerRuntimeAction = z.infer<typeof dockerContainerRuntimeActionSchema>

export const dockerContainerRuntimeEventPayloadSchema = z.object({
  containerId: z.string().nullable(),
  containerName: z.string().nullable(),
  image: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  metrics: dockerContainerMetricPointSchema.nullable().optional(),
  metricsSource: z.enum(['systeminformation']).nullable().optional(),
})
export type DockerContainerRuntimeEventPayload = z.infer<typeof dockerContainerRuntimeEventPayloadSchema>

const dockerContainerRuntimeEventCommonSchema = z.object({
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

export const dockerContainerRuntimeEventSchema = dockerContainerRuntimeEventCommonSchema.extend({
  source: z.literal('container'),
  action: dockerContainerRuntimeActionSchema,
  payload: dockerContainerRuntimeEventPayloadSchema,
})
export type DockerContainerRuntimeEvent = z.infer<typeof dockerContainerRuntimeEventSchema>