import z from 'zod/v4'

export const dockerContainerLogStreamSchema = z.enum(['stdout', 'stderr'])
export type DockerContainerLogStream = z.infer<typeof dockerContainerLogStreamSchema>

export const dockerContainerLogLevelSchema = z.enum(['info', 'warn', 'error'])
export type DockerContainerLogLevel = z.infer<typeof dockerContainerLogLevelSchema>

export const dockerContainerLogEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.string(),
  stream: dockerContainerLogStreamSchema,
  level: dockerContainerLogLevelSchema,
  message: z.string().min(1),
})
export type DockerContainerLogEntry = z.infer<typeof dockerContainerLogEntrySchema>

export const dockerFileEntrySchema = z.object({
  path: z.string().min(1),
  type: z.enum(['file', 'dir']),
  size: z.string().min(1),
  permissions: z.string().min(1),
  owner: z.string().min(1),
  updatedAt: z.string(),
})
export type DockerFileEntry = z.infer<typeof dockerFileEntrySchema>

export const dockerContainerMetricPointSchema = z.object({
  at: z.string(),
  cpu: z.number().min(0).max(100),
  memory: z.number().min(0).max(100),
  networkRxKb: z.number().min(0),
  networkTxKb: z.number().min(0),
  ioReadKb: z.number().min(0),
  ioWriteKb: z.number().min(0),
})
export type DockerContainerMetricPoint = z.infer<typeof dockerContainerMetricPointSchema>