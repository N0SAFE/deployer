import z from 'zod/v4'

export const dockerVolumeSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  serviceName: z.string().min(1),
  projectId: z.string().min(1),
  storageLimit: z.string().min(1),
  isActive: z.boolean(),
  updatedAt: z.string(),
})
export type DockerVolumeSummary = z.infer<typeof dockerVolumeSummarySchema>