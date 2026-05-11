import z from 'zod/v4'

export const dockerNetworkDriverSchema = z.enum(['bridge', 'overlay', 'host', 'macvlan', 'ipvlan', 'custom'])
export type DockerNetworkDriver = z.infer<typeof dockerNetworkDriverSchema>

export const dockerNetworkScopeSchema = z.enum(['local', 'swarm', 'global'])
export type DockerNetworkScope = z.infer<typeof dockerNetworkScopeSchema>

export const dockerNetworkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  driver: dockerNetworkDriverSchema,
  scope: dockerNetworkScopeSchema,
  internal: z.boolean().default(false),
  attachable: z.boolean().default(true),
  subnet: z.string().nullable(),
  gateway: z.string().nullable(),
  containerIds: z.array(z.string().min(1)).default([]),
  labels: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DockerNetwork = z.infer<typeof dockerNetworkSchema>