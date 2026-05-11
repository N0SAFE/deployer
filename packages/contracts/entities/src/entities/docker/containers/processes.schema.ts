import z from 'zod/v4'

export const dockerContainerProcessStateSchema = z.enum(['running', 'sleeping', 'idle', 'stopped', 'zombie'])
export type DockerContainerProcessState = z.infer<typeof dockerContainerProcessStateSchema>

export const dockerContainerProcessEntrySchema = z.object({
  pid: z.number().int().nonnegative(),
  user: z.string().min(1),
  cpuPercent: z.number().min(0).max(100),
  memoryPercent: z.number().min(0).max(100),
  state: dockerContainerProcessStateSchema,
  startedAt: z.string(),
  command: z.string().min(1),
})
export type DockerContainerProcessEntry = z.infer<typeof dockerContainerProcessEntrySchema>