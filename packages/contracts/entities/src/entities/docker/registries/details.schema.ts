import z from 'zod/v4'

export const dockerRegistrySummarySchema = z.object({
  registry: z.string().min(1),
  repositoryCount: z.number().int().min(0),
  imageCount: z.number().int().min(0),
  lastSeenAt: z.string(),
  repositories: z.array(z.string()),
})
export type DockerRegistrySummary = z.infer<typeof dockerRegistrySummarySchema>

export const dockerRegistryTagDetailSchema = z.object({
  name: z.string().min(1),
  digest: z.string().min(1),
  size: z.string().min(1),
  pushedAt: z.string(),
})
export type DockerRegistryTagDetail = z.infer<typeof dockerRegistryTagDetailSchema>

export const dockerRegistryRepositoryDetailSchema = z.object({
  repository: z.string().min(1),
  tags: z.array(dockerRegistryTagDetailSchema),
})
export type DockerRegistryRepositoryDetail = z.infer<typeof dockerRegistryRepositoryDetailSchema>