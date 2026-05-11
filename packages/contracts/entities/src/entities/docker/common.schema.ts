import z from 'zod/v4'

export const dockerContainerStatusSchema = z.enum([
  'created',
  'running',
  'paused',
  'restarting',
  'exited',
  'dead',
  'unknown',
])
export type DockerContainerStatus = z.infer<typeof dockerContainerStatusSchema>

export const dockerContainerHealthSchema = z.enum(['healthy', 'unhealthy', 'starting', 'none'])
export type DockerContainerHealth = z.infer<typeof dockerContainerHealthSchema>

export const dockerListMetaSchema = z.object({
  total: z.number().int().min(0),
  limit: z.number().int().min(0),
  offset: z.number().int().min(0),
})
export type DockerListMeta = z.infer<typeof dockerListMetaSchema>
