import z from 'zod/v4'

export const dockerRegistryAuthModeSchema = z.enum(['anonymous', 'token', 'basic', 'oidc'])
export type DockerRegistryAuthMode = z.infer<typeof dockerRegistryAuthModeSchema>

export const dockerRegistryStatusSchema = z.enum(['healthy', 'degraded', 'offline', 'unknown'])
export type DockerRegistryStatus = z.infer<typeof dockerRegistryStatusSchema>

export const dockerRegistrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  authMode: dockerRegistryAuthModeSchema,
  status: dockerRegistryStatusSchema,
  isPrimary: z.boolean().default(false),
  repositories: z.array(z.string().min(1)).default([]),
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DockerRegistry = z.infer<typeof dockerRegistrySchema>