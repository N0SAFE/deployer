import z from 'zod/v4'

export const dockerImageSchema = z.object({
  id: z.string().min(1),
  registry: z.string().min(1),
  repository: z.string().min(1),
  tag: z.string().min(1).nullable(),
  digest: z.string().nullable(),
  sizeBytes: z.number().int().min(0).nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  labels: z.record(z.string(), z.string()).default({}),
})
export type DockerImage = z.infer<typeof dockerImageSchema>
